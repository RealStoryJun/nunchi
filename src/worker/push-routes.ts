// /api/push/* 라우트. 사용자 구독 관리 (config 조회 / subscribe / unsubscribe / status).
// 발송은 admin.ts 의 /admin/push/send 에서.

import { Env, ok, err, SessionUser } from './types';
import { checkRateLimit, recordAttempt, tooMany } from './ratelimit';

export async function handlePush(
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
): Promise<Response> {
  // GET /api/push/config - VAPID 공개 키 (클라가 PushManager.subscribe 시 필요)
  if (rest === '/config' && request.method === 'GET') {
    // 키 미설정 시 클라가 알림 기능 자체를 비활성 표시
    return ok({ vapid_public_key: env.VAPID_PUBLIC_KEY ?? null });
  }

  // GET /api/push/status - 현재 사용자의 구독 개수 (몇 개 디바이스 켜있는지)
  if (rest === '/status' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, ua, created_at, last_seen_at FROM push_subscriptions WHERE user_id = ? ORDER BY last_seen_at DESC',
    )
      .bind(user.id)
      .all<{ id: number; ua: string | null; created_at: number; last_seen_at: number }>();
    return ok({ subscriptions: results, count: results.length });
  }

  // POST /api/push/subscribe - 구독 등록 (중복 endpoint는 last_seen_at 갱신)
  if (rest === '/subscribe' && request.method === 'POST') {
    if (!env.VAPID_PUBLIC_KEY) return err('알림 기능이 비활성 상태예요.', 503);
    // rate-limit: 한 사용자당 1분에 10건 (악의적 endpoint flood 방지)
    const rlKey = `push-sub:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 10, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    await recordAttempt(env, rlKey);
    interface SubBody { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
    let body: SubBody;
    try {
      body = (await request.json()) as SubBody;
    } catch {
      return err('잘못된 요청입니다.');
    }
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
    const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';
    if (!endpoint || !p256dh || !auth) return err('구독 정보가 비어 있습니다.');
    // endpoint 가 https URL 인지 최소 검증 (악의적 endpoint 차단)
    try {
      const u = new URL(endpoint);
      if (u.protocol !== 'https:') return err('잘못된 endpoint 입니다.');
    } catch {
      return err('잘못된 endpoint 입니다.');
    }
    // UA는 사장님이 어느 디바이스인지 식별용 (최대 120자)
    const ua = (request.headers.get('user-agent') ?? '').slice(0, 120);
    const now = Date.now();

    // endpoint hijack 방지 (2026-05-16 security review):
    // 1) 같은 (user_id, endpoint) 면 갱신
    // 2) 다른 user_id 가 같은 endpoint 점유 중이면 그 row 를 먼저 삭제 (브라우저 사용자 전환 시점)
    //    공격자가 victim 의 endpoint URL 알아냈다 해도 자기 user_id 로 INSERT 가 별도 row 가 되니
    //    victim row 는 그대로. (이전엔 INSERT OR REPLACE 가 victim row 의 user_id 를 attacker 로 덮어씀)
    // 3) UNIQUE 인덱스는 (user_id, endpoint) 복합으로 운영. endpoint 만의 UNIQUE 는 schema 에서 제거.
    //
    // 단, 현 schema 의 `endpoint UNIQUE` 제약이 남아 있는 동안엔 DELETE → INSERT 2단계로 처리.
    // 본인 자기 endpoint 갱신은 동일 row 라 DELETE 후 INSERT 가 의도된 동작.
    await env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id != ?',
    )
      .bind(endpoint, user.id)
      .run();
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, ua, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         ua = excluded.ua,
         last_seen_at = excluded.last_seen_at
       WHERE user_id = excluded.user_id`,
    )
      .bind(user.id, endpoint, p256dh, auth, ua, now, now)
      .run();

    return ok({ ok: true });
  }

  // DELETE /api/push/subscribe - 구독 해제 (endpoint 로 식별)
  if (rest === '/subscribe' && request.method === 'DELETE') {
    interface DelBody { endpoint?: unknown }
    let body: DelBody;
    try {
      body = (await request.json()) as DelBody;
    } catch {
      return err('잘못된 요청입니다.');
    }
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    if (!endpoint) return err('endpoint 가 필요합니다.');
    // 본인 구독만 삭제
    await env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
    )
      .bind(endpoint, user.id)
      .run();
    return ok({ ok: true });
  }

  return err('찾을 수 없는 경로입니다.', 404);
}
