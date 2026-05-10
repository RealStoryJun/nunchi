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
import {
  checkRateLimit,
  recordAttempt,
  resetAttempts,
  tooMany,
} from './ratelimit';

const safeJson = async <T>(req: Request): Promise<T | null> => {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
};

const normalizeAnswer = (s: string) => s.trim().toLowerCase();

// 등록 안 된 이메일에 대해서도 결정적 fake 질문을 반환해 enumeration 방지.
// 실제로 사용자가 등록 시 직접 작성한 질문일 수도 있으므로, fake는 PRESET 중 하나로 선택.
const FAKE_QUESTIONS = [
  '어릴 때 키운 첫 반려동물 이름은?',
  '내 인생 최고의 여행지는?',
  '초등학교 단짝의 이름은?',
  '내가 자주 가던 분식집 이름은?',
];
const fakeQuestionFor = async (email: string): Promise<string> => {
  const data = new TextEncoder().encode(`nunchi-fakeQ:${email.toLowerCase()}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const idx = new Uint8Array(hash)[0] % FAKE_QUESTIONS.length;
  return FAKE_QUESTIONS[idx];
};

// dummy hash — 등록 안 된 이메일에 verify 호출됐을 때 timing 균형 맞추기용.
// 모듈 로드 시 한 번 생성 (각 워커 인스턴스에서 1회).
let _dummyHash: Promise<string> | null = null;
const getDummyHash = (): Promise<string> => {
  if (!_dummyHash) _dummyHash = hashPassword('dummy-not-a-real-password');
  return _dummyHash;
};

const RATE_LOGIN_MAX = 8;
const RATE_LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15분
const RATE_RECOVER_MAX = 5;
const RATE_RECOVER_WINDOW_MS = 30 * 60 * 1000; // 30분

const clientIp = (req: Request): string =>
  req.headers.get('cf-connecting-ip') ||
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
  'unknown';

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
    if (!email || !validateEmail(email))
      return err('이메일 형식이 올바르지 않습니다.');
    const pwErr = validatePassword(body.password ?? '');
    if (pwErr) return err(pwErr);
    if (!businessName) return err('가게 이름을 입력해주세요.');
    if (!recoveryQuestion) return err('보안질문을 입력해주세요.');
    if (!recoveryAnswer || recoveryAnswer.trim().length < 1)
      return err('보안질문 답변을 입력해주세요.');

    // IP 기반 rate limit (가입 봇 방어)
    const ipKey = `signup-ip:${clientIp(request)}`;
    const ipRl = await checkRateLimit(env, ipKey, 10, 60 * 60 * 1000);
    if (!ipRl.ok) return tooMany(ipRl.retryAfterMs);

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first();
    if (existing) {
      await recordAttempt(env, ipKey);
      return err('이미 가입된 이메일입니다.');
    }

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
    if (!email || !body.password)
      return err('이메일과 비밀번호를 입력해주세요.');

    // 이메일 단위 rate limit
    const emailKey = `login:${email}`;
    const ipKey = `login-ip:${clientIp(request)}`;
    const [emailRl, ipRl] = await Promise.all([
      checkRateLimit(env, emailKey, RATE_LOGIN_MAX, RATE_LOGIN_WINDOW_MS),
      checkRateLimit(env, ipKey, RATE_LOGIN_MAX * 4, RATE_LOGIN_WINDOW_MS),
    ]);
    if (!emailRl.ok) return tooMany(emailRl.retryAfterMs);
    if (!ipRl.ok) return tooMany(ipRl.retryAfterMs);

    const user = await env.DB.prepare(
      'SELECT id, email, password_hash, business_name FROM users WHERE email = ?',
    )
      .bind(email)
      .first<Pick<UserRow, 'id' | 'email' | 'password_hash' | 'business_name'>>();
    // 사용자 존재 여부와 무관하게 PBKDF2 한 번 돌려서 timing 균형
    const stored = user?.password_hash ?? (await getDummyHash());
    const valid = await verifyPassword(body.password, stored);
    if (!user || !valid) {
      await Promise.all([
        recordAttempt(env, emailKey),
        recordAttempt(env, ipKey),
      ]);
      return err('이메일 또는 비밀번호가 일치하지 않습니다.', 401);
    }
    // 성공 시 카운터 리셋 (이메일 한정 — IP는 다른 계정 시도 누적 유지)
    await resetAttempts(env, emailKey);
    const { token, expiresAt } = await createSession(env, user.id);
    return ok(
      {
        user: {
          id: user.id,
          email: user.email,
          business_name: user.business_name,
        },
      },
      { headers: { 'set-cookie': sessionCookie(token, expiresAt) } },
    );
  }

  // POST /api/auth/logout
  if (path === '/logout' && request.method === 'POST') {
    const session = await getSessionUser(request, env);
    if (session) await destroySession(env, session.token);
    return ok({}, { headers: { 'set-cookie': clearCookie() } });
  }

  // POST /api/auth/recover/start — 항상 200 + 질문 반환 (등록 여부 노출 안 함)
  if (path === '/recover/start' && request.method === 'POST') {
    const body = await safeJson<{ email: string }>(request);
    if (!body?.email) return err('이메일을 입력해주세요.');
    const email = body.email.trim().toLowerCase();
    if (!validateEmail(email)) return err('이메일 형식이 올바르지 않습니다.');

    const ipKey = `recover-start-ip:${clientIp(request)}`;
    const ipRl = await checkRateLimit(env, ipKey, 20, RATE_RECOVER_WINDOW_MS);
    if (!ipRl.ok) return tooMany(ipRl.retryAfterMs);
    await recordAttempt(env, ipKey);

    const row = await env.DB.prepare(
      'SELECT recovery_question FROM users WHERE email = ?',
    )
      .bind(email)
      .first<{ recovery_question: string }>();
    const question = row?.recovery_question ?? (await fakeQuestionFor(email));
    return ok({ recoveryQuestion: question });
  }

  // POST /api/auth/recover/verify — 응답 + timing 통일
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

    const emailKey = `recover:${email}`;
    const ipKey = `recover-ip:${clientIp(request)}`;
    const [emailRl, ipRl] = await Promise.all([
      checkRateLimit(env, emailKey, RATE_RECOVER_MAX, RATE_RECOVER_WINDOW_MS),
      checkRateLimit(env, ipKey, RATE_RECOVER_MAX * 4, RATE_RECOVER_WINDOW_MS),
    ]);
    if (!emailRl.ok) return tooMany(emailRl.retryAfterMs);
    if (!ipRl.ok) return tooMany(ipRl.retryAfterMs);

    const row = await env.DB.prepare(
      'SELECT id, recovery_answer_hash FROM users WHERE email = ?',
    )
      .bind(email)
      .first<{ id: number; recovery_answer_hash: string }>();
    // 등록 안 된 이메일도 PBKDF2 한 번 돌려서 timing 균형
    const stored = row?.recovery_answer_hash ?? (await getDummyHash());
    const valid = await verifyPassword(normalizeAnswer(body.answer), stored);
    if (!row || !valid) {
      await Promise.all([
        recordAttempt(env, emailKey),
        recordAttempt(env, ipKey),
      ]);
      return err('답변이 일치하지 않습니다.', 401);
    }
    const newHash = await hashPassword(body.newPassword);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(newHash, row.id)
      .run();
    // 모든 세션 무효화 + 카운터 리셋
    await Promise.all([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id).run(),
      resetAttempts(env, emailKey),
      resetAttempts(env, `login:${email}`),
    ]);
    return ok({});
  }

  // GET /api/me
  if (path === '/me' && request.method === 'GET') {
    const session = await getSessionUser(request, env);
    if (!session) return err('로그인이 필요합니다.', 401);
    return ok({ user: session.user });
  }

  return err('찾을 수 없는 경로입니다.', 404);
};
