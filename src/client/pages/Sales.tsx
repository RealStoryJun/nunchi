import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MenuTile from '../components/MenuTile';
import { Skeleton } from '../components/Skeleton';
import { apiGet, apiPost } from '../lib/api';
import { getCache, setCache, isFresh } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';

interface Menu {
  id: number;
  name: string;
  category: string | null;
  cost: number;
  price: number;
  emoji: string | null;
}

export default function Sales() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;
  const menuCacheKey = `menus:${userId}`;
  const TTL_MENUS = 5 * 60 * 1000;

  const [menus, setMenus] = useState<Menu[]>(
    () => getCache<Menu[]>(menuCacheKey) ?? [],
  );
  const [menusLoaded, setMenusLoaded] = useState<boolean>(
    () => (getCache<Menu[]>(menuCacheKey)?.length ?? 0) > 0,
  );
  const [savingId, setSavingId] = useState<number | null>(null);
  // 같은 메뉴 동시 클릭 차단 (동기)
  const inFlightRef = useRef<Set<number>>(new Set());
  // 입력 확인 토스트
  const [toast, setToast] = useState<{ emoji: string; name: string; key: number } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (isFresh(menuCacheKey, TTL_MENUS)) {
      setMenusLoaded(true);
      return;
    }
    const m = await apiGet<{ menus: Menu[] }>('/api/menus');
    setMenus(m.menus);
    setCache(menuCacheKey, m.menus);
    setMenusLoaded(true);
  }, [menuCacheKey, TTL_MENUS]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(
    () => () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const groupedMenus = useMemo(() => {
    const map = new Map<string, Menu[]>();
    for (const m of menus) {
      const key = m.category?.trim() || '메뉴';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries());
  }, [menus]);

  const sell = async (menu: Menu) => {
    if (inFlightRef.current.has(menu.id)) return;
    inFlightRef.current.add(menu.id);
    setSavingId(menu.id);
    // 토스트 즉시 (입력 확인용 — 매출/취소는 BI)
    setToast({ emoji: menu.emoji || '📦', name: menu.name, key: Date.now() });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1500);
    try {
      await apiPost('/api/sales', { menuId: menu.id, quantity: 1 });
    } catch (e) {
      setToast(null);
      alert(e instanceof Error ? e.message : '판매 저장 실패');
    } finally {
      setSavingId(null);
      inFlightRef.current.delete(menu.id);
    }
  };

  if (!menusLoaded) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-0 py-4 md:py-0">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[112px] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <div className="md:hidden mb-3">
        <h1 className="font-display text-2xl">판매 입력</h1>
        <p className="text-sub text-xs">
          메뉴 한 번 탭 = 1개 기록 · 매출·취소·수정은 BI에서
        </p>
      </div>
      <div className="hidden md:flex md:items-baseline md:justify-between mb-6">
        <h1 className="font-display text-3xl">판매 입력</h1>
        <p className="text-sub">메뉴 한 번 탭 = 1개 기록 · 매출·취소·수정은 BI에서</p>
      </div>

      {menus.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg mb-2">아직 등록한 메뉴가 없어요.</p>
          <p className="text-sub mb-6">
            먼저 메뉴를 등록하면 한 탭으로 판매를 기록할 수 있어요.
          </p>
          <Link to="/menus" className="btn-primary inline-flex">
            메뉴 등록하러 가기 →
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedMenus.map(([cat, items]) => (
            <section key={cat}>
              <h3 className="text-sm text-sub mb-2 px-1">{cat}</h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {items.map((m) => (
                  <div key={m.id} className="min-w-0">
                    <MenuTile
                      emoji={m.emoji}
                      name={m.name}
                      price={m.price}
                      onTap={() => sell(m)}
                      disabled={savingId === m.id}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* 입력 확인 토스트 — 1.5초 후 자동 사라짐 */}
      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          style={{ bottom: 'calc(80px + env(safe-area-inset-bottom))' }}
        >
          <div
            key={toast.key}
            className="anim-toast bg-accent text-white rounded-full px-4 py-2
                       text-sm font-medium shadow-soft flex items-center gap-2 whitespace-nowrap"
          >
            <span className="text-base leading-none">{toast.emoji}</span>
            <span>{toast.name} 기록됨</span>
          </div>
        </div>
      )}
    </div>
  );
}
