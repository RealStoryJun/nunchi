import { Env, ok, err, UserRow } from './types';
import {
  hashPassword,
  verifyPassword,
  validateEmail,
  validatePassword,
  randomToken,
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
import {
  generateSecret,
  generateBackupCodes,
  verifyTotp,
  otpauthUrl,
} from './totp';

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
    // 복구 답변 최소 4자 — brute force 공간 확보 (rate-limit 5/30min과 합쳐 방어)
    if (!recoveryAnswer || recoveryAnswer.trim().length < 4)
      return err('보안질문 답변은 4자 이상 입력해주세요.');

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
      {
        user: {
          id: userId,
          email,
          business_name: businessName,
          business_type: null,
          is_admin: false,
          mfa_enabled: false,
        },
      },
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
      'SELECT id, email, password_hash, business_name, business_type, is_admin, totp_secret, totp_enabled_at FROM users WHERE email = ?',
    )
      .bind(email)
      .first<
        Pick<
          UserRow,
          | 'id'
          | 'email'
          | 'password_hash'
          | 'business_name'
          | 'business_type'
          | 'is_admin'
        > & { totp_secret: string | null; totp_enabled_at: number | null }
      >();
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
    // 1단계 통과 — 이메일 카운터 리셋
    await resetAttempts(env, emailKey);

    // 2FA 활성 (setup 완료, totp_enabled_at NOT NULL) → 세션 발급 X. 10분 mfa_token만 발급.
    // setup/start 후 confirm 안 한 사용자(secret만 박힘)는 mfa_required 트리거 X — 일반 로그인.
    if (user.totp_secret && user.totp_enabled_at) {
      const mfaToken = randomToken();
      const expiresAt = Date.now() + 10 * 60 * 1000;
      await env.DB.prepare(
        'INSERT INTO auth_pending (token, user_id, expires_at) VALUES (?, ?, ?)',
      )
        .bind(mfaToken, user.id, expiresAt)
        .run();
      return ok({
        mfa_required: true,
        mfa_token: mfaToken,
        expires_in_sec: 600,
      });
    }

    // 2FA 비활성 — 기존 흐름. 같은 user 기존 세션 invalidate 후 새 세션 발급.
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
    const { token, expiresAt } = await createSession(env, user.id);
    return ok(
      {
        user: {
          id: user.id,
          email: user.email,
          business_name: user.business_name,
          business_type: user.business_type,
          is_admin: !!user.is_admin,
          mfa_enabled: false,
        },
      },
      { headers: { 'set-cookie': sessionCookie(token, expiresAt) } },
    );
  }

  // POST /api/auth/login/mfa — 2단계: mfa_token + TOTP code 또는 백업코드
  if (path === '/login/mfa' && request.method === 'POST') {
    const body = await safeJson<{ mfa_token: string; code: string }>(request);
    if (!body?.mfa_token || !body?.code) return err('잘못된 요청입니다.');
    const mfaKey = `mfa:${body.mfa_token.slice(0, 16)}`; // 토큰 prefix 기반 rate-limit
    const mfaRl = await checkRateLimit(env, mfaKey, 6, 15 * 60 * 1000);
    if (!mfaRl.ok) return tooMany(mfaRl.retryAfterMs);

    const pending = await env.DB.prepare(
      'SELECT token, user_id, expires_at FROM auth_pending WHERE token = ?',
    )
      .bind(body.mfa_token)
      .first<{ token: string; user_id: number; expires_at: number }>();
    if (!pending || pending.expires_at < Date.now()) {
      await recordAttempt(env, mfaKey);
      return err('인증이 만료되었어요. 다시 로그인해주세요.', 401);
    }

    const u = await env.DB.prepare(
      'SELECT id, email, business_name, business_type, is_admin, totp_secret, totp_backup_codes_hash FROM users WHERE id = ?',
    )
      .bind(pending.user_id)
      .first<{
        id: number;
        email: string;
        business_name: string;
        business_type: string | null;
        is_admin: number;
        totp_secret: string | null;
        totp_backup_codes_hash: string | null;
      }>();
    if (!u || !u.totp_secret) {
      // 사용자 또는 2FA 사라짐 — auth_pending 정리하고 401
      await env.DB.prepare('DELETE FROM auth_pending WHERE token = ?').bind(body.mfa_token).run();
      return err('인증 정보를 찾을 수 없어요. 다시 로그인해주세요.', 401);
    }

    const code = body.code.trim().replace(/[\s-]/g, ''); // 공백·하이픈 제거 (백업코드 a1b2-c3d4 입력 호환)
    let pass = false;
    // 1) TOTP 6자리 검증
    if (/^\d{6}$/.test(code)) {
      pass = await verifyTotp(u.totp_secret, code);
    }
    // 2) 백업코드 8자리 hex 검증 (1회용)
    if (!pass && /^[a-f0-9]{8}$/i.test(code) && u.totp_backup_codes_hash) {
      try {
        const hashes = JSON.parse(u.totp_backup_codes_hash) as string[];
        for (let i = 0; i < hashes.length; i++) {
          if (await verifyPassword(code.toLowerCase(), hashes[i])) {
            // 매칭된 코드 hash 제거 (1회용)
            const remaining = hashes.filter((_, j) => j !== i);
            await env.DB.prepare(
              'UPDATE users SET totp_backup_codes_hash = ? WHERE id = ?',
            )
              .bind(JSON.stringify(remaining), u.id)
              .run();
            pass = true;
            break;
          }
        }
      } catch {
        /* JSON parse 실패면 pass=false */
      }
    }

    if (!pass) {
      await recordAttempt(env, mfaKey);
      return err('인증 코드가 일치하지 않아요.', 401);
    }

    // 성공 — auth_pending 정리, 기존 세션 invalidate, 새 세션 발급
    await Promise.all([
      env.DB.prepare('DELETE FROM auth_pending WHERE token = ?').bind(body.mfa_token).run(),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run(),
      resetAttempts(env, mfaKey),
    ]);
    const { token, expiresAt } = await createSession(env, u.id);
    return ok(
      {
        user: {
          id: u.id,
          email: u.email,
          business_name: u.business_name,
          business_type: u.business_type,
          is_admin: !!u.is_admin,
          mfa_enabled: true,
        },
      },
      { headers: { 'set-cookie': sessionCookie(token, expiresAt) } },
    );
  }

  // POST /api/auth/2fa/setup/start — 인증된 사용자가 비밀번호 재확인 → secret + QR URL 반환 (DB 저장 X)
  if (path === '/2fa/setup/start' && request.method === 'POST') {
    const session = await getSessionUser(request, env);
    if (!session) return err('로그인이 필요합니다.', 401);
    const body = await safeJson<{ password: string }>(request);
    if (!body?.password) return err('비밀번호를 입력해주세요.');
    const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(session.user.id)
      .first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(body.password, row.password_hash))) {
      return err('비밀번호가 일치하지 않습니다.', 401);
    }
    const secret = generateSecret();
    // 임시 secret을 sessions 행에 잠시 보관 (10분 — 그 안에 confirm 안 하면 폐기)
    await env.DB.prepare(
      'UPDATE sessions SET admin_verified_until = ? WHERE token = ?',
    )
      .bind(Date.now() + 10 * 60 * 1000, session.token)
      .run();
    // setup 캐시 — auth_pending 재사용 (token=session, user_id=user)
    await env.DB.prepare(
      'INSERT OR REPLACE INTO auth_pending (token, user_id, expires_at) VALUES (?, ?, ?)',
    )
      .bind(`setup:${session.token}`, session.user.id, Date.now() + 10 * 60 * 1000)
      .run();
    // secret을 임시 어디 저장? — auth_pending.token 컬럼에 prefix로 stash (저장은 setup 캐시 record로)
    // 단순화: 클라가 secret을 들고 있다가 confirm 때 같이 보냄. 단 신뢰 못 함이라 server-side stash 필요.
    // → users.totp_secret에 직접 저장하되 totp_enabled_at=NULL이면 미활성 표식으로 처리.
    await env.DB.prepare(
      'UPDATE users SET totp_secret = ?, totp_enabled_at = NULL WHERE id = ?',
    )
      .bind(secret, session.user.id)
      .run();
    return ok({
      secret,
      otpauth_url: otpauthUrl(secret, session.user.email),
    });
  }

  // POST /api/auth/2fa/setup/confirm — 6자리 코드 확인 → 활성화 + 백업코드 8개 반환
  if (path === '/2fa/setup/confirm' && request.method === 'POST') {
    const session = await getSessionUser(request, env);
    if (!session) return err('로그인이 필요합니다.', 401);
    const body = await safeJson<{ code: string }>(request);
    if (!body?.code || !/^\d{6}$/.test(body.code.trim()))
      return err('6자리 숫자 코드를 입력해주세요.');
    const row = await env.DB.prepare(
      'SELECT totp_secret, totp_enabled_at FROM users WHERE id = ?',
    )
      .bind(session.user.id)
      .first<{ totp_secret: string | null; totp_enabled_at: number | null }>();
    if (!row?.totp_secret) return err('먼저 인증 설정을 시작해주세요.');
    if (!(await verifyTotp(row.totp_secret, body.code.trim()))) {
      return err('인증 코드가 일치하지 않아요.', 401);
    }
    // 백업코드 생성 → hash 저장 + 평문 응답
    const codes = generateBackupCodes(8);
    const hashes = await Promise.all(codes.map((c) => hashPassword(c)));
    await env.DB.prepare(
      'UPDATE users SET totp_enabled_at = ?, totp_backup_codes_hash = ? WHERE id = ?',
    )
      .bind(Date.now(), JSON.stringify(hashes), session.user.id)
      .run();
    return ok({ backup_codes: codes });
  }

  // POST /api/auth/2fa/disable — 비밀번호 + 현재 TOTP 코드 둘 다 검증 후 비활성
  if (path === '/2fa/disable' && request.method === 'POST') {
    const session = await getSessionUser(request, env);
    if (!session) return err('로그인이 필요합니다.', 401);
    const body = await safeJson<{ password: string; code: string }>(request);
    if (!body?.password || !body?.code) return err('비밀번호와 인증 코드를 입력해주세요.');
    const row = await env.DB.prepare(
      'SELECT password_hash, totp_secret FROM users WHERE id = ?',
    )
      .bind(session.user.id)
      .first<{ password_hash: string; totp_secret: string | null }>();
    if (!row?.totp_secret) return err('2단계 인증이 활성화되어 있지 않아요.');
    const pwOk = await verifyPassword(body.password, row.password_hash);
    const codeOk = await verifyTotp(row.totp_secret, body.code.trim());
    if (!pwOk || !codeOk) return err('비밀번호 또는 코드가 일치하지 않아요.', 401);
    await env.DB.prepare(
      'UPDATE users SET totp_secret = NULL, totp_backup_codes_hash = NULL, totp_enabled_at = NULL WHERE id = ?',
    )
      .bind(session.user.id)
      .run();
    return ok({ disabled: true });
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
    // 모든 세션 무효화 + 카운터 리셋 + 2FA 자동 해제 (디바이스 분실 fallback)
    await Promise.all([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id).run(),
      env.DB.prepare(
        'UPDATE users SET totp_secret = NULL, totp_backup_codes_hash = NULL, totp_enabled_at = NULL WHERE id = ?',
      ).bind(row.id).run(),
      resetAttempts(env, emailKey),
      resetAttempts(env, `login:${email}`),
    ]);
    return ok({});
  }

  // GET /api/me
  if (path === '/me' && request.method === 'GET') {
    const session = await getSessionUser(request, env);
    if (!session) return err('로그인이 필요합니다.', 401);
    // mfa_enabled 동기 조회 (session.user 캐시는 mfa 미포함)
    const row = await env.DB.prepare(
      'SELECT totp_enabled_at FROM users WHERE id = ?',
    )
      .bind(session.user.id)
      .first<{ totp_enabled_at: number | null }>();
    return ok({
      user: {
        ...session.user,
        mfa_enabled: !!row?.totp_enabled_at,
      },
    });
  }

  return err('찾을 수 없는 경로입니다.', 404);
};
