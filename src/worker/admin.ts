import type { Env, SessionUser } from './types';
import { ok, err } from './types';
import { verifyPassword } from './crypto';
import { checkRateLimit, recordAttempt, resetAttempts, tooMany } from './ratelimit';
import { audit } from './admin/helpers';
import { handleAdminUsers } from './admin/users';
import { handleAdminStats } from './admin/stats';
import { handleAdminLogs } from './admin/logs';
import { handleAdminPush } from './admin/push';
import { handleAdminExport } from './admin/export';

// 어드민 dispatcher. is_admin 검증·step-up 핸들러만 inline, 나머지는 admin/* 서브 파일로 위임.
// 분할 동기 (2026-05-16): 단일 파일 965줄·11 endpoint → 책임별 6 파일로 분리.

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

  // sub 파일로 위임. 각 sub 가 자기 prefix 외에는 404 반환 — 여기서는 첫 매치 fallthrough.
  if (rest === '/users' || rest.startsWith('/users/')) {
    return handleAdminUsers(rest, request, env, url, user, sessionToken);
  }
  if (rest === '/stats') {
    return handleAdminStats(rest, request, env);
  }
  if (rest === '/audit' || rest === '/ai-usage') {
    return handleAdminLogs(rest, request, env, url, user, sessionToken);
  }
  if (rest === '/push/send') {
    return handleAdminPush(rest, request, env, user, sessionToken);
  }
  if (rest === '/export/sales' || rest === '/export/needs') {
    return handleAdminExport(rest, request, env, url, user, sessionToken);
  }

  return err('찾을 수 없는 경로입니다.', 404);
}
