import { Env, ok, err, SessionUser } from './types';
import { verifyPassword } from './crypto';
import { checkRateLimit, recordAttempt, resetAttempts, tooMany } from './ratelimit';
import { sendPushChunk, type PushSubscriptionRow } from './push';

// 어드민 전용 - 계정·통계·감사 로그. 모든 핸들러는 is_admin 검증 통과 후만 실행.
// mutation(예: users/delete)은 추가로 sessions.admin_verified_until 검증 (step-up auth).

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

// step-up 통과 여부 확인 - sessions.admin_verified_until > now
async function isAdminVerified(
  env: Env,
  sessionToken: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT admin_verified_until FROM sessions WHERE token = ?',
  )
    .bind(sessionToken)
    .first<{ admin_verified_until: number }>();
  return !!row && row.admin_verified_until > Date.now();
}

// 감사 로그 INSERT - 실패해도 본 응답에 영향 없게 try/catch
async function audit(
  env: Env,
  adminUserId: number,
  action: string,
  targetJson: unknown,
  request: Request,
  okFlag = true,
  errorMsg: string | null = null,
): Promise<void> {
  try {
    const ip = request.headers.get('cf-connecting-ip') ?? null;
    const ua = (request.headers.get('user-agent') ?? '').slice(0, 200);
    await env.DB.prepare(
      `INSERT INTO admin_audit_log
       (admin_user_id, action, target_json, ip, ua, at, ok, error_msg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        adminUserId,
        action,
        targetJson ? JSON.stringify(targetJson).slice(0, 1000) : null,
        ip,
        ua,
        Date.now(),
        okFlag ? 1 : 0,
        errorMsg ? errorMsg.slice(0, 500) : null,
      )
      .run();
  } catch {
    /* audit 실패는 본 흐름 안 막음 */
  }
}

export async function handleAdmin(
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
  url: URL,
  sessionToken: string,
): Promise<Response> {
  if (!user.is_admin) return err('관리자 권한이 필요합니다.', 403);

  // POST /api/admin/step-up { password } - 비밀번호 재확인 → 10분간 mutation 허용.
  // 세션 탈취 시 비밀번호 brute-force 방어 - pwd-confirm:userId rate-limit.
  if (rest === '/step-up' && request.method === 'POST') {
    let body: { password?: unknown } | null = null;
    try {
      body = (await request.json()) as { password?: unknown };
    } catch {
      return err('잘못된 요청입니다.');
    }
    const pwd = typeof body?.password === 'string' ? body.password : '';
    if (!pwd) return err('비밀번호를 입력해주세요.');
    const rlKey = `pwd-confirm:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 5, 15 * 60 * 1000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(pwd, row.password_hash))) {
      await recordAttempt(env, rlKey);
      await audit(env, user.id, 'step_up', { ok: false }, request, false, '비밀번호 불일치');
      return err('비밀번호가 일치하지 않습니다.', 401);
    }
    const verifiedUntil = Date.now() + 10 * 60 * 1000;
    await Promise.all([
      env.DB.prepare(
        'UPDATE sessions SET admin_verified_until = ? WHERE token = ?',
      )
        .bind(verifiedUntil, sessionToken)
        .run(),
      resetAttempts(env, rlKey),
    ]);
    await audit(env, user.id, 'step_up', { verified_until: verifiedUntil }, request);
    return ok({ verified_until: verifiedUntil });
  }

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
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
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
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
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
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
    interface AccessBody { userId?: unknown; days?: unknown; until?: unknown; infinite?: unknown }
    let body: AccessBody;
    try {
      body = (await request.json()) as AccessBody;
    } catch {
      return err('잘못된 요청입니다.');
    }
    const targetId = typeof body.userId === 'number' ? body.userId : NaN;
    if (!Number.isInteger(targetId) || targetId <= 0) return err('userId 가 필요해요.');
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
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
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
    if (targetId === user.id) return err('자기 자신의 권한은 바꿀 수 없어요.');
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
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
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
    if (beforeSelf.length === 0) return ok({ deleted: 0, skippedSelf, skippedMasters: 0 });

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
    if (ids.length === 0) return ok({ deleted: 0, skippedSelf, skippedMasters });

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
    return ok({ deleted: ids.length, skippedSelf, skippedMasters });
  }

  // GET /api/admin/stats - 시스템 통계 (데모 계정 제외)
  if (rest === '/stats' && request.method === 'GET') {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const ym = (() => {
      const d = new Date(now + 9 * 3600 * 1000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    })();
    const [totalUsers, demoUsers, weekNew, totalSales, totalNeeds, monthAi] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_demo = 0').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_demo = 1').first<{ n: number }>(),
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM users WHERE is_demo = 0 AND created_at >= ?',
      ).bind(weekAgo).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM sales s JOIN users u ON u.id = s.user_id WHERE u.is_demo = 0`,
      ).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM customer_needs cn JOIN users u ON u.id = cn.user_id WHERE u.is_demo = 0`,
      ).first<{ n: number }>(),
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM ai_usage_log WHERE year_month = ?',
      ).bind(ym).first<{ n: number }>(),
    ]);
    return ok({
      total_users: totalUsers?.n ?? 0,
      demo_users: demoUsers?.n ?? 0,
      week_new_users: weekNew?.n ?? 0,
      total_sales: totalSales?.n ?? 0,
      total_needs: totalNeeds?.n ?? 0,
      month_ai_calls: monthAi?.n ?? 0,
      year_month: ym,
    });
  }

  // GET /api/admin/audit?kind=audit|login|push&q=&from=&to=&cursor=&limit=
  // 통합 로그 탭 (2026-05-16). kind 별로 다른 테이블 조회, 응답 envelope 동일.
  // - audit: admin_audit_log (어드민 행위 11종)
  // - login: user_login_events (사용자 로그인, 새 디바이스 표시)
  // - push:  admin_push_log (어드민 푸시 발송 + sent/failed 카운트)
  // 필터: q (이메일·action 부분일치), from/to (ms epoch), cursor (id DESC)
  if (rest === '/audit' && request.method === 'GET') {
    const kindQ = url.searchParams.get('kind') ?? 'audit';
    const kind = kindQ === 'login' || kindQ === 'push' ? kindQ : 'audit';
    const limN = Number(url.searchParams.get('limit') ?? 50);
    const limit = Math.min(Math.max(Number.isFinite(limN) ? limN : 50, 1), 200);
    const cursorQ = url.searchParams.get('cursor');
    const cursorN = cursorQ && /^\d+$/.test(cursorQ) ? Number(cursorQ) : 0;
    const cursor = Number.isSafeInteger(cursorN) && cursorN >= 0 ? cursorN : 0;
    const qRaw = url.searchParams.get('q') ?? '';
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    // LIKE escape: %, _, \\ — `\\` 로 escape, ESCAPE '\\' 절 사용
    const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => '\\' + m);
    const q = qRaw.trim().slice(0, 60); // 입력 길이 제한 (방어)
    const MAX_DATE_MS = 8.64e15;
    const fromMs = fromQ && /^\d+$/.test(fromQ) && Number.isSafeInteger(Number(fromQ)) && Number(fromQ) >= 0 && Number(fromQ) <= MAX_DATE_MS ? Number(fromQ) : null;
    const toMs = toQ && /^\d+$/.test(toQ) && Number.isSafeInteger(Number(toQ)) && Number(toQ) >= 0 && Number(toQ) <= MAX_DATE_MS ? Number(toQ) : null;

    interface BaseRow { id: number; at: number; }

    if (kind === 'audit') {
      const conds: string[] = [];
      const args: (string | number)[] = [];
      if (cursor > 0) { conds.push('a.id < ?'); args.push(cursor); }
      if (q) {
        conds.push('(u.email LIKE ? ESCAPE \'\\\\\' OR a.action LIKE ? ESCAPE \'\\\\\')');
        const pat = `%${escapeLike(q)}%`;
        args.push(pat, pat);
      }
      if (fromMs != null) { conds.push('a.at >= ?'); args.push(fromMs); }
      if (toMs != null) { conds.push('a.at < ?'); args.push(toMs); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.admin_user_id, u.email AS admin_email, a.action, a.target_json,
                a.ip, a.ua, a.at, a.ok, a.error_msg
         FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
         ${where}
         ORDER BY a.id DESC LIMIT ?`,
      ).bind(...args, limit + 1).all<{
        id: number; admin_user_id: number; admin_email: string | null;
        action: string; target_json: string | null;
        ip: string | null; ua: string | null;
        at: number; ok: number; error_msg: string | null;
      }>();
      const hasMore = results.length > limit;
      const rows = hasMore ? results.slice(0, limit) : results;
      return ok({
        entries: rows.map((r) => ({ ...r, ok: !!r.ok })),
        next_cursor: hasMore ? rows[rows.length - 1].id : null,
      });
    }

    if (kind === 'login') {
      // 사용자 IP/UA 노출은 스토킹 단서가 될 수 있어 step-up 요구 (사장님 정책 "보안은 과해야").
      if (!(await isAdminVerified(env, sessionToken))) {
        return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
      }
      const conds: string[] = [];
      const args: (string | number)[] = [];
      if (cursor > 0) { conds.push('e.id < ?'); args.push(cursor); }
      if (q) {
        conds.push('u.email LIKE ? ESCAPE \'\\\\\'');
        args.push(`%${escapeLike(q)}%`);
      }
      if (fromMs != null) { conds.push('e.at >= ?'); args.push(fromMs); }
      if (toMs != null) { conds.push('e.at < ?'); args.push(toMs); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { results } = await env.DB.prepare(
        `SELECT e.id, e.user_id, u.email AS user_email, e.ip, e.ua, e.is_new_device, e.at
         FROM user_login_events e LEFT JOIN users u ON u.id = e.user_id
         ${where}
         ORDER BY e.id DESC LIMIT ?`,
      ).bind(...args, limit + 1).all<{
        id: number; user_id: number; user_email: string | null;
        ip: string | null; ua: string | null; is_new_device: number; at: number;
      }>();
      const hasMore = results.length > limit;
      const rows = hasMore ? results.slice(0, limit) : results;
      return ok({
        entries: rows.map((r) => ({ ...r, is_new_device: !!r.is_new_device })),
        next_cursor: hasMore ? rows[rows.length - 1].id : null,
      });
    }

    // kind === 'push'
    const conds: string[] = [];
    const args: (string | number)[] = [];
    if (cursor > 0) { conds.push('p.id < ?'); args.push(cursor); }
    if (q) {
      conds.push('(u.email LIKE ? ESCAPE \'\\\\\' OR p.title LIKE ? ESCAPE \'\\\\\')');
      const pat = `%${escapeLike(q)}%`;
      args.push(pat, pat);
    }
    if (fromMs != null) { conds.push('p.created_at >= ?'); args.push(fromMs); }
    if (toMs != null) { conds.push('p.created_at < ?'); args.push(toMs); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.admin_user_id, u.email AS admin_email,
              p.target_kind, p.target_user_id, p.title, p.body, p.url,
              p.subscribers_sent, p.subscribers_failed,
              p.created_at AS at
       FROM admin_push_log p LEFT JOIN users u ON u.id = p.admin_user_id
       ${where}
       ORDER BY p.id DESC LIMIT ?`,
    ).bind(...args, limit + 1).all<BaseRow & {
      admin_user_id: number; admin_email: string | null;
      target_kind: string; target_user_id: number | null;
      title: string; body: string; url: string | null;
      subscribers_sent: number; subscribers_failed: number;
    }>();
    const hasMore = results.length > limit;
    const rows = hasMore ? results.slice(0, limit) : results;
    return ok({
      entries: rows,
      next_cursor: hasMore ? rows[rows.length - 1].id : null,
    });
  }

  // GET /api/admin/ai-usage?ym=YYYY-MM - 월별 AI 호출 집계 (모델·실패율·총 토큰)
  if (rest === '/ai-usage' && request.method === 'GET') {
    const ym = url.searchParams.get('ym') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return err('잘못된 월 형식이에요.');
    const { results } = await env.DB.prepare(
      `SELECT model,
              COUNT(*) AS calls,
              SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS success,
              SUM(in_tokens) AS in_tokens,
              SUM(out_tokens) AS out_tokens,
              AVG(latency_ms) AS avg_latency_ms
       FROM ai_usage_log WHERE year_month = ?
       GROUP BY model ORDER BY calls DESC`,
    )
      .bind(ym)
      .all<{
        model: string;
        calls: number;
        success: number;
        in_tokens: number | null;
        out_tokens: number | null;
        avg_latency_ms: number | null;
      }>();
    return ok({ ym, by_model: results });
  }

  // GET /api/admin/push/log - 최근 발송 이력 (90일 이내)
  if (rest === '/push/log' && request.method === 'GET') {
    const since = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const { results } = await env.DB.prepare(
      `SELECT id, target_kind, target_user_id, title, body, url, subscribers_sent, subscribers_failed, created_at
       FROM admin_push_log WHERE created_at > ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(since)
      .all();
    return ok({ logs: results });
  }

  // POST /api/admin/push/send { target: 'all' | { userId }, title, body, url? }
  // step-up 인증 + rate-limit + chunk 50 발송 + 410/404 자동 정리.
  if (rest === '/push/send' && request.method === 'POST') {
    // rate-limit: admin 토큰 탈취 시 무한 발송 방어. 분당 5건, defense-in-depth (step-up 외에 한 겹 더).
    const rlKey = `admin-push-send:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 5, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);

    // step-up 게이트 (mutation)
    const stepUp = await env.DB.prepare(
      'SELECT admin_verified_until FROM sessions WHERE token = ?',
    )
      .bind(sessionToken)
      .first<{ admin_verified_until: number }>();
    if (!stepUp || stepUp.admin_verified_until < Date.now()) {
      // 실패도 audit 에 남김 (운영자 토큰 탈취 시 추적 가능)
      await audit(env, user.id, 'push.send', { reason: 'step-up_missing' }, request, false, 'step-up 미통과');
      return err('관리자 step-up 인증이 필요합니다 (비밀번호 재입력).', 401);
    }
    // step-up 통과 시점에 rate-limit 카운터 ↑ (성공 발송도 budget 소모)
    await recordAttempt(env, rlKey);

    interface PushSendBody { target?: unknown; title?: unknown; body?: unknown; url?: unknown }
    let body: PushSendBody;
    try {
      body = (await request.json()) as PushSendBody;
    } catch {
      return err('잘못된 요청입니다.');
    }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
    const msgBody = typeof body.body === 'string' ? body.body.trim().slice(0, 200) : '';
    const clickUrl = typeof body.url === 'string' ? body.url.trim().slice(0, 200) : '/';
    if (!title || !msgBody) return err('제목과 본문을 입력해주세요.');
    // URL은 same-origin path 만 허용. URL 파서로 정규화 후 origin 비교 (backslash open-redirect 방어).
    // 단순 startsWith('/') 만으론 '/\\evil.com' 같은 페이로드가 브라우저 파서에서 evil.com 으로 풀림.
    if (clickUrl) {
      try {
        const dummyOrigin = 'https://x.invalid';
        const parsed = new URL(clickUrl, dummyOrigin);
        if (parsed.origin !== dummyOrigin || !parsed.pathname.startsWith('/')) {
          return err('URL은 / 로 시작하는 앱 내부 경로만 허용해요.');
        }
      } catch {
        return err('URL 형식이 잘못됐어요.');
      }
    }

    let target: 'all' | { userId: number };
    if (body.target === 'all') {
      target = 'all';
    } else if (
      body.target &&
      typeof body.target === 'object' &&
      typeof (body.target as { userId?: unknown }).userId === 'number'
    ) {
      target = { userId: (body.target as { userId: number }).userId };
    } else {
      return err('target 형식이 잘못됐어요.');
    }

    // 구독 목록 fetch
    let subs: (PushSubscriptionRow & { id: number })[];
    if (target === 'all') {
      const { results } = await env.DB.prepare(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions',
      ).all<PushSubscriptionRow & { id: number }>();
      subs = results;
    } else {
      const { results } = await env.DB.prepare(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      )
        .bind(target.userId)
        .all<PushSubscriptionRow & { id: number }>();
      subs = results;
    }

    if (subs.length === 0) {
      // 0 명이라도 admin_push_log 에 기록 (이력 남김)
      await env.DB.prepare(
        `INSERT INTO admin_push_log (admin_user_id, target_kind, target_user_id, title, body, url, subscribers_sent, subscribers_failed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      )
        .bind(
          user.id,
          target === 'all' ? 'all' : 'user',
          target === 'all' ? null : target.userId,
          title,
          msgBody,
          clickUrl,
          Date.now(),
        )
        .run();
      return ok({ sent: 0, failed: 0, note: '구독자가 0명입니다.' });
    }

    // Free tier subrequest 50/request 한도 회피 — 50명씩 chunk
    const CHUNK = 50;
    let totalSent = 0;
    let totalFailed = 0;
    const expiredAll: string[] = [];
    for (let i = 0; i < subs.length; i += CHUNK) {
      const batch = subs.slice(i, i + CHUNK);
      const r = await sendPushChunk(env, batch, { title, body: msgBody, url: clickUrl });
      totalSent += r.sent;
      totalFailed += r.failed;
      expiredAll.push(...r.expiredEndpoints);
    }

    // 만료된 endpoint cleanup
    if (expiredAll.length > 0) {
      // SQLite IN 절은 placeholder 개수 한도가 매우 큼, 그래도 chunk 100씩
      const DEL_CHUNK = 100;
      for (let i = 0; i < expiredAll.length; i += DEL_CHUNK) {
        const batch = expiredAll.slice(i, i + DEL_CHUNK);
        const ph = batch.map(() => '?').join(',');
        await env.DB.prepare(
          `DELETE FROM push_subscriptions WHERE endpoint IN (${ph})`,
        )
          .bind(...batch)
          .run();
      }
    }

    // 발송 시각 갱신 (성공한 endpoint 만)
    // 너무 많은 update 안 하도록 — 50명 미만이면 안 함 (cron 정리에 맡김)
    // 일단 single statement 로 last_seen_at 업데이트 (target='all' 만)
    // ... 실측 데이터 보고 추후 결정. 지금은 skip.

    // 이력 저장
    await env.DB.prepare(
      `INSERT INTO admin_push_log (admin_user_id, target_kind, target_user_id, title, body, url, subscribers_sent, subscribers_failed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        user.id,
        target === 'all' ? 'all' : 'user',
        target === 'all' ? null : target.userId,
        title,
        msgBody,
        clickUrl,
        totalSent,
        totalFailed,
        Date.now(),
      )
      .run();

    await audit(
      env,
      user.id,
      'push.send',
      { target, title, sent: totalSent, failed: totalFailed, expired: expiredAll.length },
      request,
    );

    return ok({ sent: totalSent, failed: totalFailed, expired: expiredAll.length });
  }

  // GET /api/admin/export/sales?userId=&from=&to=&ym=YYYY-MM
  // GET /api/admin/export/needs?userId=&from=&to=&ym=YYYY-MM
  // admin·master 둘 다, CSV 다운로드. 최대 50,000 row cap (worker memory 보호).
  // userId 없으면 전체, ym 있으면 그 월(KST), from/to 우선.
  // step-up 필수: 일괄 PII export 는 push 발송보다 데이터 유출 폭이 크므로 비번 재확인 요구.
  if ((rest === '/export/sales' || rest === '/export/needs') && request.method === 'GET') {
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
    const userIdQ = url.searchParams.get('userId');
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    const ymQ = url.searchParams.get('ym');

    // 기간 결정: ym > (from + to) > 무제한
    // Date max = ±8.64e15 ms. SQLite INTEGER 안에 들어가야 함.
    const MAX_DATE_MS = 8.64e15;
    let fromMs: number | null = null;
    let toMs: number | null = null;
    if (ymQ && /^\d{4}-(0[1-9]|1[0-2])$/.test(ymQ)) {
      // YYYY-MM (KST 기준). KST = UTC+9. 그 달의 KST 1일 0시 ~ 다음 달 1일 0시.
      const [y, m] = ymQ.split('-').map(Number);
      const startKst = Date.UTC(y, m - 1, 1, -9, 0, 0); // KST 1일 0시 = UTC 전날 15시
      const endKst = Date.UTC(y, m, 1, -9, 0, 0);
      fromMs = startKst;
      toMs = endKst;
    } else {
      if (fromQ && /^\d+$/.test(fromQ)) {
        const n = Number(fromQ);
        if (Number.isSafeInteger(n) && n >= 0 && n <= MAX_DATE_MS) fromMs = n;
      }
      if (toQ && /^\d+$/.test(toQ)) {
        const n = Number(toQ);
        if (Number.isSafeInteger(n) && n >= 0 && n <= MAX_DATE_MS) toMs = n;
      }
    }

    const targetUserId = userIdQ && /^\d+$/.test(userIdQ) ? Number(userIdQ) : null;
    const conds: string[] = [];
    const args: (string | number)[] = [];
    if (targetUserId) {
      conds.push('s.user_id = ?');
      args.push(targetUserId);
    }
    const CAP = 50000;

    // 파일명 suffix: ym 있으면 그 값, from/to 있으면 기간, 아니면 '전체-YYYYMMDD'
    const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    const fnameSuffix = ymQ
      ? ymQ
      : (fromMs != null && toMs != null)
        ? `${new Date(fromMs + 9 * 3600 * 1000).toISOString().slice(0, 10)}_${new Date(toMs - 1 + 9 * 3600 * 1000).toISOString().slice(0, 10)}`
        : `all-${todayKst}`;

    let csv = '';
    let filename = '';
    let rowCount = 0;
    if (rest === '/export/sales') {
      if (fromMs != null) { conds.push('s.sold_at >= ?'); args.push(fromMs); }
      if (toMs != null) { conds.push('s.sold_at < ?'); args.push(toMs); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { results } = await env.DB.prepare(
        `SELECT s.id, s.user_id, u.email, u.business_name, s.menu_id,
                m.name AS menu_name, m.emoji AS menu_emoji,
                s.quantity, s.cost_at_sale, s.price_at_sale, s.sold_at
         FROM sales s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN menus m ON m.id = s.menu_id
         ${where}
         ORDER BY s.sold_at DESC
         LIMIT ?`,
      )
        .bind(...args, CAP)
        .all<{
          id: number; user_id: number; email: string; business_name: string;
          menu_id: number; menu_name: string | null; menu_emoji: string | null;
          quantity: number; cost_at_sale: number; price_at_sale: number; sold_at: number;
        }>();
      const headers = ['id', 'user_id', 'email', 'business_name', 'menu_id', 'menu_name', 'emoji', 'quantity', 'cost_at_sale', 'price_at_sale', 'total_cost', 'total_price', 'profit', 'sold_at_iso'];
      const rows = results.map((r) => [
        r.id, r.user_id, r.email, r.business_name, r.menu_id, r.menu_name ?? '', r.menu_emoji ?? '',
        r.quantity, r.cost_at_sale, r.price_at_sale,
        r.quantity * r.cost_at_sale, r.quantity * r.price_at_sale,
        r.quantity * (r.price_at_sale - r.cost_at_sale),
        new Date(r.sold_at).toISOString(),
      ]);
      csv = toCsv(headers, rows);
      rowCount = rows.length;
      filename = `nunchi-sales-${fnameSuffix}.csv`;
    } else {
      // needs - 컬럼이 다르므로 별도 conds 재구성 (sales 의 s.* alias 와 충돌 회피)
      const condsN: string[] = [];
      const argsN: (string | number)[] = [];
      if (targetUserId) { condsN.push('n.user_id = ?'); argsN.push(targetUserId); }
      if (fromMs != null) { condsN.push('n.created_at >= ?'); argsN.push(fromMs); }
      if (toMs != null) { condsN.push('n.created_at < ?'); argsN.push(toMs); }
      const whereN = condsN.length ? `WHERE ${condsN.join(' AND ')}` : '';
      const { results } = await env.DB.prepare(
        `SELECT n.id, n.user_id, u.email, u.business_name,
                n.gender, n.age_band, n.with_child, n.purpose, n.residence,
                n.menu_ids, n.created_at
         FROM customer_needs n
         JOIN users u ON u.id = n.user_id
         ${whereN}
         ORDER BY n.created_at DESC
         LIMIT ?`,
      )
        .bind(...argsN, CAP)
        .all<{
          id: number; user_id: number; email: string; business_name: string;
          gender: string | null; age_band: string | null; with_child: number | null;
          purpose: string | null; residence: string | null;
          menu_ids: string | null; created_at: number;
        }>();
      const headers = ['id', 'user_id', 'email', 'business_name', 'gender', 'age_band', 'with_child', 'purpose', 'residence', 'menu_ids', 'created_at_iso'];
      const rows = results.map((r) => [
        r.id, r.user_id, r.email, r.business_name,
        r.gender ?? '', r.age_band ?? '',
        r.with_child == null ? '' : r.with_child ? 'yes' : 'no',
        r.purpose ?? '', r.residence ?? '',
        r.menu_ids ?? '',
        new Date(r.created_at).toISOString(),
      ]);
      csv = toCsv(headers, rows);
      rowCount = rows.length;
      filename = `nunchi-needs-${fnameSuffix}.csv`;
    }

    await audit(
      env, user.id,
      `export.${rest === '/export/sales' ? 'sales' : 'needs'}`,
      { userId: targetUserId, ym: ymQ, from: fromMs, to: toMs, by_role: user.is_master ? 'master' : 'admin' },
      request,
    );

    // UTF-8 BOM (Excel 한글 자동 인식). cap 도달 시 truncation 신호 헤더.
    const bom = '﻿';
    const truncated = rowCount >= CAP;
    // filename 헤더 인젝션 방어: 큰따옴표/CR/LF/non-printable 제거.
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return new Response(bom + csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Cache-Control': 'no-store',
        'X-Truncated': truncated ? '1' : '0',
        'X-Row-Count': String(rowCount),
      },
    });
  }

  return err('찾을 수 없는 경로입니다.', 404);
}

// CSV 인코딩. 콤마·따옴표·줄바꿈 escape + Excel formula injection 방어.
// 문자열 값만 `=+-@` 시작 시 single quote prefix (OWASP CSV Injection).
// 숫자는 prefix 하지 않음 (음수 `-1000` 등 정상 데이터 보존).
function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (v: string | number | null): string => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    // 문자열만 OWASP 가드. 제어문자(NUL, \v, \f 등) 제거 후 prefix 검사.
    let s = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    if (s.length > 0 && /^[=+\-@\t]/.test(s)) s = "'" + s;
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(row.map(escape).join(','));
  return lines.join('\r\n');
}
