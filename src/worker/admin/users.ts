import type { Env, SessionUser } from '../types';
import { ok, err } from '../types';
import { checkRateLimit, recordAttempt, tooMany } from '../ratelimit';
import { audit, isAdminVerified } from './helpers';

// 어드민 사용자 관리: 검색·권한·사용기간·삭제. 모든 mutation 은 step-up 통과 필수.
// access/role 의 단건/일괄 분리, master·demo·self 제외 규칙 일관.

interface AdminUserRow {
  id: number;
  email: string;
  business_name: string;
  business_type: string | null;
  is_admin: number;
  is_demo: number;
  totp_enabled_at: number | null;
  created_at: number;
  sales_count: number;
  menu_count: number;
}

export async function handleAdminUsers(
  rest: string,
  request: Request,
  env: Env,
  url: URL,
  user: SessionUser,
  sessionToken: string,
): Promise<Response> {
  // GET /api/admin/users?q=검색어
  if (rest === '/users' && request.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.email, u.business_name, u.business_type, u.is_admin, u.is_master, u.is_demo,
              u.totp_enabled_at, u.created_at, u.access_until,
              (SELECT COUNT(*) FROM sales WHERE user_id = u.id) AS sales_count,
              (SELECT COUNT(*) FROM menus WHERE user_id = u.id AND archived = 0) AS menu_count,
              (SELECT MAX(at) FROM user_login_events WHERE user_id = u.id) AS last_login_at,
              (SELECT MAX(t) FROM (
                SELECT MAX(sold_at) AS t FROM sales WHERE user_id = u.id
                UNION ALL SELECT MAX(created_at) FROM customer_needs WHERE user_id = u.id
                UNION ALL SELECT MAX(at) FROM user_login_events WHERE user_id = u.id
              )) AS last_activity_at
       FROM users u
       WHERE ? = '' OR u.email LIKE ? ESCAPE '\\' OR u.business_name LIKE ? ESCAPE '\\'
       ORDER BY u.created_at DESC
       LIMIT 500`,
    )
      .bind(q, like, like)
      .all<AdminUserRow & { is_master: number; last_login_at: number | null; last_activity_at: number | null; access_until: number | null }>();
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    return ok({
      users: results.map((r) => ({
        ...r,
        is_admin: !!r.is_admin,
        is_master: !!r.is_master,
        is_demo: !!r.is_demo,
        mfa_enabled: !!r.totp_enabled_at,
      })),
      total: total?.n ?? results.length,
    });
  }

  // POST /api/admin/users/access/bulk - 여러 user 동시 권한 변경 (admin·master)
  // body: { userIds: number[], days?: number, revoke?: boolean }
  // - days: +N일 연장 (각 user 의 현재 access_until 기준)
  // - revoke: true 면 즉시 만료 (access_until = now - 1)
  // master·demo·자기 자신은 silently 제외 (skipped 카운트 반환)
  if (rest === '/users/access/bulk' && request.method === 'POST') {
    // rate-limit: admin 토큰 탈취 시 500 user × N회 폭주 방어. 분당 10건 (bulk 액션 공통).
    const rlKey = `admin-users-bulk:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 10, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
    await recordAttempt(env, rlKey);
    interface BulkAccessBody { userIds?: unknown; days?: unknown; revoke?: unknown }
    let body: BulkAccessBody;
    try {
      body = (await request.json()) as BulkAccessBody;
    } catch {
      return err('잘못된 요청입니다.');
    }
    const rawIds = Array.isArray(body.userIds) ? body.userIds : [];
    const requested = [
      ...new Set(
        rawIds
          .map((x) => (typeof x === 'number' ? x : Number(x)))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ].slice(0, 500);
    if (requested.length === 0) return err('userIds 가 비어있어요.');

    // 자기 자신·master·demo 제외 (silently)
    const ph = requested.map(() => '?').join(',');
    const { results: targets } = await env.DB.prepare(
      `SELECT id, is_master, is_demo, access_until FROM users WHERE id IN (${ph})`,
    )
      .bind(...requested)
      .all<{ id: number; is_master: number; is_demo: number; access_until: number | null }>();
    const eligible = targets.filter(
      (t) => t.id !== user.id && !t.is_master && !t.is_demo,
    );
    const skipped = requested.length - eligible.length;
    if (eligible.length === 0) return ok({ updated: 0, skipped });

    // 액션 결정
    const MAX_DAYS = 3650;
    let updated = 0;
    if (body.revoke === true) {
      // 즉시 만료 - 일괄 UPDATE
      const ephIds = eligible.map((t) => t.id);
      const ph2 = ephIds.map(() => '?').join(',');
      const expiredAt = Date.now() - 1;
      await env.DB.prepare(
        `UPDATE users SET access_until = ? WHERE id IN (${ph2})`,
      )
        .bind(expiredAt, ...ephIds)
        .run();
      updated = ephIds.length;
      await audit(
        env,
        user.id,
        'users.access.bulk_revoke',
        { ids: ephIds, count: updated, by_role: user.is_master ? 'master' : 'admin' },
        request,
      );
    } else if (typeof body.days === 'number' && Number.isFinite(body.days)) {
      const days = Math.floor(body.days);
      if (days < 1 || days > MAX_DAYS) return err(`days 는 1-${MAX_DAYS} 사이여야 해요.`);
      const dayMs = 24 * 60 * 60 * 1000;
      const cap = Date.now() + MAX_DAYS * dayMs;
      // 각 user 의 현재 access_until 기준 누적
      const stmts = eligible.map((t) => {
        const base = t.access_until && t.access_until > Date.now() ? t.access_until : Date.now();
        const next = Math.min(base + days * dayMs, cap);
        return env.DB.prepare('UPDATE users SET access_until = ? WHERE id = ?').bind(next, t.id);
      });
      await env.DB.batch(stmts);
      updated = eligible.length;
      await audit(
        env,
        user.id,
        'users.access.bulk_extend',
        { ids: eligible.map((t) => t.id), days, count: updated, by_role: user.is_master ? 'master' : 'admin' },
        request,
      );
    } else {
      return err('days 또는 revoke=true 중 하나 필요해요.');
    }

    return ok({ updated, skipped });
  }

  // POST /api/admin/users/role/bulk - master 만, 여러 user 의 is_admin 일괄 토글
  // body: { userIds: number[], is_admin: boolean }
  // master·자기 자신은 silently 제외.
  if (rest === '/users/role/bulk' && request.method === 'POST') {
    if (!user.is_master) return err('마스터 권한이 필요해요.', 403);
    const rlKey = `admin-users-bulk:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 10, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
    await recordAttempt(env, rlKey);
    interface BulkRoleBody { userIds?: unknown; is_admin?: unknown }
    let body: BulkRoleBody;
    try {
      body = (await request.json()) as BulkRoleBody;
    } catch {
      return err('잘못된 요청입니다.');
    }
    const nextIsAdmin = body.is_admin === true ? 1 : body.is_admin === false ? 0 : null;
    if (nextIsAdmin === null) return err('is_admin (boolean) 이 필요해요.');
    const rawIds = Array.isArray(body.userIds) ? body.userIds : [];
    const requested = [
      ...new Set(
        rawIds
          .map((x) => (typeof x === 'number' ? x : Number(x)))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ].slice(0, 500);
    if (requested.length === 0) return err('userIds 가 비어있어요.');

    // 자기 자신·master·demo 제외 (access/bulk 와 일관성. demo 가 어드민으로 승격되는 케이스 차단).
    const ph = requested.map(() => '?').join(',');
    const { results: targets } = await env.DB.prepare(
      `SELECT id, is_master, is_demo FROM users WHERE id IN (${ph})`,
    )
      .bind(...requested)
      .all<{ id: number; is_master: number; is_demo: number }>();
    const eligibleIds = targets
      .filter((t) => t.id !== user.id && !t.is_master && !t.is_demo)
      .map((t) => t.id);
    const skipped = requested.length - eligibleIds.length;
    if (eligibleIds.length === 0) return ok({ updated: 0, skipped });

    const ph2 = eligibleIds.map(() => '?').join(',');
    await env.DB.prepare(
      `UPDATE users SET is_admin = ? WHERE id IN (${ph2})`,
    )
      .bind(nextIsAdmin, ...eligibleIds)
      .run();
    await audit(
      env,
      user.id,
      'users.role.bulk',
      { ids: eligibleIds, is_admin: !!nextIsAdmin, count: eligibleIds.length },
      request,
    );
    return ok({ updated: eligibleIds.length, skipped });
  }

  // POST /api/admin/users/access - admin + master 둘 다, 다른 user 의 access_until 연장.
  // 사장님 결정 2026-05-16: 가입 시 30일 기본, 연장은 admin/master 가능.
  // body: { userId, days?: number, until?: number, infinite?: boolean }
  // - days: +N일 연장 (현재 access_until 또는 now 기준 + N일)
  // - until: 특정 timestamp (ms epoch) 로 설정
  // - infinite: true 면 NULL (무제한). admin 은 무제한 권한 부여 X (master 만)
  if (rest === '/users/access' && request.method === 'POST') {
    // 단건도 rate-limit (bulk 보다 자주 사용되니 분당 30, 별도 키).
    const rlKey = `admin-users-single:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 30, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
    await recordAttempt(env, rlKey);
    interface AccessBody { userId?: unknown; days?: unknown; until?: unknown; infinite?: unknown }
    let body: AccessBody;
    try {
      body = (await request.json()) as AccessBody;
    } catch {
      return err('잘못된 요청입니다.');
    }
    const targetId = typeof body.userId === 'number' ? body.userId : NaN;
    if (!Number.isInteger(targetId) || targetId <= 0) return err('userId 가 필요해요.');
    if (targetId === user.id) {
      await audit(env, user.id, 'users.access', { targetId, reason: 'self' }, request, false, '자기 자신 변경 시도');
      return err('자기 자신의 사용 기간은 바꿀 수 없어요.');
    }
    const target = await env.DB.prepare('SELECT is_master, access_until FROM users WHERE id = ?')
      .bind(targetId)
      .first<{ is_master: number; access_until: number | null }>();
    if (!target) return err('사용자를 찾을 수 없어요.', 404);
    if (target.is_master) return err('마스터 계정의 사용 기간은 바꿀 수 없어요.');

    const MAX_DAYS = 3650;
    const MAX_UNTIL_FROM_NOW = MAX_DAYS * 24 * 60 * 60 * 1000;
    let newAccessUntil: number | null;
    if (body.infinite === true) {
      if (!user.is_master) return err('무제한 부여는 마스터만 가능해요.', 403);
      newAccessUntil = null;
    } else if (typeof body.until === 'number' && Number.isFinite(body.until) && body.until > 0) {
      // until 도 cap 필요 - admin 이 until: 1e18 같은 우회로 master-only 무제한을 흉내내지 못하게.
      // 과거 시점 거부 (ban 용도면 별도 endpoint 만들기. 지금은 연장 전용).
      const u = Math.floor(body.until);
      if (u <= Date.now()) return err('until 은 미래 시점이어야 해요.');
      const cap = Date.now() + MAX_UNTIL_FROM_NOW;
      if (u > cap) return err(`until 은 최대 ${MAX_DAYS}일 이내만 허용해요. 무제한은 master 만 infinite=true 로.`);
      newAccessUntil = u;
    } else if (typeof body.days === 'number' && Number.isFinite(body.days)) {
      const days = Math.floor(body.days);
      if (days < 1 || days > MAX_DAYS) return err(`days 는 1-${MAX_DAYS} 사이여야 해요.`);
      // 현재 만료일이 미래면 거기서 +N일, 아니면 now 부터 +N일
      const base = target.access_until && target.access_until > Date.now()
        ? target.access_until
        : Date.now();
      newAccessUntil = base + days * 24 * 60 * 60 * 1000;
      // 누적 연장이 cap 넘으면 cap 으로 (silent)
      const cap = Date.now() + MAX_UNTIL_FROM_NOW;
      if (newAccessUntil > cap) newAccessUntil = cap;
    } else {
      return err('days 또는 until 또는 infinite=true 중 하나 필요해요.');
    }

    await env.DB.prepare('UPDATE users SET access_until = ? WHERE id = ?')
      .bind(newAccessUntil, targetId)
      .run();
    await audit(
      env,
      user.id,
      'users.access',
      { targetId, access_until: newAccessUntil, by_role: user.is_master ? 'master' : 'admin' },
      request,
    );
    return ok({ userId: targetId, access_until: newAccessUntil });
  }

  // POST /api/admin/users/role - master 만, 다른 user 의 is_admin 토글 (자기 자신 토글 X)
  if (rest === '/users/role' && request.method === 'POST') {
    if (!user.is_master) return err('마스터 권한이 필요해요.', 403);
    const rlKey = `admin-users-single:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 30, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
    await recordAttempt(env, rlKey);
    let body: { userId?: unknown; is_admin?: unknown } | null = null;
    try {
      body = (await request.json()) as { userId?: unknown; is_admin?: unknown };
    } catch {
      return err('잘못된 요청입니다.');
    }
    const targetId = typeof body?.userId === 'number' ? body.userId : NaN;
    const nextIsAdmin = body?.is_admin === true ? 1 : body?.is_admin === false ? 0 : null;
    if (!Number.isInteger(targetId) || targetId <= 0 || nextIsAdmin === null) {
      return err('userId 와 is_admin (boolean) 이 필요해요.');
    }
    if (targetId === user.id) {
      await audit(env, user.id, 'users.role', { targetId, reason: 'self' }, request, false, '자기 자신 변경 시도');
      return err('자기 자신의 권한은 바꿀 수 없어요.');
    }
    const target = await env.DB.prepare('SELECT is_master FROM users WHERE id = ?')
      .bind(targetId)
      .first<{ is_master: number }>();
    if (!target) return err('사용자를 찾을 수 없어요.', 404);
    if (target.is_master) return err('마스터 계정의 권한은 바꿀 수 없어요.');
    await env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?')
      .bind(nextIsAdmin, targetId)
      .run();
    await audit(env, user.id, 'users.role', { targetId, is_admin: !!nextIsAdmin }, request);
    return ok({ userId: targetId, is_admin: !!nextIsAdmin });
  }

  // POST /api/admin/users/delete - master 만 + step-up 통과 필수 (2026-05-16 사장님 결정)
  if (rest === '/users/delete' && request.method === 'POST') {
    if (!user.is_master) return err('마스터 권한이 필요해요.', 403);
    const rlKey = `admin-users-bulk:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 10, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
    await recordAttempt(env, rlKey);
    let body: { ids?: unknown } | null = null;
    try {
      body = (await request.json()) as { ids?: unknown };
    } catch {
      return err('잘못된 요청입니다.');
    }
    const raw = Array.isArray(body?.ids) ? body!.ids : [];
    const requested = [
      ...new Set(
        raw
          .map((x) => (typeof x === 'number' ? x : Number(x)))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ].slice(0, 500);
    const beforeSelf = requested.filter((n) => n !== user.id);
    const skippedSelf = beforeSelf.length !== requested.length;
    if (beforeSelf.length === 0) return ok({ deleted: 0, deletedIds: [], skippedSelf, skippedMasters: 0 });

    // 다른 마스터 계정도 삭제 대상에서 제외 (master 1명 invariant 방어, defense-in-depth)
    const ph0 = beforeSelf.map(() => '?').join(',');
    const { results: masterRows } = await env.DB.prepare(
      `SELECT id FROM users WHERE id IN (${ph0}) AND is_master = 1`,
    )
      .bind(...beforeSelf)
      .all<{ id: number }>();
    const masterIds = new Set(masterRows.map((r) => r.id));
    const ids = beforeSelf.filter((n) => !masterIds.has(n));
    const skippedMasters = beforeSelf.length - ids.length;
    if (ids.length === 0) return ok({ deleted: 0, deletedIds: [], skippedSelf, skippedMasters });

    const ph = ids.map(() => '?').join(',');
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM sales WHERE user_id IN (${ph})`).bind(...ids),
      env.DB.prepare(`DELETE FROM customer_needs WHERE user_id IN (${ph})`).bind(...ids),
      env.DB.prepare(`DELETE FROM monthly_cost_items WHERE user_id IN (${ph})`).bind(...ids),
      env.DB.prepare(`DELETE FROM menus WHERE user_id IN (${ph})`).bind(...ids),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (${ph})`).bind(...ids),
      env.DB.prepare(`DELETE FROM users WHERE id IN (${ph})`).bind(...ids),
    ]);
    await audit(env, user.id, 'users.delete', { ids, count: ids.length, skippedMasters }, request);
    return ok({ deleted: ids.length, deletedIds: ids, skippedSelf, skippedMasters });
  }

  return err('찾을 수 없는 경로입니다.', 404);
}
