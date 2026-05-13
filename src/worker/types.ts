export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GROQ_API_KEY?: string;
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

// AI 프롬프트용 한글 라벨 — keep in sync with src/client/lib/businessTypes.ts
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

export const json = <T>(body: ApiResponse<T>, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });

export const ok = <T>(data: T, init?: ResponseInit) => json({ ok: true, data }, init);
export const err = (error: string, status = 400) =>
  json({ ok: false, error }, { status });
