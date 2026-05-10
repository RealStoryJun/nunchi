// localStorage 기반 SWR 캐시. 사용자 격리는 호출 측에서 key에 user.id 포함.
const PREFIX = 'nunchi:cache:';

interface Entry<T> {
  v: T;
  ts: number;
}

export function getCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry<T>;
    return parsed.v;
  } catch {
    return null;
  }
}

export function getCacheMeta<T>(key: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as Entry<T>;
  } catch {
    return null;
  }
}

export function isFresh(key: string, ttlMs: number): boolean {
  const meta = getCacheMeta(key);
  return !!meta && Date.now() - meta.ts < ttlMs;
}

export function invalidate(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function setCache<T>(key: string, v: T): void {
  try {
    localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ v, ts: Date.now() } satisfies Entry<T>),
    );
  } catch {
    /* quota exceeded — 무시 */
  }
}

export function clearAllCache(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
