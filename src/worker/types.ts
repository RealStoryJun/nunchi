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
  // Web Push VAPID (2026-05-16 PR 3). 셋 다 없으면 푸시 기능 비활성 (graceful).
  // PUBLIC: base64url 65바이트 uncompressed P-256 point. PRIVATE: base64url 32바이트 d.
  // SUBJECT: 'mailto:god8night@gmail.com' 같은 운영자 연락처 (RFC 8292 필수).
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface SessionUser {
  id: number;
  email: string;
  business_name: string;
  business_type: string | null;
  is_admin: boolean;
  is_master: boolean; // 2026-05-16 신설. admin 부여·계정 삭제 권한 (사장님 god8night@naver.com 만)
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
  is_master: number;
}

// keep in sync with src/client/lib/businessTypes.ts
// 그룹 순서: 외식 / 소매 / 인적 서비스 / 스포츠·레슨 / 정비·수선 / 기타
export const BUSINESS_TYPE_IDS = [
  // 외식
  'cafe',
  'restaurant',
  'bakery',
  'bar',
  // 소매
  'clothing',
  'bag',
  'cosmetics',
  'flower',
  'bookstore',
  'pet',
  'sidedish',
  // 인적 서비스 (2026-05 PT·헬스·필라테스·요가·네일·마사지·학원·과외 추가)
  'beauty',
  'pt',
  'gym',
  'pilates',
  'yoga',
  'nail',
  'massage',
  'academy',
  'tutoring',
  // 스포츠·레슨 (2026-05 8종 신규, sports_class 카테고리)
  'basketball',
  'golf',
  'soccer',
  'baseball',
  'swimming',
  'tennis',
  'climbing',
  'dance',
  // 정비·수선
  'auto_repair',
  'motorcycle',
  'wrap_tuning',
  'craft',
  'laundry',
  // 기타
  'other',
] as const;
export type BusinessType = (typeof BUSINESS_TYPE_IDS)[number];
export const isBusinessType = (v: unknown): v is BusinessType =>
  typeof v === 'string' && (BUSINESS_TYPE_IDS as readonly string[]).includes(v);

// 5 카테고리 - keep in sync with src/client/lib/businessTypes.ts BusinessCategory
export type BusinessCategory =
  | 'retail_food'
  | 'service_personal'
  | 'service_repair'
  | 'sports_class'    // 2026-05 신규: 스포츠·레슨 (농구·골프·축구·야구·수영·테니스·클라이밍·댄스)
  | 'other';

// business_type → category mapping - keep in sync with src/client/lib/businessTypes.ts BUSINESS_TYPES[].category
export const BUSINESS_CATEGORY: Record<BusinessType, BusinessCategory> = {
  cafe: 'retail_food',
  restaurant: 'retail_food',
  bakery: 'retail_food',
  bar: 'retail_food',
  clothing: 'retail_food',
  bag: 'retail_food',
  cosmetics: 'retail_food',
  flower: 'retail_food',
  bookstore: 'retail_food',
  pet: 'retail_food',
  sidedish: 'retail_food',
  beauty: 'service_personal',
  pt: 'service_personal',
  gym: 'service_personal',
  pilates: 'service_personal',
  yoga: 'service_personal',
  nail: 'service_personal',
  massage: 'service_personal',
  academy: 'service_personal',
  tutoring: 'service_personal',
  basketball: 'sports_class',
  golf: 'sports_class',
  soccer: 'sports_class',
  baseball: 'sports_class',
  swimming: 'sports_class',
  tennis: 'sports_class',
  climbing: 'sports_class',
  dance: 'sports_class',
  auto_repair: 'service_repair',
  motorcycle: 'service_repair',
  wrap_tuning: 'service_repair',
  craft: 'service_repair',
  laundry: 'service_repair',
  other: 'other',
};

export const businessCategoryOf = (id: string | null | undefined): BusinessCategory => {
  if (!id || !isBusinessType(id)) return 'other';
  return BUSINESS_CATEGORY[id];
};

