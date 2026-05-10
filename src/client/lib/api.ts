export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr { ok: false; error: string }
export type ApiResult<T> = ApiOk<T> | ApiErr;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

import { trackStart, trackEnd } from './progress';

// GET 인플라이트 dedup: 동일 path 동시 호출 1번만 fetch + promise 공유
const inflight = new Map<string, Promise<unknown>>();

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const key = `${method} ${path}`;
  if (method === 'GET') {
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;
  }
  const run = async (): Promise<T> => {
    trackStart();
    try {
      const res = await fetch(path, {
        credentials: 'include',
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init.headers || {}),
        },
      });
      let body: ApiResult<T>;
      try {
        body = (await res.json()) as ApiResult<T>;
      } catch {
        throw new ApiError(res.status, '서버 응답을 읽을 수 없습니다.');
      }
      if (!body.ok) throw new ApiError(res.status, body.error);
      return body.data;
    } finally {
      trackEnd();
    }
  };
  const promise = run();
  if (method === 'GET') {
    inflight.set(key, promise as Promise<unknown>);
    promise.finally(() => {
      if (inflight.get(key) === (promise as Promise<unknown>)) {
        inflight.delete(key);
      }
    });
  }
  return promise;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
export const apiPut = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });
