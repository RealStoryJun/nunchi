const ITER = 100_000;
const KEY_LEN = 32;
const SALT_LEN = 16;

const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

const fromB64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const derive = async (password: string, salt: Uint8Array) => {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    key,
    KEY_LEN * 8,
  );
  return new Uint8Array(bits);
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const hash = await derive(password, salt);
  return `${b64(salt)}$${b64(hash)}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [saltB64, hashB64] = stored.split('$');
  if (!saltB64 || !hashB64) return false;
  const salt = fromB64(saltB64);
  const expected = fromB64(hashB64);
  const actual = await derive(password, salt);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
};

export const randomToken = (): string => {
  const buf = crypto.getRandomValues(new Uint8Array(32));
  return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

export const validatePassword = (password: string): string | null => {
  if (password.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
    return '비밀번호는 영문과 숫자를 모두 포함해야 합니다.';
  return null;
};

export const validateEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ─── TOTP secret envelope encryption (AES-GCM) ─────────────────────────────────
// 워커 시크릿 TOTP_SECRET_KEY (32바이트 base64)로 envelope. D1 dump 시 secret 즉시 사용 불가.
// 형식: "v1.<ivB64>.<ctB64>" - v1 prefix로 마이그레이션 호환 (평문도 base32라 점·v1 없음으로 구분)
// 키 없으면 평문 fallback (개발 환경 또는 키 설정 전 사용자 보호).

const TOTP_VERSION = 'v1';
// key 값(base64)별 캐시 - 같은 isolate에서 같은 키 반복 import 회피.
// rotation 시 새 키 값으로 hit → 자동으로 새 CryptoKey 사용 (이전 키도 잔존하지만 isolate 재활용 시 GC).
const _totpKeyCache = new Map<string, Promise<CryptoKey | null>>();

const getTotpKey = (keyB64: string | undefined): Promise<CryptoKey | null> => {
  if (!keyB64) return Promise.resolve(null);
  const cached = _totpKeyCache.get(keyB64);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const raw = fromB64(keyB64);
      if (raw.length !== 32) return null; // AES-256 requires 32 bytes
      return await crypto.subtle.importKey(
        'raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
      );
    } catch {
      return null;
    }
  })();
  _totpKeyCache.set(keyB64, promise);
  return promise;
};

export const encryptTotpSecret = async (
  secret: string,
  keyB64: string | undefined,
): Promise<string> => {
  const key = await getTotpKey(keyB64);
  if (!key) return secret; // 키 없으면 평문 fallback
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret));
  return `${TOTP_VERSION}.${b64(iv)}.${b64(ct)}`;
};

export const decryptTotpSecret = async (
  stored: string,
  keyB64: string | undefined,
): Promise<string> => {
  // 평문 base32 (v1 prefix 없으면 - 마이그레이션 호환)
  if (!stored.startsWith(`${TOTP_VERSION}.`)) return stored;
  const key = await getTotpKey(keyB64);
  if (!key) {
    // 암호화된 상태인데 키 없으면 - 사장님이 키 분실. 빈 문자열로 반환 (TOTP 검증 자동 실패)
    return '';
  }
  const parts = stored.split('.');
  if (parts.length !== 3) return '';
  try {
    const iv = fromB64(parts[1]);
    const ct = fromB64(parts[2]);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return '';
  }
};
