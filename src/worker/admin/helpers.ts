import type { Env } from '../types';

// 어드민 helpers: 모든 sub 핸들러가 공통으로 쓰는 step-up 검증·감사 로그 INSERT.
// admin.ts (dispatcher) 도 import 하지만 helpers 가 dispatcher 를 import 하지 않음 (circular 회피).

// step-up 통과 여부 확인 - sessions.admin_verified_until > now
export async function isAdminVerified(
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
export async function audit(
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
