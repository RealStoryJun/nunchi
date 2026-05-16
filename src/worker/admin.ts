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
              u.totp_enabled_at, u.created_at,
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
      .all<AdminUserRow & { is_master: number; last_login_at: number | null; last_activity_at: number | null }>();
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

  // GET /api/admin/audit?limit=50&cursor=<id> - 감사 로그 (DESC, cursor 페이지네이션)
  if (rest === '/audit' && request.method === 'GET') {
    const limN = Number(url.searchParams.get('limit') ?? 50);
    const limit = Math.min(Math.max(Number.isFinite(limN) ? limN : 50, 1), 200);
    const cursor = Number(url.searchParams.get('cursor') ?? 0);
    const sql = cursor > 0
      ? `SELECT a.id, a.admin_user_id, u.email AS admin_email, a.action, a.target_json,
                a.ip, a.ua, a.at, a.ok, a.error_msg
         FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
         WHERE a.id < ? ORDER BY a.id DESC LIMIT ?`
      : `SELECT a.id, a.admin_user_id, u.email AS admin_email, a.action, a.target_json,
                a.ip, a.ua, a.at, a.ok, a.error_msg
         FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
         ORDER BY a.id DESC LIMIT ?`;
    const stmt = cursor > 0
      ? env.DB.prepare(sql).bind(cursor, limit + 1)
      : env.DB.prepare(sql).bind(limit + 1);
    const { results } = await stmt.all<{
      id: number;
      admin_user_id: number;
      admin_email: string | null;
      action: string;
      target_json: string | null;
      ip: string | null;
      ua: string | null;
      at: number;
      ok: number;
      error_msg: string | null;
    }>();
    const hasMore = results.length > limit;
    const rows = hasMore ? results.slice(0, limit) : results;
    return ok({
      entries: rows.map((r) => ({ ...r, ok: !!r.ok })),
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

  // GET /api/admin/login-events?limit=50&newOnly=1 - 사용자 로그인 이벤트 (새 디바이스 위주)
  if (rest === '/login-events' && request.method === 'GET') {
    const limN = Number(url.searchParams.get('limit') ?? 50);
    const limit = Math.min(Math.max(Number.isFinite(limN) ? limN : 50, 1), 200);
    const newOnly = url.searchParams.get('newOnly') === '1';
    const where = newOnly ? 'WHERE e.is_new_device = 1' : '';
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.user_id, u.email, e.ip, e.ua, e.is_new_device, e.at
       FROM user_login_events e LEFT JOIN users u ON u.id = e.user_id
       ${where}
       ORDER BY e.at DESC LIMIT ?`,
    )
      .bind(limit)
      .all<{
        id: number;
        user_id: number;
        email: string | null;
        ip: string | null;
        ua: string | null;
        is_new_device: number;
        at: number;
      }>();
    return ok({
      events: results.map((r) => ({ ...r, is_new_device: !!r.is_new_device })),
    });
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

  return err('찾을 수 없는 경로입니다.', 404);
}
