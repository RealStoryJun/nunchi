// Web Push 발송 직접 구현 (2026-05-16 PR 3).
// 외부 의존성 0. RFC 8291 (encrypted payload) + RFC 8292 (VAPID) 직접 구현.
// 호출처: src/worker/admin.ts 의 /admin/push/send.
// Free tier 보호: 호출 측에서 50명씩 chunk + Promise.allSettled 로 묶을 것.

import type { Env } from './types';

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string; // base64url 인코딩된 65바이트 uncompressed P-256 public key
  auth: string;   // base64url 인코딩된 16바이트 auth secret
}

export interface PushPayload {
  title: string;    // 알림 제목
  body: string;     // 알림 본문
  url?: string;     // 클릭 시 이동할 path (기본 '/')
}

// ----- base64url 헬퍼 -----
const b64uEncode = (data: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uDecode = (s: string): Uint8Array => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

// ----- VAPID 키 파싱 -----
// VAPID_PUBLIC_KEY: base64url 인코딩된 65바이트 uncompressed P-256 point (0x04 || x || y)
// VAPID_PRIVATE_KEY: base64url 인코딩된 32바이트 raw d 값
const parseVapidKeys = (env: Env): { x: string; y: string; d: string; publicKeyB64u: string } => {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    throw new Error('VAPID 키 미설정 (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT 셋 다 필요)');
  }
  const pub = b64uDecode(env.VAPID_PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY 형식 오류 (65바이트 uncompressed P-256 point 여야)');
  }
  return {
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
    publicKeyB64u: env.VAPID_PUBLIC_KEY,
  };
};

// ----- VAPID JWT 생성 (RFC 8292 ES256) -----
const vapidJwt = async (audience: string, env: Env): Promise<string> => {
  const { x, y, d } = parseVapidKeys(env);
  const headerJson = JSON.stringify({ typ: 'JWT', alg: 'ES256' });
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12시간 TTL
  const payloadJson = JSON.stringify({ aud: audience, exp, sub: env.VAPID_SUBJECT });
  const enc = new TextEncoder();
  const header = b64uEncode(enc.encode(headerJson));
  const payload = b64uEncode(enc.encode(payloadJson));
  const signingInput = `${header}.${payload}`;

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d, ext: false },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(signingInput),
  );
  return `${signingInput}.${b64uEncode(new Uint8Array(sig))}`;
};

// ----- HKDF (RFC 5869) -----
const hkdfExpand = async (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
};

// ----- RFC 8291 페이로드 암호화 (aes128gcm) -----
// 입력: plaintext (JSON 문자열) + 사용자의 p256dh / auth
// 출력: 발송 본문 (salt || rs || idlen || keyid || ciphertext)
const encryptPayload = async (
  plaintext: Uint8Array,
  userPublicKeyB64u: string,
  authSecretB64u: string,
): Promise<{ body: Uint8Array; serverPublicKeyB64u: string }> => {
  // 1) 서버 임시 ECDH 키 페어 생성 (P-256). 매 발송마다 새로.
  const ephemeral = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair;
  const ephemeralPubRaw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer,
  );

  // 2) 사용자의 public key import
  const userPubRaw = b64uDecode(userPublicKeyB64u);
  const userPubKey = await crypto.subtle.importKey(
    'raw',
    userPubRaw as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // 3) ECDH로 shared secret 도출. workers-types 의 ECDH 타입 quirk 회피 (public → $public 강요됨)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ecdhParams: any = { name: 'ECDH', public: userPubKey };
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhParams, ephemeral.privateKey, 256),
  );

  // 4) HKDF: shared + auth → PRK_key (32바이트)
  const authSecret = b64uDecode(authSecretB64u);
  const keyInfo = new TextEncoder().encode('WebPush: info\0');
  const keyInfoFull = concat(keyInfo, userPubRaw, ephemeralPubRaw);
  const ikm = await hkdfExpand(shared, authSecret, keyInfoFull, 32);

  // 5) salt 16바이트 랜덤
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 6) HKDF: ikm + salt → CEK (16바이트), nonce (12바이트)
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cek = await hkdfExpand(ikm, salt, cekInfo, 16);
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdfExpand(ikm, salt, nonceInfo, 12);

  // 7) plaintext + 0x02 (delimiter) — RFC 8188 record padding
  const padded = concat(plaintext, new Uint8Array([0x02]));

  // 8) AES-128-GCM 암호화
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded),
  );

  // 9) 헤더: salt (16) + rs (4, big-endian, 우리는 4096) + idlen (1, 65) + keyid (65)
  const rs = new Uint8Array([0, 0, 0x10, 0x00]); // 4096
  const idlen = new Uint8Array([65]);
  const body = concat(salt, rs, idlen, ephemeralPubRaw, ciphertext);

  return { body, serverPublicKeyB64u: b64uEncode(ephemeralPubRaw) };
};

// ----- 메인: 한 구독자에게 발송 -----
// 반환: { status } (200/201 OK, 410/404 만료 → 호출자가 DELETE)
export const sendPush = async (
  env: Env,
  sub: PushSubscriptionRow,
  payload: PushPayload,
  ttlSec = 86400,
): Promise<{ ok: boolean; status: number; expired: boolean; error?: string }> => {
  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const { publicKeyB64u } = parseVapidKeys(env);

    const [jwt, encrypted] = await Promise.all([
      vapidJwt(audience, env),
      encryptPayload(
        new TextEncoder().encode(
          JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? '/' }),
        ),
        sub.p256dh,
        sub.auth,
      ),
    ]);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${publicKeyB64u}`,
        TTL: String(ttlSec),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(encrypted.body.length),
        Urgency: 'normal',
      },
      body: encrypted.body,
    });

    // 410 Gone / 404 Not Found = 구독 만료, 호출자에서 DELETE
    const expired = res.status === 410 || res.status === 404;
    const ok = res.status >= 200 && res.status < 300;
    return { ok, status: res.status, expired };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      expired: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

// ----- chunk 50 발송 헬퍼 (Free tier subrequest 50/request 한도 회피) -----
// 한 worker invocation 안에서 50명씩 끊어 발송. 그 이상은 호출자가 multiple worker invocation으로.
export const sendPushChunk = async (
  env: Env,
  subs: PushSubscriptionRow[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; expiredEndpoints: string[] }> => {
  const results = await Promise.allSettled(subs.map((s) => sendPush(env, s, payload)));
  let sent = 0;
  let failed = 0;
  const expiredEndpoints: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value.ok) {
      sent++;
    } else if (r.status === 'fulfilled' && r.value.expired) {
      // 만료는 별도 카운트 (failed 에 중복 가산 X — admin UI 숫자 정합성)
      expiredEndpoints.push(subs[i].endpoint);
    } else {
      failed++;
    }
  }
  return { sent, failed, expiredEndpoints };
};
