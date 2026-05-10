import { useEffect, useMemo, useState } from 'react';
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
import StatCard from '../components/StatCard';
import { Skeleton } from '../components/Skeleton';
import { apiGet } from '../lib/api';
import {
  endOfDay,
  pct,
  startOfDay,
  startOfMonth,
  startOfWeek,
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
interface Stats {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  qty: number;
  byMenu: ByMenu[];
  byDay: ByDay[];
  byCategory: ByCat[];
}

type Range = 'today' | 'week' | 'month' | 'custom';

const PIE_COLORS = ['#1B4332', '#2D6A4F', '#52796F', '#C99D52', '#E76F51', '#767270'];

export default function BI() {
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState<string>(ymd(new Date()));
  const [to, setTo] = useState<string>(ymd(new Date()));
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [rankBy, setRankBy] = useState<'qty' | 'revenue'>('revenue');

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

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const tz = -new Date().getTimezoneOffset(); // KST → 540
    apiGet<Stats>(`/api/stats?from=${fromMs}&to=${toMs}&tz=${tz}`)
      .then((d) => {
        if (alive) setStats(d);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [fromMs, toMs]);

  const ranked = useMemo(() => {
    if (!stats) return [];
    const sorted = [...stats.byMenu].sort((a, b) =>
      rankBy === 'qty' ? b.qty - a.qty : b.revenue - a.revenue,
    );
    return sorted.slice(0, 10);
  }, [stats, rankBy]);

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-0 py-4 md:py-0">
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
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              className="field h-10 px-2 num text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-sub">~</span>
            <input
              type="date"
              className="field h-10 px-2 num text-sm"
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
                    <Bar dataKey="revenue" fill="#1B4332" radius={[6, 6, 0, 0]} />
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
        </>
      )}
    </div>
  );
}
