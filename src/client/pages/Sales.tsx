import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MenuTile from '../components/MenuTile';
import { Skeleton } from '../components/Skeleton';
import { apiGet, apiPost } from '../lib/api';
import { getCache, setCache, isFresh, invalidateByPrefix } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';

interface Menu {
  id: number;
  name: string;
  category: string | null;
  cost: number;
  price: number;
  emoji: string | null;
}
interface CartItem {
  menuId: number;
  name: string;
  emoji: string | null;
  qty: number;
}

// 담은 목록 본문 — 우측 컬럼/하단 패널 양쪽에서 공유 (모듈 레벨 컴포넌트라 리마운트 이슈 없음)
function CartBody({
  cart,
  totalQty,
  submitting,
  onSetQty,
  onRemove,
  onClear,
  onSubmit,
}: {
  cart: CartItem[];
  totalQty: number;
  submitting: boolean;
  onSetQty: (menuId: number, qty: number) => void;
  onRemove: (menuId: number) => void;
  onClear: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        {cart.length === 0 ? (
          <div className="h-full min-h-0 flex flex-col items-center justify-center text-sub py-8">
            <span className="text-4xl mb-2 opacity-70" aria-hidden>🛒</span>
            <p className="text-sm break-keep">메뉴를 누르면 여기에 담겨요</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {cart.map((c) => (
              <li key={c.menuId} className="flex items-center gap-2 py-2">
                <span className="text-lg w-6 text-center shrink-0">
                  {c.emoji || '📦'}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm font-medium">
                  {c.name}
                </span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onSetQty(c.menuId, c.qty - 1)}
                    disabled={submitting || c.qty <= 1}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-border text-sub hover:bg-border/40 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label="수량 감소"
                  >
                    −
                  </button>
                  <span className="num w-5 text-center text-sm tabular-nums">
                    {c.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSetQty(c.menuId, c.qty + 1)}
                    disabled={submitting}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-border text-sub hover:bg-border/40 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label="수량 증가"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(c.menuId)}
                    disabled={submitting}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-md text-warm hover:bg-warm/10 ml-0.5 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label="삭제"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="shrink-0 pt-2.5 mt-2 border-t border-border flex items-center gap-2">
        {cart.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={submitting}
            className="text-xs text-sub hover:text-ink px-1.5 h-9 shrink-0 disabled:opacity-40"
          >
            비우기
          </button>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={cart.length === 0 || submitting}
          className="btn-primary flex-1 h-10 text-sm disabled:opacity-40"
        >
          {submitting
            ? '기록 중…'
            : cart.length === 0
            ? '담긴 항목 없음'
            : `${totalQty}건 기록하기`}
        </button>
      </div>
    </>
  );
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
  const [loadError, setLoadError] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [expanded, setExpanded] = useState(false); // 하단 패널 펼침 여부 (모바일/태블릿)
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    if (isFresh(menuCacheKey, TTL_MENUS)) {
      setMenusLoaded(true);
      return;
    }
    try {
      const m = await apiGet<{ menus: Menu[] }>('/api/menus');
      setMenus(m.menus);
      setCache(menuCacheKey, m.menus);
    } catch {
      setLoadError(true); // 캐시도 없고 못 불러오면 아래에서 재시도 UI
    } finally {
      setMenusLoaded(true);
    }
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

  const totalQty = useMemo(() => cart.reduce((s, c) => s + c.qty, 0), [cart]);

  const addToCart = (m: Menu) => {
    if (submitting) return;
    const wasEmpty = cart.length === 0;
    setCart((prev) => {
      const i = prev.findIndex((c) => c.menuId === m.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [...prev, { menuId: m.id, name: m.name, emoji: m.emoji, qty: 1 }];
    });
    // 첫 항목 담을 때만 자동으로 펼침 — 사용자가 접어둔 걸 매 탭마다 다시 펴지 않게
    if (wasEmpty) setExpanded(true);
  };
  const setQty = (menuId: number, qty: number) =>
    setCart((prev) =>
      qty <= 0
        ? prev.filter((c) => c.menuId !== menuId)
        : prev.map((c) => (c.menuId === menuId ? { ...c, qty } : c)),
    );
  const removeItem = (menuId: number) =>
    setCart((prev) => {
      const next = prev.filter((c) => c.menuId !== menuId);
      if (next.length === 0) setExpanded(false);
      return next;
    });
  const clearCart = () => {
    setCart([]);
    setExpanded(false);
  };

  const showToast = (text: string) => {
    setToast({ text, key: Date.now() });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  };

  const submit = async () => {
    if (submitting || cart.length === 0) return;
    setSubmitting(true);
    const items = [...cart];
    const results = await Promise.allSettled(
      items.map((it) =>
        apiPost('/api/sales', { menuId: it.menuId, quantity: it.qty }),
      ),
    );
    setSubmitting(false);
    const failed = items.filter((_, i) => results[i].status === 'rejected');
    if (failed.length === 0) {
      // 수량 합. "5건 기록됐어요"는 사장님 입장에서 자연 (메뉴 수가 아닌 수량 단위).
      const n = items.reduce((s, it) => s + it.qty, 0);
      // BI가 새 매출을 바로 반영하도록 통계 캐시 무효화
      invalidateByPrefix(`stats:${userId}:`);
      setCart([]);
      setExpanded(false);
      showToast(`${n}건 기록됐어요`);
    } else {
      const okMenus = items.length - failed.length;
      setCart(failed);
      alert(
        okMenus > 0
          ? `${okMenus}개 메뉴는 기록했지만 ${failed.length}개는 실패했어요. 다시 시도해주세요.`
          : '기록에 실패했어요. 다시 시도해주세요.',
      );
    }
  };

  const cartProps = {
    cart,
    totalQty,
    submitting,
    onSetQty: setQty,
    onRemove: removeItem,
    onClear: clearCart,
    onSubmit: submit,
  };

  if (!menusLoaded) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-0 py-4 md:py-0">
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[112px] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <div className="xl:flex xl:gap-6 xl:items-start">
        {/* 왼쪽: 헤더 + 메뉴 타일 */}
        <div className="flex-1 min-w-0 pb-28 xl:pb-0">
          <div className="md:hidden mb-3">
            <h1 className="font-display text-2xl md:text-3xl">판매 입력</h1>
            <p className="text-sub text-xs">
              메뉴를 누르면 담기고, 확인하면 한 번에 기록돼요
            </p>
          </div>
          <div className="hidden md:flex md:items-baseline md:gap-3 mb-6">
            <h1 className="font-display text-3xl shrink-0 whitespace-nowrap">
              판매 입력
            </h1>
            <p className="text-sub truncate min-w-0">
              메뉴를 누르면 담기고, 확인하면 한 번에 기록돼요
            </p>
          </div>

          {loadError && menus.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-lg mb-2">메뉴를 불러오지 못했어요.</p>
              <p className="text-sub mb-6">네트워크 상태를 확인하고 다시 시도해주세요.</p>
              <button
                type="button"
                onClick={() => {
                  setMenusLoaded(false);
                  load();
                }}
                className="btn-outline inline-flex px-5"
              >
                다시 시도
              </button>
            </div>
          ) : menus.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-lg mb-2">아직 등록한 메뉴가 없어요.</p>
              <p className="text-sub mb-6">
                먼저 메뉴를 등록하면 한 번에 판매를 기록할 수 있어요.
              </p>
              <Link to="/menus" className="btn-primary inline-flex">
                메뉴 등록하러 가기 →
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {groupedMenus.map(([cat, items]) => (
                <section key={cat}>
                  <h3 className="text-sm md:text-base font-medium text-ink/70 mb-3 px-1">{cat}</h3>
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-3 gap-2">
                    {items.map((m) => (
                      <div key={m.id} className="min-w-0">
                        <MenuTile
                          emoji={m.emoji}
                          name={m.name}
                          price={m.price}
                          onTap={() => addToCart(m)}
                          disabled={submitting}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* 오른쪽 고정 컬럼 (≥lg) — 담은 목록 */}
        {menus.length > 0 && (
          <aside className="hidden xl:flex xl:flex-col xl:w-80 xl:shrink-0 xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)] card p-4">
            <div className="flex items-baseline gap-2 mb-2 shrink-0">
              <h2 className="font-semibold">담은 목록</h2>
              {cart.length > 0 && (
                <span className="text-sub text-xs num">
                  {cart.length}개 · {totalQty}건
                </span>
              )}
            </div>
            <CartBody {...cartProps} />
          </aside>
        )}
      </div>

      {/* 하단 고정 패널 (<lg) — 모바일은 BottomNav 위, 태블릿은 화면 맨 아래 */}
      {menus.length > 0 && (
        <div
          className="xl:hidden fixed left-0 md:left-64 right-0 bottom-16 md:bottom-0 z-30
                     bg-card border-t border-border shadow-[0_-3px_14px_rgba(0,0,0,0.07)]
                     flex flex-col"
        >
          <button
            type="button"
            onClick={() => cart.length > 0 && setExpanded((e) => !e)}
            className="flex items-center gap-2 px-4 h-12 shrink-0 text-left"
            aria-expanded={expanded}
          >
            {cart.length === 0 ? (
              <span className="text-sub text-sm">메뉴를 누르면 여기에 담겨요</span>
            ) : (
              <>
                <span className="font-semibold text-sm">
                  담은 목록 <span className="num text-accent">{cart.length}</span>개
                  <span className="text-sub font-normal"> · {totalQty}건</span>
                </span>
                <span className="ml-auto text-sub text-xs">
                  {expanded ? '접기 ▾' : '펼치기 ▴'}
                </span>
              </>
            )}
          </button>

          {cart.length > 0 && expanded && (
            <div className="flex flex-col px-4 pb-3 max-h-[42vh] anim-fade">
              <CartBody {...cartProps} />
            </div>
          )}
          {cart.length > 0 && !expanded && (
            <div className="px-4 pb-3 pt-1">
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="btn-primary w-full h-10 text-sm disabled:opacity-40"
              >
                {submitting ? '기록 중…' : `${totalQty}건 기록하기`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 기록 완료 토스트 */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 z-40 pointer-events-none bottom-32 md:bottom-20 xl:bottom-auto xl:top-20">
          <div
            key={toast.key}
            className="anim-toast bg-accent text-white rounded-full px-4 py-2
                       text-sm font-medium shadow-soft flex items-center gap-2 whitespace-nowrap"
          >
            <span className="text-base leading-none">✓</span>
            <span>{toast.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}
