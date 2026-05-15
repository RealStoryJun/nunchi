export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GROQ_API_KEY?: string;
  // AES-256 키 (32바이트 base64). TOTP secret envelope encryption용.
  // 없으면 평문 base32 fallback (개발/마이그레이션 호환).
  TOTP_SECRET_KEY?: string;
  // Cloudflare Turnstile secret (가입 봇 차단). site key는 public이지만 secret과 같이 묶어 보관.
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
}

export interface SessionUser {
  id: number;
  email: string;
  business_name: string;
  business_type: string | null;
  is_admin: boolean;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  business_name: string;
  business_type: string | null;
  recovery_question: string;
  recovery_answer_hash: string;
  created_at: number;
  is_admin: number;
}

// keep in sync with src/client/lib/businessTypes.ts
export const BUSINESS_TYPE_IDS = [
  'cafe',
  'restaurant',
  'bakery',
  'bar',
  'clothing',
  'bag',
  'cosmetics',
  'flower',
  'bookstore',
  'pet',
  'beauty',
  'auto_repair',
  'motorcycle',
  'wrap_tuning',
  'craft',
  'laundry',
  'sidedish',
  'other',
] as const;
export type BusinessType = (typeof BUSINESS_TYPE_IDS)[number];
export const isBusinessType = (v: unknown): v is BusinessType =>
  typeof v === 'string' && (BUSINESS_TYPE_IDS as readonly string[]).includes(v);

// AI 프롬프트용 한글 라벨 - keep in sync with src/client/lib/businessTypes.ts
export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  cafe: '카페',
  restaurant: '음식점',
  bakery: '베이커리',
  bar: '주점·바',
  clothing: '의류 매장',
  bag: '가방·잡화',
  cosmetics: '화장품',
  flower: '꽃집',
  bookstore: '서점·문구',
  pet: '펫샵',
  beauty: '미용·헤어',
  auto_repair: '카센터',
  motorcycle: '오토바이센터',
  wrap_tuning: '랩핑·튜닝',
  craft: '공방·수공예',
  laundry: '세탁소',
  sidedish: '반찬가게',
  other: '기타',
};

export interface MenuRow {
  id: number;
  user_id: number;
  name: string;
  category: string | null;
  cost: number;
  price: number;
  emoji: string | null;
  archived: number;
  display_order: number;
  created_at: number;
}

export interface SaleRow {
  id: number;
  user_id: number;
  menu_id: number;
  quantity: number;
  cost_at_sale: number;
  price_at_sale: number;
  sold_at: number;
}

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

// 모든 응답에 일괄 적용할 보안 헤더 - 다운그레이드(HSTS)/clickjacking/sniff/referrer/permissions/CSP
// CSP: React/Recharts inline style + Tailwind inline style 호환을 위해 'unsafe-inline' 허용.
// script-src도 'unsafe-inline'은 Vite hashing 안 쓰는 dev 상태 호환 + production은 자기 origin script만.
// connect-src 'self' - 워커 자체 fetch만. img-src에 qrserver.com (2FA QR), data: (favicon).
// frame-ancestors 'none' - X-Frame-Options DENY 보강 (최신 브라우저).
export const SECURITY_HEADERS: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "default-src 'self'",
    // Cloudflare Turnstile script + 자체 origin + React/Vite inline.
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    // 브랜드 폰트 CSS @import - Pretendard(jsdelivr) + Gowun Batang/JetBrains Mono(googleapis)
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "img-src 'self' data: https://api.qrserver.com",
    // 폰트 woff2 파일 origin (gstatic은 Google Fonts, jsdelivr는 Pretendard)
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

export const json = <T>(body: ApiResponse<T>, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...SECURITY_HEADERS,
      ...(init.headers || {}),
    },
  });

export const ok = <T>(data: T, init?: ResponseInit) => json({ ok: true, data }, init);
export const err = (error: string, status = 400) =>
  json({ ok: false, error }, { status });
