import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';
import StatCard from '../components/StatCard';
import { Skeleton } from '../components/Skeleton';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { getCache, setCache, isFresh, invalidate } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';
import {
  dayLabel,
  endOfDay,
  pct,
  startOfDay,
  startOfMonth,
  startOfWeek,
  timeHM,
  won,
  ymd,
} from '../lib/format';

interface ByMenu {
  menu_id: number;
  name: string;
  emoji: string | null;
  category: string | null;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
}
interface ByDay {
  day: string;
  revenue: number;
  cost: number;
  profit: number;
}
interface ByCat {
  category: string;
  revenue: number;
  cost: number;
  profit: number;
}
interface ByHour {
  hour: number;
  revenue: number;
  qty: number;
}
interface Stats {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  qty: number;
  byMenu: ByMenu[];
  byDay: ByDay[];
  byHour: ByHour[];
  byCategory: ByCat[];
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

type Range = 'today' | 'week' | 'month' | 'custom';

const PIE_COLORS = ['#1B4332', '#2D6A4F', '#52796F', '#C99D52', '#E76F51', '#767270'];

const TTL_STATS = 30 * 1000;

export default function BI() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState<string>(ymd(new Date()));
  const [to, setTo] = useState<string>(ymd(new Date()));
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [rankBy, setRankBy] = useState<'qty' | 'revenue'>('revenue');
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [insights, setInsights] = useState<string[] | null>(null);
  const [insightsBump, setInsightsBump] = useState(0);
  // 메뉴 등록 여부 — BI 빈 상태에서 "메뉴 없음"과 "이 기간 판매 없음"을 구분하기 위함. null=아직 모름.
  const [menuCount, setMenuCount] = useState<number | null>(() => {
    const c = getCache<{ id: number }[]>(`menus:${userId}`);
    return c ? c.length : null;
  });
  // 현재 `stats`가 어느 기간 키의 데이터인지 추적 — insights effect가 stale stats로 호출하는 걸 막음
  const statsKeyRef = useRef<string | null>(null);
  // 수정 모달 안에서 판매가 바뀌었는지 — 닫을 때 인사이트 1회만 재호출(매 −/＋ 마다 X)
  const editDirtyRef = useRef(false);

  const [fromMs, toMs] = useMemo(() => {
    const now = new Date();
    if (range === 'today') return [startOfDay(now).getTime(), endOfDay(now).getTime()];
    if (range === 'week')
      return [startOfWeek(now).getTime(), endOfDay(now).getTime()];
    if (range === 'month')
      return [startOfMonth(now).getTime(), endOfDay(now).getTime()];
    return [
      startOfDay(new Date(from)).getTime(),
      endOfDay(new Date(to)).getTime(),
    ];
  }, [range, from, to]);

  const statsCacheKey = `stats:${userId}:${fromMs}:${toMs}`;
  const tzOffset = -new Date().getTimezoneOffset();

  const refetchStats = useCallback(async () => {
    invalidate(statsCacheKey);
    const d = await apiGet<Stats>(
      `/api/stats?from=${fromMs}&to=${toMs}&tz=${tzOffset}`,
    );
    statsKeyRef.current = statsCacheKey;
    setStats(d);
    setCache(statsCacheKey, d);
  }, [statsCacheKey, fromMs, toMs, tzOffset]);

  const refetchSales = useCallback(async () => {
    const d = await apiGet<{ sales: Sale[] }>(
      `/api/sales?from=${fromMs}&to=${toMs}&limit=300`,
    );
    setSales(d.sales);
  }, [fromMs, toMs]);

  useEffect(() => {
    let alive = true;
    const cached = getCache<Stats>(statsCacheKey);
    if (cached) {
      statsKeyRef.current = statsCacheKey;
      setStats(cached);
      setLoading(false);
    } else {
      // 캐시 미스 — 이전 기간 stats는 화면에 잠깐 더 두되(깜빡임 방지),
      // statsKeyRef는 갱신하지 않음 → insights effect가 stale stats로 호출 안 함.
      setLoading(true);
    }
    setSales(null);
    const tasks: Promise<unknown>[] = [];
    if (!isFresh(statsCacheKey, TTL_STATS)) {
      tasks.push(
        apiGet<Stats>(`/api/stats?from=${fromMs}&to=${toMs}&tz=${tzOffset}`).then(
          (d) => {
            if (!alive) return;
            statsKeyRef.current = statsCacheKey;
            setStats(d);
            setCache(statsCacheKey, d);
          },
        ),
      );
    }
    tasks.push(
      apiGet<{ sales: Sale[] }>(
        `/api/sales?from=${fromMs}&to=${toMs}&limit=300`,
      ).then((d) => {
        if (alive) setSales(d.sales);
      }),
    );
    Promise.all(tasks).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMs, toMs, userId]);

  // 메뉴 개수 (빈 상태 분기용) — Sales/Menus와 동일한 menus:<userId> SWR 캐시 재사용
  useEffect(() => {
    const key = `menus:${userId}`;
    const cached = getCache<{ id: number }[]>(key);
    if (cached) setMenuCount(cached.length);
    if (isFresh(key, 5 * 60 * 1000)) return;
    let alive = true;
    apiGet<{ menus: { id: number }[] }>('/api/menus')
      .then((d) => {
        if (!alive) return;
        setMenuCount(d.menus.length);
        setCache(key, d.menus);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const changeQty = async (sale: Sale, q: number) => {
    if (q < 1 || busyId === sale.id) return;
    setBusyId(sale.id);
    setSales((prev) =>
      prev ? prev.map((x) => (x.id === sale.id ? { ...x, quantity: q } : x)) : prev,
    );
    try {
      await apiPut(`/api/sales/${sale.id}`, { quantity: q });
      editDirtyRef.current = true;
      await refetchStats();
    } catch (e) {
      alert(e instanceof Error ? e.message : '수정 실패');
      await Promise.all([refetchStats(), refetchSales()]);
    } finally {
      setBusyId(null);
    }
  };
  const removeSale = async (sale: Sale) => {
    if (busyId === sale.id) return;
    if (!confirm(`'${sale.menu_name}' 판매 기록을 취소할까요?`)) return;
    setBusyId(sale.id);
    setSales((prev) => (prev ? prev.filter((x) => x.id !== sale.id) : prev));
    try {
      await apiDelete(`/api/sales/${sale.id}`);
      editDirtyRef.current = true;
      await refetchStats();
    } catch (e) {
      alert(e instanceof Error ? e.message : '취소 실패');
      await Promise.all([refetchStats(), refetchSales()]);
    } finally {
      setBusyId(null);
    }
  };

  const closeEdit = async () => {
    setEditOpen(false);
    try {
      await refetchSales();
    } catch {
      /* 목록 갱신 실패는 무시 — 인사이트 재호출은 계속 진행 */
    }
    if (editDirtyRef.current) {
      editDirtyRef.current = false;
      setInsights(null);
      invalidate(`insights:${userId}:${fromMs}:${toMs}`);
      setInsightsBump((n) => n + 1);
    }
  };

  // 날짜별 그룹 (카드 사용내역 스타일) — 최신 날짜 먼저, 날짜 내 최신 시각 먼저
  const salesByDay = useMemo(() => {
    if (!sales) return [];
    const map = new Map<string, Sale[]>();
    for (const s of sales) {
      const k = ymd(new Date(s.sold_at));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(
        ([k, items]) =>
          [k, items.slice().sort((a, b) => b.sold_at - a.sold_at)] as const,
      );
  }, [sales]);

  // 시간대 0~23 슬롯 채우기 + 피크타임
  // (byHour는 신규 필드 — 옛 캐시 stats엔 없을 수 있어 ?? [] 가드)
  const hourly = useMemo(() => {
    const arr = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      revenue: 0,
      qty: 0,
    }));
    for (const b of stats?.byHour ?? []) if (arr[b.hour]) arr[b.hour] = b;
    return arr;
  }, [stats]);
  const peakHour = useMemo(() => {
    let best: { hour: number; revenue: number } | null = null;
    for (const h of hourly)
      if (h.revenue > 0 && (!best || h.revenue > best.revenue))
        best = { hour: h.hour, revenue: h.revenue };
    return best;
  }, [hourly]);

  const ranked = useMemo(() => {
    if (!stats) return [];
    const sorted = [...stats.byMenu].sort((a, b) =>
      rankBy === 'qty' ? b.qty - a.qty : b.revenue - a.revenue,
    );
    return sorted.slice(0, 10);
  }, [stats, rankBy]);

  // AI 인사이트 — stats 받으면 /api/insights 호출 (캐시 5분)
  useEffect(() => {
    if (!stats) {
      setInsights(null);
      return;
    }
    // stats가 아직 이전 기간 것이면(기간 토글 직후) 호출하지 않음 — 새 stats 도착하면 effect 재실행됨
    if (statsKeyRef.current !== statsCacheKey) return;
    let alive = true;
    const key = `insights:${userId}:${fromMs}:${toMs}`;
    const cached = getCache<string[]>(key);
    if (cached) setInsights(cached);
    if (isFresh(key, 5 * 60 * 1000)) return;
    const rangeLabel =
      range === 'today'
        ? '오늘'
        : range === 'week'
        ? '이번 주'
        : range === 'month'
        ? '이번 달'
        : '사용자 지정 기간';
    apiPost<{ insights: string[] }>('/api/insights', {
      stats: { ...stats, peakHour: peakHour?.hour ?? null },
      rangeLabel,
    })
      .then((d) => {
        if (!alive) return;
        setInsights(d.insights);
        // 빈 결과(groq-fail / no-key)는 캐시하지 않음 — Groq 복구되면 다음 방문에 재시도
        if (d.insights.length > 0) setCache(key, d.insights);
      })
      .catch(() => {
        if (alive) setInsights([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, peakHour, userId, fromMs, toMs, insightsBump]);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="font-display text-2xl md:text-3xl">BI 대시보드</h1>
      </div>

      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        {(['today', 'week', 'month', 'custom'] as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`px-3.5 h-10 rounded-lg text-sm border transition ${
              range === r
                ? 'bg-accent text-white border-accent'
                : 'bg-card text-ink border-border'
            }`}
          >
            {r === 'today'
              ? '오늘'
              : r === 'week'
              ? '이번 주'
              : r === 'month'
              ? '이번 달'
              : '사용자 지정'}
          </button>
        ))}
        {range === 'custom' && (
          <div className="flex items-center gap-2 w-full md:w-auto">
            <input
              type="date"
              className="field h-10 px-2 num text-sm flex-1 min-w-0 md:flex-none md:w-[150px]"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-sub shrink-0">~</span>
            <input
              type="date"
              className="field h-10 px-2 num text-sm flex-1 min-w-0 md:flex-none md:w-[150px]"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        )}
      </div>

      {loading || !stats ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-4 md:p-5">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-7 md:h-8 w-24 mt-2" />
                <Skeleton className="h-3 w-16 mt-1.5" />
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="card p-4">
              <Skeleton className="h-4 w-28 mb-3" />
              <Skeleton className="h-[200px] w-full" />
            </div>
            <div className="card p-4">
              <Skeleton className="h-4 w-32 mb-3" />
              <Skeleton className="h-[200px] w-full" />
            </div>
          </div>
          <div className="card p-4">
            <Skeleton className="h-4 w-24 mb-3" />
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          </div>
        </>
      ) : stats.qty === 0 ? (
        menuCount === 0 ? (
          // 메뉴가 아예 없는 신규 사용자
          <div className="card p-8 text-center anim-fade">
            <p className="text-3xl mb-3">🌱</p>
            <p className="text-lg mb-1.5 font-semibold">아직 시작 전이에요</p>
            <p className="text-sub text-sm mb-5 break-keep">
              메뉴를 등록하고 한 탭으로 판매를 기록하면<br />
              매출과 인기 상품을 자동으로 분석해드릴게요.
            </p>
            <Link to="/menus" className="btn-primary inline-flex px-5">
              메뉴 등록하러 가기 →
            </Link>
          </div>
        ) : (
          // 메뉴는 있는데 이 기간엔 판매가 없음
          <div className="card p-8 text-center anim-fade">
            <p className="text-3xl mb-3">🗓️</p>
            <p className="text-lg mb-1.5 font-semibold">
              이 기간엔 판매 기록이 없어요
            </p>
            <p className="text-sub text-sm mb-5 break-keep">
              {range === 'today'
                ? '오늘 들어온 판매가 아직 없어요. 판매를 입력하면 여기에 바로 집계돼요.'
                : '선택한 기간에 판매 기록이 없어요. 위에서 다른 기간을 선택해보세요.'}
            </p>
            <Link
              to="/sales"
              className={`inline-flex px-5 ${
                range === 'today' ? 'btn-primary' : 'btn-outline'
              }`}
            >
              {range === 'today' ? '판매 입력하러 가기 →' : '판매 입력'}
            </Link>
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="총매출" value={won(stats.revenue)} tone="accent" />
            <StatCard label="총원가" value={won(stats.cost)} />
            <StatCard
              label="순이익"
              value={won(stats.profit)}
              tone={stats.profit >= 0 ? 'accent' : 'warm'}
            />
            <StatCard
              label="마진율"
              value={pct(stats.margin)}
              hint={`${stats.qty}건 판매`}
            />
          </div>

          {/* AI 인사이트 — Groq 분석 (키 없거나 빈 결과면 카드 안 보임) */}
          {insights === null ? (
            <div className="card p-4 mb-4">
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-base">💡</span>
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : insights.length > 0 ? (
            <div className="card p-4 mb-4 border-accent/25 bg-accent/[0.03]">
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="text-base leading-none">💡</span>
                <h3 className="font-semibold text-accent">AI 인사이트</h3>
              </div>
              <ul className="space-y-2 text-sm leading-relaxed">
                {insights.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-accent/50 shrink-0 select-none">•</span>
                    <span className="text-ink/90">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">일별 매출 추이</h3>
              </div>
              {stats.byDay.length === 0 ? (
                <p className="text-sub text-sm py-12 text-center">
                  이 기간에 판매 기록이 없습니다.
                </p>
              ) : stats.byDay.length === 1 ? (
                <div className="py-8 text-center">
                  <div className="num text-3xl md:text-4xl font-bold text-accent">
                    {won(stats.byDay[0].revenue)}
                  </div>
                  <p className="text-sub text-xs mt-2">
                    데이터가 더 쌓이면 일별 추이 차트로 보여드릴게요.
                  </p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.byDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5DFD3" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: '#767270' }}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#767270' }}
                      tickFormatter={(v: number) =>
                        v >= 10000 ? `${Math.round(v / 1000)}k` : `${v}`
                      }
                    />
                    <Tooltip
                      formatter={(v: number) => won(v)}
                      labelFormatter={(l) => l}
                    />
                    <Bar dataKey="revenue" name="매출" fill="#1B4332" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">분류별 매출 비중</h3>
              </div>
              {stats.byCategory.length === 0 ? (
                <p className="text-sub text-sm py-12 text-center">
                  데이터가 없습니다.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={stats.byCategory}
                      dataKey="revenue"
                      nameKey="category"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {stats.byCategory.map((_, i) => (
                        <Cell
                          key={i}
                          fill={PIE_COLORS[i % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => won(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <ul className="mt-2 space-y-1 text-sm">
                {stats.byCategory.map((c, i) => (
                  <li key={c.category} className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className="flex-1 truncate">{c.category}</span>
                    <span className="num text-sub">{won(c.revenue)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 시간대별 매출 — "언제 붐비나" */}
          <div className="card p-4 mb-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-semibold">시간대별 매출</h3>
              {peakHour && (
                <span className="text-xs text-sub num">
                  가장 바쁜 시간 {peakHour.hour}시 · {won(peakHour.revenue)}
                </span>
              )}
            </div>
            {!peakHour ? (
              <p className="text-sub text-sm py-12 text-center">
                이 기간에 판매 기록이 없습니다.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5DFD3" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 11, fill: '#767270' }}
                    interval={0}
                    tickFormatter={(h: number) => (h % 4 === 0 ? `${h}시` : '')}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#767270' }}
                    tickFormatter={(v: number) =>
                      v >= 10000 ? `${Math.round(v / 1000)}k` : `${v}`
                    }
                  />
                  <Tooltip
                    formatter={(v: number) => won(v)}
                    labelFormatter={(h: number) => `${h}시`}
                  />
                  <Bar dataKey="revenue" name="매출" fill="#1B4332" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4 md:items-start">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">품목별 순위</h3>
              <div className="flex gap-1">
                {(['revenue', 'qty'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRankBy(k)}
                    className={`px-3 h-9 rounded-lg text-xs font-medium border ${
                      rankBy === k
                        ? 'bg-accent text-white border-accent'
                        : 'bg-card text-ink border-border'
                    }`}
                  >
                    {k === 'revenue' ? '매출 기준' : '수량 기준'}
                  </button>
                ))}
              </div>
            </div>
            {ranked.length === 0 ? (
              <p className="text-sub text-sm py-8 text-center">데이터가 없습니다.</p>
            ) : (
              <ul className="divide-y divide-border">
                {ranked.map((m, i) => (
                  <li
                    key={m.menu_id}
                    className="flex items-center gap-3 py-2.5"
                  >
                    <span className="num w-6 text-sub text-sm">
                      {i + 1}
                    </span>
                    <span className="text-xl">{m.emoji || '📦'}</span>
                    <span className="flex-1 truncate font-medium">{m.name}</span>
                    <span className="num text-sub text-sm">{m.qty}개</span>
                    <span className="num font-semibold w-28 text-right">
                      {won(m.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 판매 내역 — 카드 사용내역 스타일 날짜별 그룹 (읽기 전용) */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">
                판매 내역{sales ? ` (${sales.length}건)` : ''}
              </h3>
              {sales && sales.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="text-sm text-accent font-medium px-3 h-9 rounded-lg hover:bg-accent/10"
                >
                  수정
                </button>
              )}
            </div>
            {sales === null ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : sales.length === 0 ? (
              <p className="text-sub text-sm py-8 text-center">
                이 기간에 판매 기록이 없습니다.
              </p>
            ) : (
              <div className="max-h-[480px] overflow-y-auto -mx-1">
                {salesByDay.map(([day, items]) => {
                  const dayTotal = items.reduce(
                    (sum, x) => sum + x.price_at_sale * x.quantity,
                    0,
                  );
                  return (
                    <div key={day} className="mb-3 last:mb-0">
                      <div className="flex items-baseline justify-between text-xs text-sub font-medium px-1 mb-1">
                        <span>{dayLabel(items[0].sold_at)}</span>
                        <span className="num">{won(dayTotal)}</span>
                      </div>
                      <ul className="divide-y divide-border/60">
                        {items.map((s) => (
                          <li
                            key={s.id}
                            className="flex items-center gap-2 py-2 px-1"
                          >
                            <span className="text-lg w-6 text-center shrink-0">
                              {s.menu_emoji || '📦'}
                            </span>
                            <span className="flex-1 truncate">
                              {s.menu_name}
                              {s.quantity > 1 && (
                                <span className="text-sub"> ×{s.quantity}</span>
                              )}
                            </span>
                            <span className="num text-xs text-sub shrink-0">
                              {timeHM(s.sold_at)}
                            </span>
                            <span className="num font-medium w-20 text-right shrink-0 text-sm">
                              {won(s.price_at_sale * s.quantity)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>
        </>
      )}

      {/* 판매 내역 수정 — 모바일은 풀스크린, 데스크탑은 중앙 다이얼로그 */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg md:items-center md:justify-center md:bg-black/40 md:p-6">
          <div className="flex flex-col flex-1 min-h-0 w-full bg-bg overflow-hidden md:flex-none md:max-w-2xl md:max-h-[85vh] md:rounded-2xl md:border md:border-border md:shadow-2xl">
            <header className="px-4 h-14 flex items-center justify-between border-b border-border bg-card shrink-0">
              <h2 className="font-semibold">판매 내역 수정</h2>
              <button
                type="button"
                onClick={closeEdit}
                className="text-sm text-sub px-3 h-9 rounded-lg hover:bg-black/5"
              >
                닫기
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              <div className="max-w-2xl mx-auto w-full pb-8">
              {salesByDay.length === 0 ? (
                <p className="text-sub text-sm py-12 text-center">
                  수정할 기록이 없습니다.
                </p>
              ) : (
                salesByDay.map(([day, items]) => (
                  <div key={day} className="mb-4">
                    <div className="text-xs text-sub font-medium mb-2 px-1">
                      {dayLabel(items[0].sold_at)}
                    </div>
                    <ul className="card divide-y divide-border">
                      {items.map((s) => (
                        <li
                          key={s.id}
                          className={`py-2.5 px-4 flex flex-col gap-2 ${
                            busyId === s.id ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-lg w-6 text-center shrink-0">
                              {s.menu_emoji || '📦'}
                            </span>
                            <span className="flex-1 truncate font-medium">
                              {s.menu_name}
                            </span>
                            <span className="num text-xs text-sub shrink-0">
                              {timeHM(s.sold_at)} ·{' '}
                              {won(s.price_at_sale * s.quantity)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 self-end">
                            <button
                              type="button"
                              onClick={() => changeQty(s, s.quantity - 1)}
                              disabled={s.quantity <= 1 || busyId === s.id}
                              className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-border text-sub disabled:opacity-30"
                              aria-label="수량 감소"
                            >
                              −
                            </button>
                            <span className="num w-7 text-center text-sm">
                              {s.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => changeQty(s, s.quantity + 1)}
                              disabled={busyId === s.id}
                              className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-border text-sub disabled:opacity-30"
                              aria-label="수량 증가"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSale(s)}
                              disabled={busyId === s.id}
                              className="text-warm text-xs font-medium px-3 h-9 rounded-md hover:bg-warm/10 disabled:opacity-40 ml-1"
                            >
                              취소
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
