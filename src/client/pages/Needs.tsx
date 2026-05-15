import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { setCache, getCache, isFresh } from '../lib/cache';
import NeedsTab from '../components/NeedsTab';
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

  // 메뉴 목록은 캐시에서 즉시 - 폼은 첫 렌더부터 바로 보임 (스켈레톤 없음)
  const [menus, setMenus] = useState<MenuLite[]>(
    () => getCache<MenuLite[]>(menuCacheKey) ?? [],
  );
  const [menusLoaded, setMenusLoaded] = useState<boolean>(
    () => (getCache<MenuLite[]>(menuCacheKey)?.length ?? 0) > 0,
  );

  const load = useCallback(async () => {
    if (isFresh(menuCacheKey, TTL_MENUS)) {
      setMenusLoaded(true);
      return;
    }
    try {
      const d = await apiGet<{ menus: MenuLite[] }>('/api/menus');
      setMenus(d.menus);
      setCache(menuCacheKey, d.menus);
    } catch {
      /* 못 불러와도 폼은 동작 - 제품 선택만 비활성 */
    } finally {
      setMenusLoaded(true);
    }
  }, [menuCacheKey, TTL_MENUS]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <h1 className="font-display text-2xl md:text-3xl mb-4">고객 니즈</h1>
      <NeedsTab menus={menus} menusLoaded={menusLoaded} />
    </div>
  );
}
