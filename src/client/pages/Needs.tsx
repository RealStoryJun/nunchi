import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { setCache, getCache, isFresh } from '../lib/cache';
import NeedsTab from '../components/NeedsTab';
import { Skeleton } from '../components/Skeleton';
import { useAuth } from '../hooks/useAuth';

interface MenuLite {
  id: number;
  name: string;
  emoji: string | null;
}

export default function Needs() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;
  const menuCacheKey = `menus:${userId}`;
  const TTL_MENUS = 5 * 60 * 1000;

  const [menus, setMenus] = useState<MenuLite[]>(
    () => getCache<MenuLite[]>(menuCacheKey) ?? [],
  );
  const [loaded, setLoaded] = useState<boolean>(
    () => (getCache<MenuLite[]>(menuCacheKey)?.length ?? 0) > 0,
  );

  const load = useCallback(async () => {
    if (isFresh(menuCacheKey, TTL_MENUS)) {
      setLoaded(true);
      return;
    }
    try {
      const d = await apiGet<{ menus: MenuLite[] }>('/api/menus');
      setMenus(d.menus);
      setCache(menuCacheKey, d.menus);
    } catch {
      /* 캐시 비어있으면 menus=[] 그대로 — 폼은 동작, 제품 선택만 비활성 */
    } finally {
      setLoaded(true);
    }
  }, [menuCacheKey, TTL_MENUS]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <h1 className="font-display text-2xl md:text-3xl mb-4">고객 니즈</h1>
      {!loaded ? (
        <div className="card p-5 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : (
        <NeedsTab menus={menus} />
      )}
    </div>
  );
}
