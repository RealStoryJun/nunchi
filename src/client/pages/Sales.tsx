import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import MenuTile from '../components/MenuTile';
import CountUp from '../components/CountUp';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { formatDate, startOfDay, endOfDay } from '../lib/format';

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
  const [menus, setMenus] = useState<Menu[]>([]);
  const [todaySales, setTodaySales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    const now = new Date();
    const from = startOfDay(now).getTime();
    const to = endOfDay(now).getTime();
    const [m, s] = await Promise.all([
      apiGet<{ menus: Menu[] }>('/api/menus'),
      apiGet<{ sales: Sale[] }>(`/api/sales?from=${from}&to=${to}&limit=200`),
    ]);
    setMenus(m.menus);
    setTodaySales(s.sales);
    setLoading(false);
  }, []);
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const todayRevenue = useMemo(
    () => todaySales.reduce((s, r) => s + r.price_at_sale * r.quantity, 0),
    [todaySales],
  );
  const todayQty = useMemo(
    () => todaySales.reduce((s, r) => s + r.quantity, 0),
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
    setSavingId(menu.id);
    // 낙관적 업데이트
    const optimistic: Sale = {
      id: -Date.now(),
      menu_id: menu.id,
      quantity: 1,
      cost_at_sale: menu.cost,
      price_at_sale: menu.price,
      sold_at: Date.now(),
      menu_name: menu.name,
      menu_emoji: menu.emoji,
    };
    setTodaySales((prev) => [optimistic, ...prev]);
    try {
      const data = await apiPost<{ sale: Sale }>('/api/sales', {
        menuId: menu.id,
        quantity: 1,
      });
      setTodaySales((prev) =>
        prev.map((s) => (s.id === optimistic.id ? data.sale : s)),
      );
    } catch (e) {
      setTodaySales((prev) => prev.filter((s) => s.id !== optimistic.id));
      alert(e instanceof Error ? e.message : '판매 저장 실패');
    } finally {
      setSavingId(null);
    }
  };

  const undo = async (sale: Sale) => {
    if (sale.id < 0) return; // 아직 서버에 저장 안 됨
    setTodaySales((prev) => prev.filter((s) => s.id !== sale.id));
    try {
      await apiDelete(`/api/sales/${sale.id}`);
    } catch (e) {
      // 실패 시 다시 로드
      alert(e instanceof Error ? e.message : '취소 실패');
      loadAll();
    }
  };

  const recent = todaySales.slice(0, 5);

  if (loading)
    return <div className="p-6 text-sub">불러오는 중…</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-0 py-4 md:py-0 pb-40 md:pb-0">
      <div className="md:hidden mb-4">
        <h1 className="font-display text-2xl">판매 입력</h1>
        <p className="text-sub text-sm">메뉴 한 번 탭 = 1개 판매 기록</p>
      </div>
      <div className="hidden md:flex md:items-baseline md:justify-between mb-6">
        <h1 className="font-display text-3xl">판매 입력</h1>
        <p className="text-sub">메뉴 한 번 탭 = 1개 판매 기록</p>
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
                  <div key={m.id} className={savingId === m.id ? 'opacity-70' : ''}>
                    <MenuTile
                      emoji={m.emoji}
                      name={m.name}
                      price={m.price}
                      onTap={() => sell(m)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* 하단 고정 카드: 오늘 매출 + 최근 입력 */}
      <div
        className="fixed md:static bottom-16 md:bottom-auto inset-x-0 md:inset-x-auto
                   md:mt-8 px-4 md:px-0 z-20"
      >
        <div className="max-w-4xl mx-auto">
          <div className="card p-4 md:p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sub text-sm">오늘의 매출</span>
              <span className="text-sub text-xs num">{todayQty}건</span>
            </div>
            <CountUp
              value={todayRevenue}
              className="num text-3xl md:text-4xl font-bold text-accent block mt-1"
            />
            {recent.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {recent.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 px-1 py-1.5 rounded-lg
                               hover:bg-black/[0.02]"
                  >
                    <span className="text-lg leading-none">
                      {s.menu_emoji || '📦'}
                    </span>
                    <span className="flex-1 truncate">{s.menu_name}</span>
                    <span className="num text-sub text-xs">
                      {formatDate(s.sold_at)}
                    </span>
                    <span className="num font-medium">
                      +{(s.price_at_sale * s.quantity).toLocaleString('ko-KR')}원
                    </span>
                    <button
                      type="button"
                      onClick={() => undo(s)}
                      className="text-warm text-xs px-2 py-1 rounded-md
                                 hover:bg-warm/10"
                      aria-label="취소"
                    >
                      취소
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
