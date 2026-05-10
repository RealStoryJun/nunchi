import { Env, ok, err, UserRow } from './types';
import {
  hashPassword,
  verifyPassword,
  validateEmail,
  validatePassword,
} from './crypto';
import {
  createSession,
  destroySession,
  sessionCookie,
  clearCookie,
  getSessionUser,
} from './session';

const safeJson = async <T>(req: Request): Promise<T | null> => {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
};

const normalizeAnswer = (s: string) => s.trim().toLowerCase();

export const handleAuth = async (
  request: Request,
  env: Env,
  path: string,
): Promise<Response> => {
  // POST /api/auth/signup
  if (path === '/signup' && request.method === 'POST') {
    const body = await safeJson<{
      email: string;
      password: string;
      businessName: string;
      recoveryQuestion: string;
      recoveryAnswer: string;
    }>(request);
    if (!body) return err('잘못된 요청입니다.');
    const email = body.email?.trim().toLowerCase();
    const businessName = body.businessName?.trim();
    const recoveryQuestion = body.recoveryQuestion?.trim();
    const recoveryAnswer = body.recoveryAnswer;
    if (!email || !validateEmail(email)) return err('이메일 형식이 올바르지 않습니다.');
    const pwErr = validatePassword(body.password ?? '');
    if (pwErr) return err(pwErr);
    if (!businessName) return err('가게 이름을 입력해주세요.');
    if (!recoveryQuestion) return err('보안질문을 입력해주세요.');
    if (!recoveryAnswer || recoveryAnswer.trim().length < 1)
      return err('보안질문 답변을 입력해주세요.');

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first();
    if (existing) return err('이미 가입된 이메일입니다.');

    const passwordHash = await hashPassword(body.password);
    const answerHash = await hashPassword(normalizeAnswer(recoveryAnswer));
    const now = Date.now();
    const result = await env.DB.prepare(
      `INSERT INTO users (email, password_hash, business_name, recovery_question, recovery_answer_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(email, passwordHash, businessName, recoveryQuestion, answerHash, now)
      .run();
    const userId = Number(result.meta.last_row_id);
    const { token, expiresAt } = await createSession(env, userId);
    return ok(
      { user: { id: userId, email, business_name: businessName } },
      { headers: { 'set-cookie': sessionCookie(token, expiresAt) } },
    );
  }

  // POST /api/auth/login
  if (path === '/login' && request.method === 'POST') {
    const body = await safeJson<{ email: string; password: string }>(request);
    if (!body) return err('잘못된 요청입니다.');
    const email = body.email?.trim().toLowerCase();
    if (!email || !body.password) return err('이메일과 비밀번호를 입력해주세요.');
    const user = await env.DB.prepare(
      'SELECT id, email, password_hash, business_name FROM users WHERE email = ?',
    )
      .bind(email)
      .first<Pick<UserRow, 'id' | 'email' | 'password_hash' | 'business_name'>>();
    if (!user) return err('이메일 또는 비밀번호가 일치하지 않습니다.', 401);
    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) return err('이메일 또는 비밀번호가 일치하지 않습니다.', 401);
    const { token, expiresAt } = await createSession(env, user.id);
    return ok(
      { user: { id: user.id, email: user.email, business_name: user.business_name } },
      { headers: { 'set-cookie': sessionCookie(token, expiresAt) } },
    );
  }

  // POST /api/auth/logout
  if (path === '/logout' && request.method === 'POST') {
    const session = await getSessionUser(request, env);
    if (session) await destroySession(env, session.token);
    return ok({}, { headers: { 'set-cookie': clearCookie() } });
  }

  // POST /api/auth/recover/start
  if (path === '/recover/start' && request.method === 'POST') {
    const body = await safeJson<{ email: string }>(request);
    if (!body?.email) return err('이메일을 입력해주세요.');
    const email = body.email.trim().toLowerCase();
    const row = await env.DB.prepare(
      'SELECT recovery_question FROM users WHERE email = ?',
    )
      .bind(email)
      .first<{ recovery_question: string }>();
    if (!row) return err('등록된 이메일이 아닙니다.', 404);
    return ok({ recoveryQuestion: row.recovery_question });
  }

  // POST /api/auth/recover/verify
  if (path === '/recover/verify' && request.method === 'POST') {
    const body = await safeJson<{
      email: string;
      answer: string;
      newPassword: string;
    }>(request);
    if (!body?.email || !body.answer || !body.newPassword)
      return err('필수 항목이 누락되었습니다.');
    const pwErr = validatePassword(body.newPassword);
    if (pwErr) return err(pwErr);
    const email = body.email.trim().toLowerCase();
    const row = await env.DB.prepare(
      'SELECT id, recovery_answer_hash FROM users WHERE email = ?',
    )
      .bind(email)
      .first<{ id: number; recovery_answer_hash: string }>();
    if (!row) return err('등록된 이메일이 아닙니다.', 404);
    const valid = await verifyPassword(
      normalizeAnswer(body.answer),
      row.recovery_answer_hash,
    );
    if (!valid) return err('답변이 일치하지 않습니다.', 401);
    const newHash = await hashPassword(body.newPassword);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(newHash, row.id)
      .run();
    // 모든 세션 무효화
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id).run();
    return ok({});
  }

  // GET /api/me — 현재 사용자
  if (path === '/me' && request.method === 'GET') {
    const session = await getSessionUser(request, env);
    if (!session) return err('로그인이 필요합니다.', 401);
    return ok({ user: session.user });
  }

  return err('찾을 수 없는 경로입니다.', 404);
};
