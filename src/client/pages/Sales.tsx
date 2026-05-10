import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MenuTile from '../components/MenuTile';
import CountUp from '../components/CountUp';
import { Skeleton } from '../components/Skeleton';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { startOfDay, endOfDay } from '../lib/format';
import { getCache, setCache, isFresh, invalidate } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';

interface Menu {
  id: number;
  name: string;
  category: string | null;
  cost: number;
  price: number;
  emoji: string | null;
}
interface Sale {
  id: number;
  menu_id: number;
  quantity: number;
  cost_at_sale: number;
  price_at_sale: number;
  sold_at: number;
  menu_name: string;
  menu_emoji: string | null;
}

export default function Sales() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;
  const menuCacheKey = `menus:${userId}`;
  const salesCacheKey = `sales:today:${userId}`;
  const TTL_MENUS = 5 * 60 * 1000; // 5분
  const TTL_SALES = 30 * 1000; // 30초

  // 메뉴는 캐시 즉시 렌더 → TTL 안 신선하면 백그라운드 갱신
  const [menus, setMenus] = useState<Menu[]>(
    () => getCache<Menu[]>(menuCacheKey) ?? [],
  );
  const [menusLoaded, setMenusLoaded] = useState<boolean>(
    () => (getCache<Menu[]>(menuCacheKey)?.length ?? 0) > 0,
  );
  // 오늘 판매도 캐시 즉시 표시 + TTL 검사
  const [todaySales, setTodaySales] = useState<Sale[] | null>(
    () => getCache<Sale[]>(salesCacheKey),
  );
  const [savingId, setSavingId] = useState<number | null>(null);
  // 같은 메뉴 동시 클릭 차단 (useRef로 동기 체크 — React 렌더 비동기 race 회피)
  const inFlightRef = useRef<Set<number>>(new Set());
  // optimistic id 충돌 방지 카운터 (같은 ms 두 메뉴 탭 시 음수 id 중복 방지)
  const optimisticCounterRef = useRef(0);

  const loadAll = useCallback(async () => {
    const now = new Date();
    const from = startOfDay(now).getTime();
    const to = endOfDay(now).getTime();
    const tasks: Promise<void>[] = [];
    if (!isFresh(menuCacheKey, TTL_MENUS)) {
      tasks.push(
        apiGet<{ menus: Menu[] }>('/api/menus').then((m) => {
          setMenus(m.menus);
          setCache(menuCacheKey, m.menus);
          setMenusLoaded(true);
        }),
      );
    } else {
      setMenusLoaded(true);
    }
    if (!isFresh(salesCacheKey, TTL_SALES)) {
      tasks.push(
        apiGet<{ sales: Sale[] }>(
          `/api/sales?from=${from}&to=${to}&limit=200`,
        ).then((s) => {
          setTodaySales(s.sales);
          setCache(salesCacheKey, s.sales);
        }),
      );
    }
    await Promise.all(tasks);
  }, [menuCacheKey, salesCacheKey, TTL_MENUS, TTL_SALES]);
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const todayRevenue = useMemo(
    () =>
      (todaySales ?? []).reduce((s, r) => s + r.price_at_sale * r.quantity, 0),
    [todaySales],
  );
  const todayQty = useMemo(
    () => (todaySales ?? []).reduce((s, r) => s + r.quantity, 0),
    [todaySales],
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
    // 낙관적 업데이트 — id는 카운터 + ms로 충돌 방지 (같은 ms 동시 탭 안전)
    optimisticCounterRef.current = (optimisticCounterRef.current + 1) & 0xfff;
    const optimistic: Sale = {
      id: -(Date.now() * 4096 + optimisticCounterRef.current),
      menu_id: menu.id,
      quantity: 1,
      cost_at_sale: menu.cost,
      price_at_sale: menu.price,
      sold_at: Date.now(),
      menu_name: menu.name,
      menu_emoji: menu.emoji,
    };
    setTodaySales((prev) => [optimistic, ...(prev ?? [])]);
    try {
      const data = await apiPost<{ sale: Sale }>('/api/sales', {
        menuId: menu.id,
        quantity: 1,
      });
      setTodaySales((prev) => {
        const next = (prev ?? []).map((s) =>
          s.id === optimistic.id ? data.sale : s,
        );
        setCache(salesCacheKey, next);
        return next;
      });
    } catch (e) {
      setTodaySales((prev) =>
        (prev ?? []).filter((s) => s.id !== optimistic.id),
      );
      alert(e instanceof Error ? e.message : '판매 저장 실패');
    } finally {
      setSavingId(null);
      inFlightRef.current.delete(menu.id);
    }
  };

  const undo = async (sale: Sale) => {
    if (sale.id < 0) return;
    setTodaySales((prev) => {
      const next = (prev ?? []).filter((s) => s.id !== sale.id);
      setCache(salesCacheKey, next);
      return next;
    });
    try {
      await apiDelete(`/api/sales/${sale.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : '취소 실패');
      invalidate(salesCacheKey);
      loadAll();
    }
  };

  const recent = (todaySales ?? []).slice(0, 5);
  const salesLoading = todaySales === null;

  // 하단 고정 카드 실제 높이를 측정해 paddingBottom에 반영 (가려짐 방지)
  const footRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = footRef.current;
    const wrap = wrapperRef.current;
    if (!el || !wrap) return;
    const apply = () => {
      const h = el.getBoundingClientRect().height;
      // 하단 네비 64px + 카드 + 24px 여유
      wrap.style.setProperty('--sales-foot', `${Math.ceil(h + 88)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [menusLoaded, todaySales, recent.length]);

  return (
    <div
      ref={wrapperRef}
      className="max-w-4xl mx-auto px-4 md:px-0 py-4 md:py-0 md:pb-0"
      style={{ paddingBottom: 'calc(var(--sales-foot, 340px) + env(safe-area-inset-bottom))' }}
    >
      <div className="md:hidden mb-3">
        <h1 className="font-display text-2xl">판매 입력</h1>
        <p className="text-sub text-xs">메뉴 한 번 탭 = 1개 판매 기록</p>
      </div>
      <div className="hidden md:flex md:items-baseline md:justify-between mb-6">
        <h1 className="font-display text-3xl">판매 입력</h1>
        <p className="text-sub">메뉴 한 번 탭 = 1개 판매 기록</p>
      </div>

      {!menusLoaded ? (
        // 캐시 없는 첫 진입 — 타일 스켈레톤
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : menus.length === 0 ? (
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

      {/* 하단 고정 카드: 오늘 매출 + 최근 입력 — 메뉴 0개 또는 오늘 판매 0건이면 숨김 */}
      {menusLoaded && menus.length > 0 && (salesLoading || todayQty > 0) && (
      <div
        ref={footRef}
        className="fixed md:static md:mt-8 inset-x-0 md:inset-x-auto px-3 md:px-0 z-20"
        style={{
          bottom: 'calc(64px + env(safe-area-inset-bottom))',
        }}
      >
        <div className="max-w-4xl mx-auto">
          <div className="card p-3 md:p-5 shadow-soft">
            <div className="flex items-baseline justify-between">
              <span className="text-sub text-xs md:text-sm">오늘의 매출</span>
              {salesLoading ? (
                <Skeleton className="h-3 w-10" />
              ) : (
                <span className="text-sub text-xs num">{todayQty}건</span>
              )}
            </div>
            {salesLoading ? (
              <Skeleton className="h-8 md:h-10 w-32 mt-1" />
            ) : (
              <CountUp
                value={todayRevenue}
                className="num text-2xl md:text-4xl font-bold text-accent block leading-tight mt-0.5"
              />
            )}
            {salesLoading ? (
              <ul className="mt-2 md:mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-14" />
                  </li>
                ))}
              </ul>
            ) : (
              recent.length > 0 && (
              <ul className="mt-2 md:mt-3 divide-y divide-border/60">
                {recent.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 py-1.5 text-sm min-w-0"
                  >
                    <span className="text-base leading-none w-5 text-center">
                      {s.menu_emoji || '📦'}
                    </span>
                    <span className="flex-1 truncate min-w-0">{s.menu_name}</span>
                    <span className="num font-medium whitespace-nowrap">
                      +{(s.price_at_sale * s.quantity).toLocaleString('ko-KR')}원
                    </span>
                    <button
                      type="button"
                      onClick={() => undo(s)}
                      className="text-warm text-xs font-medium px-3 h-11 -my-1.5 rounded-md hover:bg-warm/10 whitespace-nowrap"
                      aria-label="판매 기록 취소"
                    >
                      취소
                    </button>
                  </li>
                ))}
              </ul>
              )
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
