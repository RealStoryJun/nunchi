// TOTP (RFC 6238) - Cloudflare Workers 네이티브 (crypto.subtle, 외부 의존 0).
// 30s step, 6자리 코드, HMAC-SHA1. drift window ±1 step.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// 5-bit groups → base32 RFC 4648
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// 20바이트(160bit) 시크릿 - RFC 4226 권장
export function generateSecret(): string {
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}

// 8자리 hex × N개. UI 표시: a1b2-c3d4 형태로 그룹화는 클라가 처리.
export function generateBackupCodes(n = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    let hex = '';
    for (const b of buf) hex += b.toString(16).padStart(2, '0');
    codes.push(hex);
  }
  return codes;
}

// 32-bit 빅엔디안 카운터를 8바이트로 (앞 4 = 0).
function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // counter는 step이라 2^32 안 - 안전하게 high bits 0
  buf[4] = (counter >>> 24) & 0xff;
  buf[5] = (counter >>> 16) & 0xff;
  buf[6] = (counter >>> 8) & 0xff;
  buf[7] = counter & 0xff;
  return buf;
}

async function hmacSha1(keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  // BufferSource로 명시 (Cloudflare Workers TS 타입)
  const keyBuf = new Uint8Array(keyBytes).buffer;
  const msgBuf = new Uint8Array(msg).buffer;
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, msgBuf);
  return new Uint8Array(sig);
}

// RFC 6238: dynamic truncation → 6자리 모듈로 1_000_000.
async function totpForCounter(secret: string, counter: number): Promise<string> {
  const key = base32Decode(secret);
  const hmac = await hmacSha1(key, counterBytes(counter));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
}

// drift=1 → 현재 step ± 1 (즉 ±30초) 허용.
export async function verifyTotp(
  secret: string,
  code: string,
  now = Date.now(),
  drift = 1,
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now / 30_000);
  for (let d = -drift; d <= drift; d++) {
    const expected = await totpForCounter(secret, step + d);
    // 상수 시간 비교
    if (expected.length !== code.length) continue;
    let diff = 0;
    for (let i = 0; i < code.length; i++) diff |= expected.charCodeAt(i) ^ code.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}

// otpauth:// URL - Authenticator 앱이 QR 스캔해서 등록
export function otpauthUrl(secret: string, email: string, issuer = 'Nunchi'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
