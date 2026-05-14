import { Env, ok, err, UserRow } from './types';
import {
  hashPassword,
  verifyPassword,
  validateEmail,
  validatePassword,
  randomToken,
  encryptTotpSecret,
  decryptTotpSecret,
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

// 새 IP/UA 첫 로그인 감지 → audit + user_login_events INSERT. 비동기 fire-and-forget.
// 90일 보관 (cron 정리). 같은 IP+UA가 그 user에 있었으면 is_new_device=0, 처음이면 1.
const logLoginEvent = async (
  env: Env,
  userId: number,
  request: Request,
): Promise<void> => {
  try {
    const ip = request.headers.get('cf-connecting-ip') ?? null;
    const ua = (request.headers.get('user-agent') ?? '').slice(0, 200);
    // 90일 안 같은 (ip, ua) 본 적 있는지 — 없으면 새 디바이스
    const SEEN_WINDOW = 90 * 24 * 60 * 60 * 1000;
    const seen = await env.DB.prepare(
      `SELECT 1 FROM user_login_events
       WHERE user_id = ? AND ip IS ? AND ua = ? AND at > ?
       LIMIT 1`,
    )
      .bind(userId, ip, ua, Date.now() - SEEN_WINDOW)
      .first();
    const isNew = seen ? 0 : 1;
    await env.DB.prepare(
      `INSERT INTO user_login_events (user_id, ip, ua, is_new_device, at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(userId, ip, ua, isNew, Date.now())
      .run();
  } catch {
    /* 로그 실패는 본 응답 안 막음 */
  }
};

// Cloudflare Turnstile 검증 — 봇 가입 차단. 토큰 없거나 검증 실패면 false.
// TURNSTILE_SECRET 미설정 시 항상 true (graceful degradation — 키 박기 전엔 가입 그대로 작동).
const verifyTurnstile = async (env: Env, token: string | undefined, ip: string | null): Promise<boolean> => {
  if (!env.TURNSTILE_SECRET) return true; // 미설정 시 통과
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', token);
    if (ip) form.append('remoteip', ip);
    // 5초 timeout — Cloudflare siteverify 응답 지연 시 가입 행성 hang 회피
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
};

export const handleAuth = async (
  request: Request,
  env: Env,
  path: string,
  ctx?: ExecutionContext,
): Promise<Response> => {
  // GET /api/auth/turnstile/config — 클라가 widget 렌더링용 site_key 받음. site_key 없으면 widget 안 띄움.
  if (path === '/turnstile/config' && request.method === 'GET') {
    return ok({ site_key: env.TURNSTILE_SITE_KEY ?? null });
  }

  // POST /api/auth/signup
  if (path === '/signup' && request.method === 'POST') {
    const body = await safeJson<{
      email: string;
      password: string;
      businessName: string;
      recoveryQuestion: string;
      recoveryAnswer: string;
      turnstile_token?: string;
    }>(request);
    if (!body) return err('잘못된 요청입니다.');
    // Turnstile 검증 — TURNSTILE_SECRET 설정돼 있을 때만 실제 검증, 그 전엔 자동 통과
    const turnstileOk = await verifyTurnstile(
      env,
      body.turnstile_token,
      request.headers.get('cf-connecting-ip'),
    );
    if (!turnstileOk) return err('봇 검증에 실패했어요. 새로고침 후 다시 시도해주세요.');
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

    // IP 기반 rate limit (가입 봇 방어) — 시도 자체에 카운터 ↑ (unique email 봇이 우회 못 하게).
    // Turnstile graceful degradation 상태(secret 미설정)에서도 IP 단위 봇 차단을 보장.
    const ipKey = `signup-ip:${clientIp(request)}`;
    const ipRl = await checkRateLimit(env, ipKey, 10, 60 * 60 * 1000);
    if (!ipRl.ok) return tooMany(ipRl.retryAfterMs);
    await recordAttempt(env, ipKey);

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first();
    if (existing) {
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
    // 신규 가입 device도 user_login_events에 기록 (login 흐름과 동일 패턴)
    if (ctx) ctx.waitUntil(logLoginEvent(env, userId, request));
    else void logLoginEvent(env, userId, request);
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
    // 2FA 활성 (setup 완료, totp_enabled_at NOT NULL) → 세션 발급 X. 10분 mfa_token만 발급.
    // (secret 자체는 mfa_token 검증 단계에서 복호화. 1단계에선 존재 여부만 확인.)
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

    // 2FA 비활성 — 기존 흐름. 이메일 카운터 리셋 + 같은 user 기존 세션 invalidate + 새 세션 발급.
    await Promise.all([
      resetAttempts(env, emailKey),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run(),
    ]);
    const { token, expiresAt } = await createSession(env, user.id);
    // fire-and-forget — 응답 안 막음. ctx.waitUntil로 워커 종료 후에도 완료 보장.
    if (ctx) ctx.waitUntil(logLoginEvent(env, user.id, request));
    else void logLoginEvent(env, user.id, request);
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
    // 사용자 단위 rate-limit — 토큰 갈아끼우는 brute force 차단 (20/시간/유저)
    const mfaUserKey = `mfa-user:${pending.user_id}`;
    const userRl = await checkRateLimit(env, mfaUserKey, 20, 60 * 60 * 1000);
    if (!userRl.ok) return tooMany(userRl.retryAfterMs);

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
    // 1) TOTP 6자리 검증 — secret을 worker key로 복호화 (평문 fallback 호환)
    if (/^\d{6}$/.test(code)) {
      const secret = await decryptTotpSecret(u.totp_secret, env.TOTP_SECRET_KEY);
      if (secret) {
        pass = await verifyTotp(secret, code);
        // 마이그레이션: 평문 base32 저장본을 envelope 암호화로 자동 업그레이드 (키 설정 후 첫 로그인 시).
        // enc === secret이면 키 설정 무효(잘못된 길이 등) — no-op UPDATE 회피.
        if (pass && env.TOTP_SECRET_KEY && !u.totp_secret.startsWith('v1.')) {
          const enc = await encryptTotpSecret(secret, env.TOTP_SECRET_KEY);
          if (enc !== secret) {
            ctx?.waitUntil(
              env.DB.prepare('UPDATE users SET totp_secret = ? WHERE id = ?')
                .bind(enc, u.id).run().then(() => undefined),
            );
          }
        }
      }
    }
    // 2) 백업코드 8자리 hex 검증 (1회용). atomic UPDATE으로 race-safe.
    if (!pass && /^[a-f0-9]{8}$/i.test(code) && u.totp_backup_codes_hash) {
      try {
        const hashes = JSON.parse(u.totp_backup_codes_hash) as string[];
        let matchedHash: string | null = null;
        for (const h of hashes) {
          if (await verifyPassword(code.toLowerCase(), h)) { matchedHash = h; break; }
        }
        if (matchedHash) {
          // SQLite JSON1 — 매칭된 hash와 다른 값만 남기는 atomic UPDATE.
          // WHERE EXISTS(matchedHash) 가드로 race-safe — 이미 다른 요청이 그 hash 제거했으면 changes=0.
          // (SQLite UPDATE changes는 "touched rows"라 EXISTS 가드 없으면 idempotent UPDATE도 changes=1 반환 → race fail.)
          const r = await env.DB.prepare(
            `UPDATE users
             SET totp_backup_codes_hash = (
               SELECT json_group_array(j.value) FROM json_each(totp_backup_codes_hash) AS j WHERE j.value != ?
             )
             WHERE id = ?
               AND EXISTS (SELECT 1 FROM json_each(totp_backup_codes_hash) WHERE value = ?)`,
          )
            .bind(matchedHash, u.id, matchedHash)
            .run();
          if (r.meta.changes > 0) pass = true;
        }
      } catch {
        /* JSON parse 실패면 pass=false */
      }
    }

    if (!pass) {
      await recordAttempt(env, mfaKey);
      return err('인증 코드가 일치하지 않아요.', 401);
    }

    // 성공 — auth_pending 정리, 기존 세션 invalidate, 새 세션 발급. 모든 rate-limit 카운터 리셋.
    await Promise.all([
      env.DB.prepare('DELETE FROM auth_pending WHERE token = ?').bind(body.mfa_token).run(),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run(),
      resetAttempts(env, mfaKey),
      resetAttempts(env, mfaUserKey),
      resetAttempts(env, `login:${u.email}`),
    ]);
    const { token, expiresAt } = await createSession(env, u.id);
    if (ctx) ctx.waitUntil(logLoginEvent(env, u.id, request));
    else void logLoginEvent(env, u.id, request);
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

  // POST /api/auth/2fa/setup/start — 인증된 사용자가 비밀번호 재확인 → secret + QR URL 반환.
  // 이미 활성화된 2FA는 setup/start로 못 덮어씀 (silently 비활성화 우회 차단 — disable 먼저 필요).
  // 세션 탈취 시 비밀번호 brute-force 방어 — pwd-confirm:userId rate-limit.
  // 같은 setup 중 재호출은 기존 미활성 secret 그대로 반환 (overwrite 회피, 사장님 첫 QR 그대로 사용 가능).
  if (path === '/2fa/setup/start' && request.method === 'POST') {
    const session = await getSessionUser(request, env);
    if (!session) return err('로그인이 필요합니다.', 401);
    const body = await safeJson<{ password: string }>(request);
    if (!body?.password) return err('비밀번호를 입력해주세요.');
    const rlKey = `pwd-confirm:${session.user.id}`;
    const rl = await checkRateLimit(env, rlKey, 5, 15 * 60 * 1000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    const row = await env.DB.prepare(
      'SELECT password_hash, totp_secret, totp_enabled_at FROM users WHERE id = ?',
    )
      .bind(session.user.id)
      .first<{ password_hash: string; totp_secret: string | null; totp_enabled_at: number | null }>();
    if (!row || !(await verifyPassword(body.password, row.password_hash))) {
      await recordAttempt(env, rlKey);
      return err('비밀번호가 일치하지 않습니다.', 401);
    }
    if (row.totp_enabled_at) {
      return err('이미 2단계 인증이 켜져 있어요. 끄기를 먼저 진행해주세요.');
    }
    await resetAttempts(env, rlKey);
    // 미활성 secret 이미 있으면 재사용 — 사장님이 첫 QR 스캔 후 retry해도 같은 secret
    // 저장은 envelope 암호화 형식, 응답엔 평문 base32 (QR/수동 입력용)
    let secretPlain: string;
    if (row.totp_secret) {
      secretPlain = await decryptTotpSecret(row.totp_secret, env.TOTP_SECRET_KEY);
      if (!secretPlain) {
        // 복호화 실패 (키 분실 등) — 새 secret로 재시작
        secretPlain = generateSecret();
        const enc = await encryptTotpSecret(secretPlain, env.TOTP_SECRET_KEY);
        await env.DB.prepare(
          'UPDATE users SET totp_secret = ?, totp_enabled_at = NULL WHERE id = ?',
        ).bind(enc, session.user.id).run();
      }
    } else {
      secretPlain = generateSecret();
      const enc = await encryptTotpSecret(secretPlain, env.TOTP_SECRET_KEY);
      await env.DB.prepare(
        'UPDATE users SET totp_secret = ?, totp_enabled_at = NULL WHERE id = ?',
      ).bind(enc, session.user.id).run();
    }
    return ok({
      secret: secretPlain,
      otpauth_url: otpauthUrl(secretPlain, session.user.email),
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
    const secretPlain = await decryptTotpSecret(row.totp_secret, env.TOTP_SECRET_KEY);
    if (!secretPlain || !(await verifyTotp(secretPlain, body.code.trim()))) {
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
  // pwd-confirm:userId rate-limit으로 세션 탈취 시 비번 brute-force 방어
  if (path === '/2fa/disable' && request.method === 'POST') {
    const session = await getSessionUser(request, env);
    if (!session) return err('로그인이 필요합니다.', 401);
    const body = await safeJson<{ password: string; code: string }>(request);
    if (!body?.password || !body?.code) return err('비밀번호와 인증 코드를 입력해주세요.');
    const rlKey = `pwd-confirm:${session.user.id}`;
    const rl = await checkRateLimit(env, rlKey, 5, 15 * 60 * 1000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    const row = await env.DB.prepare(
      'SELECT password_hash, totp_secret FROM users WHERE id = ?',
    )
      .bind(session.user.id)
      .first<{ password_hash: string; totp_secret: string | null }>();
    if (!row?.totp_secret) return err('2단계 인증이 활성화되어 있지 않아요.');
    const pwOk = await verifyPassword(body.password, row.password_hash);
    const secretPlain = await decryptTotpSecret(row.totp_secret, env.TOTP_SECRET_KEY);
    const codeOk = secretPlain ? await verifyTotp(secretPlain, body.code.trim()) : false;
    if (!pwOk || !codeOk) {
      await recordAttempt(env, rlKey);
      return err('비밀번호 또는 코드가 일치하지 않아요.', 401);
    }
    await Promise.all([
      env.DB.prepare(
        'UPDATE users SET totp_secret = NULL, totp_backup_codes_hash = NULL, totp_enabled_at = NULL WHERE id = ?',
      ).bind(session.user.id).run(),
      resetAttempts(env, rlKey),
    ]);
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
