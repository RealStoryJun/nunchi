import { Env, SECURITY_HEADERS } from './types';

interface RateLimitOk {
  ok: true;
  remaining: number;
}
interface RateLimitDenied {
  ok: false;
  retryAfterMs: number;
}
export type RateLimitResult = RateLimitOk | RateLimitDenied;

export const checkRateLimit = async (
  env: Env,
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult> => {
  const now = Date.now();
  const since = now - windowMs;
  // 오래된 기록 정리 (이 키만)
  await env.DB.prepare(
    'DELETE FROM auth_attempts WHERE key = ? AND attempted_at < ?',
  )
    .bind(key, since)
    .run();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS c, MIN(attempted_at) AS oldest FROM auth_attempts WHERE key = ?',
  )
    .bind(key)
    .first<{ c: number; oldest: number | null }>();
  const c = row?.c ?? 0;
  if (c >= max) {
    const oldest = row?.oldest ?? now;
    const retryAfterMs = Math.max(1000, oldest + windowMs - now);
    return { ok: false, retryAfterMs };
  }
  return { ok: true, remaining: max - c };
};

export const recordAttempt = async (env: Env, key: string): Promise<void> => {
  await env.DB.prepare(
    'INSERT INTO auth_attempts (key, attempted_at) VALUES (?, ?)',
  )
    .bind(key, Date.now())
    .run();
};

export const resetAttempts = async (env: Env, key: string): Promise<void> => {
  await env.DB.prepare('DELETE FROM auth_attempts WHERE key = ?')
    .bind(key)
    .run();
};

export const tooMany = (retryAfterMs: number): Response => {
  const seconds = Math.ceil(retryAfterMs / 1000);
  return new Response(
    JSON.stringify({
      ok: false,
      error: `시도 횟수가 많습니다. ${seconds}초 후 다시 시도해주세요.`,
      retryAfterSec: seconds,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(seconds),
        // 429도 다른 응답과 동일한 보안 헤더 (CSP 포함)
        ...SECURITY_HEADERS,
      },
    },
  );
};
