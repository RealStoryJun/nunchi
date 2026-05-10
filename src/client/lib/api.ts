export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr { ok: false; error: string }
export type ApiResult<T> = ApiOk<T> | ApiErr;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

import { trackStart, trackEnd } from './progress';

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
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
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
export const apiPut = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });
