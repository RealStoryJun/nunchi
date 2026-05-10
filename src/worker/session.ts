import { Env, SessionUser } from './types';
import { randomToken } from './crypto';

const COOKIE = 'nunchi_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const sessionCookie = (token: string, expiresAt: number) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;

export const clearCookie = () =>
  `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

const parseCookie = (header: string | null, name: string): string | null => {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === name) return v ?? null;
  }
  return null;
};

export const createSession = async (env: Env, userId: number) => {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + TTL_MS;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, userId, expiresAt, now)
    .run();
  return { token, expiresAt };
};

export const destroySession = async (env: Env, token: string) => {
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
};

export const getSessionUser = async (
  request: Request,
  env: Env,
): Promise<{ user: SessionUser; token: string } | null> => {
  const token = parseCookie(request.headers.get('cookie'), COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.business_name, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
  )
    .bind(token)
    .first<{ id: number; email: string; business_name: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await destroySession(env, token);
    return null;
  }
  return {
    token,
    user: { id: row.id, email: row.email, business_name: row.business_name },
  };
};

export const purgeExpiredSessions = async (env: Env) => {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?')
    .bind(Date.now())
    .run();
};
