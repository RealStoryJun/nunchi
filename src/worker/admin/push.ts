import type { Env, SessionUser } from '../types';
import { ok, err } from '../types';
import { checkRateLimit, recordAttempt, tooMany } from '../ratelimit';
import { sendPushChunk, type PushSubscriptionRow } from '../push';
import { audit } from './helpers';

// 어드민 푸시 발송. rate-limit (분당 5) + step-up + chunk 50 + 410/404 자동 정리.
// 발송 이력은 admin_push_log 에 INSERT 하고, 어드민 로그 탭 (kind=push) 에서 조회.
// /push/log 는 통합 로그 탭으로 대체되어 삭제됨 (PR 8 정리).

export async function handleAdminPush(
  rest: string,
  request: Request,
  env: Env,
  user: SessionUser,
  sessionToken: string,
): Promise<Response> {
  // POST /api/admin/push/send { target: 'all' | { userId }, title, body, url? }
  // step-up 인증 + rate-limit + chunk 50 발송 + 410/404 자동 정리.
  if (rest === '/push/send' && request.method === 'POST') {
    // rate-limit: admin 토큰 탈취 시 무한 발송 방어. 분당 5건, defense-in-depth (step-up 외에 한 겹 더).
    const rlKey = `admin-push-send:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 5, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);

    // step-up 게이트 (mutation). master 는 면제 (2026-05-17 사장님 결정).
    if (!user.is_master) {
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

    // master 격리: admin (non-master) 은 master 에게 push 발송 차단 (access·role·csv·ai-toggle 패턴 일관, logic audit 🟡 #1)
    if (target !== 'all' && !user.is_master) {
      const t = await env.DB.prepare('SELECT is_master FROM users WHERE id = ?')
        .bind(target.userId).first<{ is_master: number }>();
      if (t?.is_master) {
        return err('마스터 계정에게는 마스터만 발송할 수 있어요.', 403);
      }
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
