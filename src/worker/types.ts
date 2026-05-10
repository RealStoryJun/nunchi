export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export interface SessionUser {
  id: number;
  email: string;
  business_name: string;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  business_name: string;
  recovery_question: string;
  recovery_answer_hash: string;
  created_at: number;
}

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