// 카테고리별 needs 라벨 (AI 프롬프트용) - keep in sync with src/client/lib/needsPresets.ts NEEDS_PRESETS
// gender·age_band는 모든 카테고리 공통. with_child·purpose·residence가 차별화.
export const NEEDS_LABEL_BY_CATEGORY: Record<BusinessCategory, Record<string, string>> = {
  retail_food: {
    female: '여성', male: '남성',
    '10s_20s': '10·20대', '30s_40s': '30·40대', '50plus': '50대 이상',
    yes: '자녀 동반', no: '미동반',
    gift: '선물용', kids_snack: '자녀 간식용', meal_replacement: '식사대용',
    busan: '부산', outside: '부산 외',
  },
  service_personal: {
    female: '여성', male: '남성',
    '10s_20s': '10·20대', '30s_40s': '30·40대', '50plus': '50대 이상',
    yes: '단골', no: '신규',
    gift: '이벤트·특별', kids_snack: '문제 해결', meal_replacement: '정기 관리',
    busan: '검색·SNS', outside: '지인 소개',
  },
  service_repair: {
    female: '여성', male: '남성',
    '10s_20s': '10·20대', '30s_40s': '30·40대', '50plus': '50대 이상',
    yes: '수입·고급', no: '국산',
    gift: '고장 수리', kids_snack: '소모품 교체', meal_replacement: '정기 점검',
    busan: '검색·SNS', outside: '지인 소개',
  },
  sports_class: {
    female: '여성', male: '남성',
    '10s_20s': '10·20대', '30s_40s': '30·40대', '50plus': '50대 이상',
    yes: '정기 회원', no: '신규·체험',
    gift: '취미·여가', kids_snack: '대회 준비', meal_replacement: '실력 향상',
    busan: '검색·SNS', outside: '지인 소개',
  },
  other: {
    female: '여성', male: '남성',
    '10s_20s': '10·20대', '30s_40s': '30·40대', '50plus': '50대 이상',
    yes: '자녀 동반', no: '미동반',
    gift: '선물용', kids_snack: '자녀 간식용', meal_replacement: '식사대용',
    busan: '부산', outside: '부산 외',
  },
};

// 슬롯 prefix (성별/연령대/자녀-방문빈도-차종-회원유형/목적-서비스사유-방문사유-레슨목적/거주지-방문경로)
export const NEEDS_SLOT_LABELS: Record<BusinessCategory, { withChild: string; purpose: string; residence: string }> = {
  retail_food:      { withChild: '자녀',       purpose: '목적',       residence: '거주지' },
  service_personal: { withChild: '방문 빈도',  purpose: '서비스 사유',  residence: '방문 경로' },
  service_repair:   { withChild: '차종·장비',  purpose: '방문 사유',    residence: '방문 경로' },
  sports_class:     { withChild: '회원 유형',  purpose: '레슨 목적',    residence: '방문 경로' },
  other:            { withChild: '자녀',       purpose: '목적',       residence: '거주지' },
};

// 카테고리별 AI 어휘 힌트 (SYSTEM_PROMPT 동적 삽입)
export const NEEDS_CATEGORY_HINT: Record<BusinessCategory, string> = {
  retail_food: '카페·식당·소매 손님 어휘. 자녀 동반·식사대용·선물·거주지가 의미 있음.',
  service_personal: '인적 서비스(미용·PT·학원 등) 손님 어휘. 단골 유지·정기 관리·방문 경로(SNS/소개)가 핵심 KPI.',
  service_repair: '정비·수선 서비스 손님 어휘. 차종/장비·정기 점검·고장 수리·소모품 교체가 의미 있음.',
  sports_class: '스포츠·레슨(농구·골프·축구·수영 등) 손님 어휘. 정기 회원 유지·실력 향상·대회 준비·체험 전환이 핵심 KPI. "선물용·식사대용" 같은 retail 어휘는 쓰지 말 것.',
  other: '일반 손님 어휘. retail_food 기본값과 동일.',
};

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
  sidedish: '반찬가게',
  beauty: '미용·헤어',
  pt: 'PT(개인 트레이닝 1:1)',
  gym: '헬스장',
  pilates: '필라테스',
  yoga: '요가',
  nail: '네일',
  massage: '마사지·스파',
  academy: '학원',
  tutoring: '과외',
  basketball: '농구 클래스',
  golf: '골프 레슨',
  soccer: '축구 클래스',
  baseball: '야구 클래스',
  swimming: '수영 강습',
  tennis: '테니스 레슨',
  climbing: '클라이밍',
  dance: '댄스 학원',
  auto_repair: '카센터',
  motorcycle: '오토바이센터',
  wrap_tuning: '랩핑·튜닝',
  craft: '공방·수공예',
  laundry: '세탁소',
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
