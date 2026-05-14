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
import { getCache, setCache, isFresh, invalidate, invalidateByPrefix } from '../lib/cache';
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
  wonCompact,
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

interface NeedsStats {
  total: number;
  gender: Record<string, number>;
  ageBand: Record<string, number>;
  withChild: Record<string, number>;
  purpose: Record<string, number>;
  residence: Record<string, number>;
  topMenus: { menuId: number; name: string | null; emoji: string | null; count: number }[];
}

interface CostItem {
  id: number;
  label: string;
  amount: number;
  sort_order: number;
}

type Range = 'today' | 'week' | 'month' | 'lastMonth' | 'custom';

const PIE_COLORS = ['#1B4332', '#2D6A4F', '#52796F', '#C99D52', '#E76F51', '#767270'];

const TTL_STATS = 30 * 1000;
// (이전 'TTL_INSIGHTS = 1h'는 이번 달 진행 중 케이스용이었음. AI는 지난 달 고정으로 단순화되면서 항상 30일 TTL 적용 — fetch effect 안에 인라인.)
const SALES_PAGE = 30; // 판매내역 한 페이지 (스크롤 시 다음 페이지 로드)
const COST_RECOMMENDED_LABELS = [
  '임대료',
  '공과금',
  '통신비',
  '보험·세금',
  '구독·소프트웨어',
  '마케팅',
  '알바비',
];
const MAX_COST_ITEMS = 30;
const prevYearMonth = (ym: string): string => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, '0')}`;
};

interface SalesPage {
  sales: Sale[];
  hasMore: boolean;
  total?: number; // 첫 페이지에만
}

// 고객 니즈 한 항목(성별/연령대/...)의 분포를 가로 막대 + 범례로
function NeedsDim({
  title,
  items,
}: {
  title: string;
  items: { label: string; count: number }[];
}) {
  const sum = items.reduce((s, x) => s + x.count, 0);
  if (sum === 0) return null;
  return (
    <div>
      <div className="text-sm font-medium mb-1.5">{title}</div>
      <div className="h-2.5 rounded-full overflow-hidden flex bg-border/40">
        {items.map((x, i) => (
          <div
            key={i}
            style={{
              width: `${(x.count / sum) * 100}%`,
              background: PIE_COLORS[i % PIE_COLORS.length],
            }}
          />
        ))}
      </div>
      <div className="text-[11px] text-sub mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
        {items.map((x, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full inline-block shrink-0"
              style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
            />
            {x.label} <span className="num">{x.count}</span> ·{' '}
            {Math.round((x.count / sum) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

export default function BI() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState<string>(ymd(new Date()));
  const [to, setTo] = useState<string>(ymd(new Date()));
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [rankBy, setRankBy] = useState<'qty' | 'revenue'>('revenue');
  const [sales, setSales] = useState<Sale[] | null>(null); // 누적 (커서 페이지네이션)
  const [salesHasMore, setSalesHasMore] = useState(false);
  const [salesTotal, setSalesTotal] = useState<number | null>(null); // 기간 내 전체 건수
  const [salesLoadingMore, setSalesLoadingMore] = useState(false);
  const salesScrollRef = useRef<HTMLDivElement | null>(null); // 판매내역 스크롤 컨테이너 (무한스크롤 root)
  const salesSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreLockRef = useRef(false); // 다음 페이지 인플라이트 동기 가드 (옵저버 중복 발화 방지)
  const salesPeriodRef = useRef(''); // 현재 기간 키 — loadMore 응답 도착 시 기간 바뀌었는지 확인용
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [needsStats, setNeedsStats] = useState<NeedsStats | null>(null);
  // (monthNeedsStats prefetch는 AI 인사이트 cadence 단순화로 제거됨 — AI fetch effect가
  //  지난 달 needs를 stats와 함께 fetch한다.)
  // 이번 달 고정비 — null = 아직 안 불러옴, 빈 배열 = 등록 없음
  const [monthCostItems, setMonthCostItems] = useState<CostItem[] | null>(null);
  const [costEditOpen, setCostEditOpen] = useState(false);
  // 편집 버퍼 — amount는 input UX 위해 문자열로 유지, 저장 시 파싱
  const [editingCosts, setEditingCosts] = useState<{ label: string; amount: string }[]>([]);
  const [costSaving, setCostSaving] = useState(false);
  const [costMsg, setCostMsg] = useState<string | null>(null);
  // AI 인사이트 — 상단 range selector(오늘/이번 주/이번 달/사용자 지정)와 자동 연동.
  // 진행 중 단위면 직전 완료 단위로 자동 시프트("1주차가 끝나지 않으면 전주차꺼"). aiWindow 참조.
  // period key = `${fromMs}:${toMs}` — 같은 기간 재선택 시 인메모리 캐시 hit.
  const [aiByPeriod, setAiByPeriod] = useState<Record<string, string[] | null>>({});
  const aiInflightRef = useRef<Set<string>>(new Set()); // 인플라이트 period key — 중복 POST 방지
  // 판매/고정비 변경 시 AI fetch effect를 강제 재실행 — deps에 포함되는 nonce
  // (aiByPeriod 비워도 effect deps는 안 바뀌어 effect 재발 안 함 → 영구 스켈레톤 락)
  const [aiRefreshNonce, setAiRefreshNonce] = useState(0);
  // 메뉴 등록 여부 — BI 빈 상태에서 "메뉴 없음"과 "이 기간 판매 없음"을 구분하기 위함. null=아직 모름.
  const [menuCount, setMenuCount] = useState<number | null>(() => {
    const c = getCache<{ id: number }[]>(`menus:${userId}`);
    return c ? c.length : null;
  });
  // 수정 모달 안에서 판매가 바뀌었는지 — 닫을 때 인사이트 1회만 재호출(매 −/＋ 마다 X)
  const editDirtyRef = useRef(false);

  const [fromMs, toMs] = useMemo(() => {
    const now = new Date();
    if (range === 'today') return [startOfDay(now).getTime(), endOfDay(now).getTime()];
    if (range === 'week')
      return [startOfWeek(now).getTime(), endOfDay(now).getTime()];
    if (range === 'month')
      return [startOfMonth(now).getTime(), endOfDay(now).getTime()];
    if (range === 'lastMonth') {
      // 지난 달 1일 00:00 ~ 지난 달 말일 23:59:59 (KST 로컬)
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevEnd = new Date(prev.getFullYear(), prev.getMonth() + 1, 0);
      return [prev.getTime(), endOfDay(prevEnd).getTime()];
    }
    return [
      startOfDay(new Date(from)).getTime(),
      endOfDay(new Date(to)).getTime(),
    ];
  }, [range, from, to]);

  // 이번 달 윈도우 (세션 동안 고정) — "이번 달" 기간 선택과 동일한 from/to라 stats 캐시도 공유
  const [monthFromMs, monthToMs, currentYm] = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return [startOfMonth(now).getTime(), endOfDay(now).getTime(), ym];
  }, []);
  const monthStatsCacheKey = `stats:${userId}:${monthFromMs}:${monthToMs}`;
  const monthCostsKey = `fixedCosts:${userId}:${currentYm}`;
  // 이번 달 고정비 총합 (useMemo로 파생) — 인사이트 키·prompt에 동봉
  const monthFixedCost = useMemo(
    () => (monthCostItems ? monthCostItems.reduce((s, x) => s + x.amount, 0) : 0),
    [monthCostItems],
  );
  // AI 인사이트는 **항상 지난 달 전체** 고정. range selector(stats·차트용)와 연동 끊김.
  // 사장님 결정: "오늘 2주차 이런거 의미없다. 저번달거 보여주고 니즈랑 판매해서 전략제시".
  // 완료된 달이라 D1 영구 저장본 hit이면 LLM 호출 0회.
  const aiWindow = useMemo(() => {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pmEnd = endOfDay(new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0));
    const ym = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    return {
      cardTitle: `${prevMonth.getMonth() + 1}월 전체 분석`,
      fromMs: prevMonth.getTime(),
      toMs: pmEnd.getTime(),
      ym,
    };
  }, []);
  // 지난 달 일수 (헤딩 + LLM 메타) — floor((to-from)/DAY)+1로 정확히 N일치
  const aiPeriodDays = Math.floor((aiWindow.toMs - aiWindow.fromMs) / 86400000) + 1;

  const statsCacheKey = `stats:${userId}:${fromMs}:${toMs}`;
  const tzOffset = -new Date().getTimezoneOffset();

  const refetchStats = useCallback(async () => {
    invalidate(statsCacheKey);
    const d = await apiGet<Stats>(
      `/api/stats?from=${fromMs}&to=${toMs}&tz=${tzOffset}`,
    );
    setStats(d);
    setCache(statsCacheKey, d);
  }, [statsCacheKey, fromMs, toMs, tzOffset]);

  const refetchMonthStats = useCallback(async () => {
    invalidate(monthStatsCacheKey);
    const d = await apiGet<Stats>(
      `/api/stats?from=${monthFromMs}&to=${monthToMs}&tz=${tzOffset}`,
    );
    setCache(monthStatsCacheKey, d);
  }, [monthStatsCacheKey, monthFromMs, monthToMs, tzOffset]);

  // 첫 페이지부터 다시 — 페이지네이션 상태 리셋 (편집 실패 후 재동기화용)
  const refetchSales = useCallback(async () => {
    const d = await apiGet<SalesPage>(`/api/sales?from=${fromMs}&to=${toMs}&limit=${SALES_PAGE}`);
    setSales(d.sales);
    setSalesHasMore(d.hasMore);
    setSalesTotal(d.total ?? d.sales.length);
  }, [fromMs, toMs]);

  // 다음 페이지 — 마지막 항목을 커서로. 스크롤 sentinel / "더 보기" 버튼이 호출.
  const loadMoreSales = useCallback(async () => {
    if (loadMoreLockRef.current || !salesHasMore || !sales || sales.length === 0) return;
    const last = sales[sales.length - 1];
    const reqKey = `${fromMs}-${toMs}`; // 이 요청의 기간 — 도착 시 salesPeriodRef와 다르면 폐기
    loadMoreLockRef.current = true;
    setSalesLoadingMore(true);
    try {
      const d = await apiGet<SalesPage>(
        `/api/sales?from=${fromMs}&to=${toMs}&limit=${SALES_PAGE}&cursorAt=${last.sold_at}&cursorId=${last.id}`,
      );
      if (salesPeriodRef.current !== reqKey) return; // 기간 바뀜 → 이 응답 버림
      // id 기준 중복 제거(이론상 동시 발화 대비) — 정상 경로에선 겹칠 일 없음
      setSales((prev) => {
        if (!prev) return d.sales;
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...d.sales.filter((s) => !seen.has(s.id))];
      });
      setSalesHasMore(d.hasMore);
    } catch {
      /* 다음 페이지 실패는 조용히 — 사용자가 다시 스크롤하면 재시도 */
    } finally {
      loadMoreLockRef.current = false;
      setSalesLoadingMore(false);
    }
  }, [salesHasMore, sales, fromMs, toMs]);

  useEffect(() => {
    let alive = true;
    const cached = getCache<Stats>(statsCacheKey);
    if (cached) {
      setStats(cached);
      setLoading(false);
    } else {
      // 캐시 미스 — 이전 기간 stats를 화면에 잠깐 더 둠(깜빡임 방지)
      setLoading(true);
    }
    setSales(null);
    setSalesHasMore(false);
    setSalesTotal(null);
    setSalesLoadingMore(false);
    loadMoreLockRef.current = false; // 기간 바뀜 — 인플라이트 loadMore 락 해제(스테일 응답은 salesPeriodRef로 폐기)
    salesPeriodRef.current = `${fromMs}-${toMs}`;
    const tasks: Promise<unknown>[] = [];
    if (!isFresh(statsCacheKey, TTL_STATS)) {
      tasks.push(
        apiGet<Stats>(`/api/stats?from=${fromMs}&to=${toMs}&tz=${tzOffset}`).then(
          (d) => {
            if (!alive) return;
            setStats(d);
            setCache(statsCacheKey, d);
          },
        ),
      );
    }
    tasks.push(
      apiGet<SalesPage>(`/api/sales?from=${fromMs}&to=${toMs}&limit=${SALES_PAGE}`).then((d) => {
        if (!alive) return;
        setSales(d.sales);
        setSalesHasMore(d.hasMore);
        setSalesTotal(d.total ?? d.sales.length);
      }),
    );
    Promise.all(tasks).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMs, toMs, userId]);

  // 판매내역 무한스크롤 — 스크롤 박스(root) 안 sentinel이 보이면 다음 페이지. (편집 모달 닫혀 있을 때만)
  useEffect(() => {
    if (editOpen || !salesHasMore) return;
    const sentinel = salesSentinelRef.current;
    const root = salesScrollRef.current;
    if (!sentinel || !root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreSales();
      },
      { root, rootMargin: '160px' },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [editOpen, salesHasMore, loadMoreSales]);

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

  // 이번 달 통합 prefetch — "월 전체" AI 인사이트 + 니즈 카드 + 고정비 카드용. 단위별 AI는 lazy.
  useEffect(() => {
    let alive = true;
    // monthStats 캐시 prefetch — 사장님이 "월 전체" 칩 클릭하면 cache hit
    if (!isFresh(monthStatsCacheKey, TTL_STATS)) {
      apiGet<Stats>(`/api/stats?from=${monthFromMs}&to=${monthToMs}&tz=${tzOffset}`)
        .then((d) => {
          if (!alive) return;
          setCache(monthStatsCacheKey, d);
        })
        .catch(() => {});
    }
    // 이번 달 고정비 — 캐시 우선, 백그라운드 갱신. 실패해도 빈 배열로 두어 BI 진행 계속
    const cachedCosts = getCache<{ items: CostItem[]; total: number }>(monthCostsKey);
    if (cachedCosts) setMonthCostItems(cachedCosts.items);
    if (!isFresh(monthCostsKey, TTL_STATS)) {
      apiGet<{ items: CostItem[]; total: number }>(`/api/monthly-costs?ym=${currentYm}`)
        .then((d) => {
          if (!alive) return;
          setMonthCostItems(d.items);
          setCache(monthCostsKey, d);
        })
        .catch(() => alive && setMonthCostItems((p) => p ?? []));
    }
    return () => {
      alive = false;
    };
  }, [monthStatsCacheKey, monthCostsKey, monthFromMs, monthToMs, tzOffset, currentYm]);

  // 고객 니즈 집계 (선택 기간) — /needs 페이지와 별개, BI에 요약 카드로
  useEffect(() => {
    let alive = true;
    const key = `needsStats:${userId}:${fromMs}:${toMs}`;
    const cached = getCache<NeedsStats>(key);
    if (cached) setNeedsStats(cached);
    // 캐시 미스여도 이전 기간 값을 잠깐 더 둠(깜빡임 방지) — 다른 BI 섹션과 동일하게
    if (isFresh(key, TTL_STATS)) return;
    apiGet<NeedsStats>(`/api/needs/stats?from=${fromMs}&to=${toMs}`)
      .then((d) => {
        if (!alive) return;
        setNeedsStats(d);
        setCache(key, d);
      })
      .catch(() => {
        if (alive)
          setNeedsStats((p) => p ?? {
            total: 0,
            gender: {},
            ageBand: {},
            withChild: {},
            purpose: {},
            residence: {},
            topMenus: [],
          });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMs, toMs, userId]);

  // ─── 고정비 모달 핸들러 ──────────────────────────────────────────
  const openCostEdit = () => {
    if (monthCostItems && monthCostItems.length > 0) {
      // 기존 항목 편집
      setEditingCosts(
        monthCostItems.map((it) => ({ label: it.label, amount: String(it.amount) })),
      );
    } else {
      // 첫 입력 — 추천 라벨 7개 빈 금액으로 + 사용자 추가용 빈 행 한 줄
      setEditingCosts(COST_RECOMMENDED_LABELS.map((l) => ({ label: l, amount: '' })));
    }
    setCostMsg(null);
    setCostEditOpen(true);
  };
  const updateCostRow = (i: number, key: 'label' | 'amount', v: string) => {
    setEditingCosts((rows) => {
      const copy = rows.slice();
      copy[i] = { ...copy[i], [key]: v };
      return copy;
    });
  };
  const addCostRow = () => {
    if (editingCosts.length >= MAX_COST_ITEMS) return;
    setEditingCosts((rows) => [...rows, { label: '', amount: '' }]);
  };
  const removeCostRow = (i: number) => {
    setEditingCosts((rows) => rows.filter((_, idx) => idx !== i));
  };
  const copyPrevCosts = async () => {
    const prevYm = prevYearMonth(currentYm);
    try {
      const d = await apiGet<{ items: CostItem[]; total: number }>(
        `/api/monthly-costs?ym=${prevYm}`,
      );
      if (d.items.length === 0) {
        setCostMsg('지난 달에 등록된 고정비가 없어요.');
        return;
      }
      setEditingCosts(d.items.map((it) => ({ label: it.label, amount: String(it.amount) })));
      setCostMsg('지난 달 항목을 가져왔어요. 확인하고 저장하세요.');
    } catch {
      setCostMsg('지난 달 데이터를 불러오지 못했어요.');
    }
  };
  const saveCosts = async () => {
    if (costSaving) return;
    // 라벨이 비었거나 금액이 비어/0이면 제외 — 자연스럽게 "해당 칸만 채우면 됨"
    const cleaned = editingCosts
      .map((row, i) => ({
        label: row.label.trim(),
        amount: Number(row.amount.replace(/,/g, '')) || 0,
        sort_order: i,
      }))
      .filter((row) => row.label.length > 0 && row.amount > 0);
    setCostSaving(true);
    try {
      const d = await apiPut<{ items: CostItem[]; total: number }>(
        `/api/monthly-costs?ym=${currentYm}`,
        { items: cleaned },
      );
      setMonthCostItems(d.items);
      setCache(monthCostsKey, d);
      // 고정비가 바뀌면 AI 인사이트(이번 달 단위) 캐시·메모리 모두 무효화 + 재호출 트리거
      invalidateByPrefix(`insights:${userId}:`);
      setAiByPeriod({});
      setAiRefreshNonce((n) => n + 1);
      setCostEditOpen(false);
    } catch (e) {
      setCostMsg(e instanceof Error ? e.message : '저장에 실패했어요.');
    } finally {
      setCostSaving(false);
    }
  };

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
      try {
        await Promise.all([refetchStats(), refetchSales()]); // 실패 → 1페이지부터 재동기화
      } catch {
        /* 재동기화 실패는 무시 */
      }
    } finally {
      setBusyId(null);
    }
  };
  const removeSale = async (sale: Sale) => {
    if (busyId === sale.id) return;
    if (!confirm(`'${sale.menu_name}' 판매 기록을 취소할까요?`)) return;
    setBusyId(sale.id);
    setSales((prev) => (prev ? prev.filter((x) => x.id !== sale.id) : prev));
    setSalesTotal((t) => (t != null ? t - 1 : t));
    try {
      await apiDelete(`/api/sales/${sale.id}`);
      editDirtyRef.current = true;
      await refetchStats();
    } catch (e) {
      alert(e instanceof Error ? e.message : '취소 실패');
      try {
        await Promise.all([refetchStats(), refetchSales()]); // 실패 → 1페이지부터 재동기화
      } catch {
        /* 재동기화 실패는 무시 */
      }
    } finally {
      setBusyId(null);
    }
  };

  const closeEdit = async () => {
    setEditOpen(false);
    // 편집 결과는 이미 낙관적으로 sales에 반영됨 — 목록 재호출 안 함(페이지네이션 상태 유지). 집계만 갱신.
    if (editDirtyRef.current) {
      editDirtyRef.current = false;
      try {
        await refetchMonthStats(); // 수정이 이번 달에 반영됐을 수 있음
      } catch {
        /* 무시 — 인사이트 재호출은 계속 진행 */
      }
      // 판매가 바뀌면 그 기간 AI 인사이트가 영향 받음 → 클라이언트 캐시·메모리 일괄 무효화 + 재호출 트리거
      // (서버는 sales.ts에서 sold_at→ym으로 ai_insights 행 자동 무효화)
      invalidateByPrefix(`insights:${userId}:`);
      setAiByPeriod({});
      setAiRefreshNonce((n) => n + 1);
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

// AI 인사이트 fetch — 지난 달 전체 분석 1회. 완료된 달이라 D1 영구 저장본 hit 시 LLM 호출 0회.
  // 사장님 결정: "니즈랑 판매해서 전략제시" — 지난 달 stats+needs를 함께 보내 LLM이 종합 분석.
  useEffect(() => {
    if (!user) return;
    const w = aiWindow;
    const periodKey = `${w.fromMs}:${w.toMs}`;
    if (aiInflightRef.current.has(periodKey)) return;
    const bt = user.business_type ?? 'none';
    const key = `insights:${userId}:${bt}:${periodKey}`;
    const ttl = 30 * 24 * 60 * 60 * 1000; // 지난 달은 변하지 않음 — 30일 TTL

    const cached = getCache<string[]>(key);
    if (cached) {
      setAiByPeriod((prev) => (prev[periodKey] === cached ? prev : { ...prev, [periodKey]: cached }));
      if (isFresh(key, ttl)) return;
    } else if (aiByPeriod[periodKey] === undefined) {
      setAiByPeriod((prev) => ({ ...prev, [periodKey]: null }));
    }

    aiInflightRef.current.add(periodKey);
    const capturedKey = periodKey;
    (async () => {
      try {
        // D1 영구 저장본 먼저 (LLM 호출 X)
        const got = await apiGet<{ found: boolean; insights?: string[] }>(
          `/api/insights?ym=${w.ym}`,
        );
        if (got.found && got.insights && got.insights.length > 0) {
          setAiByPeriod((prev) => ({ ...prev, [capturedKey]: got.insights! }));
          setCache(key, got.insights);
          return;
        }
        // miss → 지난 달 stats+needs 함께 fetch 후 LLM 호출 + D1 저장
        const aiStatsKey = `stats:${userId}:${w.fromMs}:${w.toMs}`;
        const cachedStats = getCache<Stats>(aiStatsKey);
        const statsPromise =
          cachedStats && isFresh(aiStatsKey, TTL_STATS)
            ? Promise.resolve(cachedStats)
            : apiGet<Stats>(`/api/stats?from=${w.fromMs}&to=${w.toMs}&tz=${tzOffset}`).then((s) => {
                setCache(aiStatsKey, s);
                return s;
              });
        const needsPromise = apiGet<NeedsStats>(
          `/api/needs/stats?from=${w.fromMs}&to=${w.toMs}`,
        ).catch(() => null);
        const [stats, needs] = await Promise.all([statsPromise, needsPromise]);
        const activeDays = (stats.byDay ?? []).filter((d) => d.revenue > 0).length;
        if (stats.qty < 5) {
          setAiByPeriod((prev) => ({ ...prev, [capturedKey]: [] }));
          setCache(key, []);
          return;
        }
        const peakHour =
          stats.byHour && stats.byHour.length > 0
            ? [...stats.byHour].sort((a, b) => b.revenue - a.revenue)[0]?.hour ?? null
            : null;
        const ymdLocal = (ms: number) => {
          const d = new Date(ms);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const body: Record<string, unknown> = {
          stats: { ...stats, peakHour },
          rangeLabel: w.cardTitle,
          businessType: bt === 'none' ? undefined : bt,
          periodDays: aiPeriodDays,
          periodActiveDays: activeDays,
          periodStart: ymdLocal(w.fromMs),
          periodEnd: ymdLocal(w.toMs),
          ym: w.ym, // 지난 달이라 서버가 D1에 영구 저장
        };
        if (needs && needs.total > 0) body.needs = needs;
        const result = await apiPost<{ insights: string[] }>('/api/insights', body);
        setAiByPeriod((prev) => ({ ...prev, [capturedKey]: result.insights }));
        if (result.insights.length > 0) setCache(key, result.insights);
      } catch {
        setAiByPeriod((prev) => ({ ...prev, [capturedKey]: [] }));
      } finally {
        aiInflightRef.current.delete(capturedKey);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiWindow.fromMs, aiWindow.toMs, aiWindow.ym, userId, user?.business_type, aiRefreshNonce]);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="font-display text-2xl md:text-3xl">BI 대시보드</h1>
      </div>

      {/* 5칩 한 줄 유지를 위해 모바일에선 padding·text·gap 축소, md↑에선 원래 크기. */}
      <div className="card p-2.5 md:p-3 mb-4 flex items-center gap-1 md:gap-2 flex-wrap md:flex-nowrap">
        {(['today', 'week', 'month', 'lastMonth', 'custom'] as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`flex-auto whitespace-nowrap px-2 md:px-3.5 h-9 md:h-10 rounded-lg text-xs md:text-sm border transition ${
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
              : r === 'lastMonth'
              ? '지난달'
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

      {/* AI 인사이트 — 항상 지난 달 전체 분석. range selector와 무관, 한 번 생성 후 D1 영구 저장. */}
      <div className="card p-4 mb-4 border-accent/25 bg-accent/[0.03]">
        <div className="flex items-baseline gap-1.5 mb-3">
          <span className="text-base leading-none shrink-0">💡</span>
          <h3 className="font-semibold text-accent break-keep">
            {aiWindow.cardTitle}
          </h3>
          <span className="text-sub text-xs num shrink-0">· {aiPeriodDays}일치</span>
        </div>
        {(() => {
          const periodKey = `${aiWindow.fromMs}:${aiWindow.toMs}`;
          const data = aiByPeriod[periodKey];
          if (data === undefined || data === null) {
            return (
              <div className="space-y-2 anim-fade">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            );
          }
          if (data.length === 0) {
            return (
              <p className="text-sub text-sm py-2 break-keep">
                이 기간엔 데이터가 아직 적어요. 더 쌓이면 더 정확한 분석을 드릴 수 있어요.
              </p>
            );
          }
          return (
            <ul className="space-y-2 text-sm leading-relaxed anim-fade">
              {data.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-accent/50 shrink-0 select-none">•</span>
                  <span className="text-ink/90">{t}</span>
                </li>
              ))}
            </ul>
          );
        })()}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
          {(() => {
            // 순이익/마진율 dynamic — range=month + 고정비 등록 시 net(고정비까지 차감), 그 외엔 gross.
            const hasFc = range === 'month' && monthFixedCost > 0;
            const netProfit = hasFc ? stats.profit - monthFixedCost : stats.profit;
            const netMargin = stats.revenue > 0 ? netProfit / stats.revenue : 0;
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <StatCard label="총매출" value={wonCompact(stats.revenue)} tone="accent" />
                <StatCard label="총원가" value={wonCompact(stats.cost)} />
                <StatCard
                  label="순이익"
                  value={wonCompact(netProfit)}
                  hint={hasFc ? `고정비 ${wonCompact(monthFixedCost)} 차감 후` : undefined}
                  tone={netProfit >= 0 ? 'accent' : 'warm'}
                />
                <StatCard
                  label="마진율"
                  value={stats.revenue > 0 ? pct(netMargin) : '—'}
                  hint={hasFc ? '고정비 차감 후' : `${stats.qty}건 판매`}
                />
              </div>
            );
          })()}

          {/* 이번 달 고정비 — 등록 권유 CTA 또는 요약 카드. 빈 상태 친근하게. */}
          {monthCostItems !== null && monthCostItems.length === 0 ? (
            <button
              type="button"
              onClick={openCostEdit}
              className="card w-full p-4 mb-6 flex items-center justify-between text-left hover:border-accent/40 transition group"
            >
              <div className="min-w-0">
                <div className="font-medium break-keep">
                  이번 달 고정비도 적어두면, 손에 쥐는 돈이 보여요
                </div>
                <div className="text-sub text-xs mt-1 break-keep">
                  임대료·공과금·인건비 등을 한 번 적어두면 실제 순이익을 알려드려요
                </div>
              </div>
              <span className="text-sub group-hover:text-accent transition shrink-0 ml-3">→</span>
            </button>
          ) : monthCostItems && monthCostItems.length > 0 ? (
            <div className="card p-4 mb-6">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-semibold text-sm">이번 달 고정비</h3>
                <button
                  type="button"
                  onClick={openCostEdit}
                  className="text-sm text-accent font-medium px-3 h-10 rounded-lg hover:bg-accent/10 -my-1"
                >
                  수정
                </button>
              </div>
              <ul className="space-y-1 text-sm">
                {monthCostItems.slice(0, 3).map((it) => (
                  <li key={it.id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-ink/80">{it.label}</span>
                    <span className="num text-ink/90 shrink-0">{won(it.amount)}</span>
                  </li>
                ))}
                {monthCostItems.length > 3 && (
                  <li className="text-xs text-sub pt-0.5">외 {monthCostItems.length - 3}개</li>
                )}
              </ul>
              <div className="mt-3 pt-2 border-t border-border flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">합계</span>
                <span className="num font-semibold">{won(monthFixedCost)}</span>
              </div>
            </div>
          ) : null}

          {/* 좌·우 카드 같은 높이 (grid stretch 디폴트). 좌측 차트는 카드 안을 다 채움. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="card p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h3 className="font-semibold">일별 손익 추이</h3>
              </div>
              {stats.byDay.length === 0 ? (
                <div className="flex-1 min-h-[220px] flex items-center justify-center">
                  <p className="text-sub text-sm text-center">
                    이 기간에 판매 기록이 없습니다.
                  </p>
                </div>
              ) : stats.byDay.length === 1 ? (
                <div className="flex-1 min-h-[220px] flex flex-col items-center justify-center text-center">
                  <div
                    className={`num text-3xl md:text-4xl font-bold ${
                      stats.byDay[0].profit >= 0 ? 'text-accent' : 'text-warm'
                    }`}
                  >
                    {won(stats.byDay[0].profit)}
                  </div>
                  <p className="text-sub text-xs mt-2 break-keep px-4">
                    데이터가 더 쌓이면 일별 추이 차트로 보여드릴게요.
                  </p>
                </div>
              ) : (
                /* 차트 영역 flex-1: 카드 안 남은 높이를 차트가 다 채움.
                   min-h-[220px]로 모바일·짧은 카드일 때 차트 최소 높이 보장. */
                <div className="flex-1 min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
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
                        Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : `${v}`
                      }
                    />
                    <Tooltip
                      formatter={(v: number) => won(v)}
                      labelFormatter={(l) => l}
                    />
                    <Bar dataKey="profit" name="손익" radius={[6, 6, 0, 0]}>
                      {stats.byDay.map((d, i) => (
                        <Cell key={i} fill={d.profit >= 0 ? '#1B4332' : '#E76F51'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                </div>
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

          {/* 고객 니즈 — /needs 기록 요약 (선택 기간) */}
          {needsStats === null ? (
            <div className="card p-4 mb-4">
              <Skeleton className="h-4 w-20 mb-3" />
              <div className="grid sm:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-3 w-16 mb-2" />
                    <Skeleton className="h-2.5 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ) : needsStats.total === 0 ? null : (
            <div className="card p-4 mb-4">
              <div className="flex items-baseline justify-between mb-3 gap-2">
                <h3 className="font-semibold">
                  고객 니즈{' '}
                  <span className="text-sub font-normal text-sm num">
                    {needsStats.total}건
                  </span>
                </h3>
                <Link
                  to="/needs"
                  className="text-xs text-accent hover:underline shrink-0"
                >
                  기록하기 →
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-5 gap-y-4">
                <NeedsDim
                  title="성별"
                  items={[
                    { label: '여성', count: needsStats.gender.female ?? 0 },
                    { label: '남성', count: needsStats.gender.male ?? 0 },
                  ]}
                />
                <NeedsDim
                  title="연령대"
                  items={[
                    { label: '10–20대', count: needsStats.ageBand['10s_20s'] ?? 0 },
                    { label: '30–40대', count: needsStats.ageBand['30s_40s'] ?? 0 },
                    { label: '50대+', count: needsStats.ageBand['50plus'] ?? 0 },
                  ]}
                />
                <NeedsDim
                  title="자녀 동반"
                  items={[
                    { label: '동반', count: needsStats.withChild.yes ?? 0 },
                    { label: '미동반', count: needsStats.withChild.no ?? 0 },
                  ]}
                />
                <NeedsDim
                  title="목적"
                  items={[
                    { label: '식사대용', count: needsStats.purpose.meal_replacement ?? 0 },
                    { label: '선물용', count: needsStats.purpose.gift ?? 0 },
                    { label: '자녀 간식용', count: needsStats.purpose.kids_snack ?? 0 },
                  ]}
                />
                <NeedsDim
                  title="거주지"
                  items={[
                    { label: '부산', count: needsStats.residence.busan ?? 0 },
                    { label: '부산 외', count: needsStats.residence.outside ?? 0 },
                  ]}
                />
              </div>
              {needsStats.topMenus.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border">
                  <div className="text-sm font-medium mb-2">자주 언급된 제품</div>
                  <ul className="space-y-1.5">
                    {needsStats.topMenus.map((m) => {
                      const max = needsStats.topMenus[0].count || 1;
                      return (
                        <li
                          key={m.menuId}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span className="text-base shrink-0">
                            {m.emoji || '📦'}
                          </span>
                          <span className="flex-1 min-w-0 truncate">
                            {m.name ?? '(삭제된 메뉴)'}
                          </span>
                          <div className="w-20 sm:w-32 h-2 rounded-full bg-border/40 overflow-hidden shrink-0">
                            <div
                              className="h-full bg-accent rounded-full"
                              style={{ width: `${(m.count / max) * 100}%` }}
                            />
                          </div>
                          <span className="num text-sub text-xs w-6 text-right shrink-0">
                            {m.count}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:items-start">
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
                    className="flex items-center gap-2 md:gap-3 py-2.5"
                  >
                    <span className="num w-5 md:w-6 text-sub text-sm shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-xl shrink-0">{m.emoji || '📦'}</span>
                    <span className="flex-1 min-w-0 truncate font-medium">
                      {m.name}
                    </span>
                    <span className="num text-sub text-xs md:text-sm shrink-0">
                      {m.qty}개
                    </span>
                    <span className="num font-semibold w-24 md:w-28 text-right shrink-0">
                      {won(m.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 판매 내역 — 카드 사용내역 스타일 날짜별 그룹 (읽기 전용, 스크롤 시 더 로드) */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">
                판매 내역
                {salesTotal != null
                  ? ` (전체 ${salesTotal.toLocaleString('ko-KR')}건)`
                  : sales
                  ? ` (${sales.length}건)`
                  : ''}
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
              <div
                key={`sales-${fromMs}-${toMs}`}
                ref={salesScrollRef}
                className="max-h-[480px] overflow-y-auto -mx-1"
              >
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
                {salesLoadingMore && (
                  <div className="space-y-2 pt-1">
                    <Skeleton className="h-12" />
                    <Skeleton className="h-12" />
                  </div>
                )}
                {salesHasMore && !salesLoadingMore && (
                  <button
                    type="button"
                    onClick={loadMoreSales}
                    className="w-full py-3 text-sm text-accent font-medium hover:bg-accent/5 rounded-lg"
                  >
                    더 보기
                  </button>
                )}
                {/* 무한스크롤 sentinel — 보이면 다음 페이지 자동 로드 */}
                {salesHasMore && <div ref={salesSentinelRef} className="h-px" />}
                {!salesHasMore && sales.length > SALES_PAGE && (
                  <p className="text-center text-xs text-sub py-2">전체 다 봤어요</p>
                )}
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
              {salesHasMore && (
                <button
                  type="button"
                  onClick={loadMoreSales}
                  disabled={salesLoadingMore}
                  className="w-full py-3 text-sm text-accent font-medium hover:bg-accent/5 rounded-lg disabled:opacity-50"
                >
                  {salesLoadingMore ? '불러오는 중…' : '더 보기'}
                </button>
              )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 이번 달 고정비 편집 모달 — 모바일 풀스크린, 데스크탑 중앙 다이얼로그 */}
      {costEditOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg md:items-center md:justify-center md:bg-black/40 md:p-6">
          <div className="flex flex-col flex-1 min-h-0 w-full bg-bg overflow-hidden md:flex-none md:max-w-xl md:max-h-[85vh] md:rounded-2xl md:border md:border-border md:shadow-2xl">
            <header className="px-4 h-14 flex items-center justify-between border-b border-border bg-card shrink-0">
              <h2 className="font-semibold">이번 달 고정비</h2>
              <button
                type="button"
                onClick={() => setCostEditOpen(false)}
                className="text-sm text-sub px-3 h-9 rounded-lg hover:bg-black/5"
              >
                닫기
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              <p className="text-sub text-sm mb-3 break-keep">
                해당하는 칸만 채우면 돼요. 빈 줄은 자동으로 제외됩니다.
              </p>
              <button
                type="button"
                onClick={copyPrevCosts}
                className="text-sm text-accent font-medium px-3 h-10 rounded-lg hover:bg-accent/10 mb-3 inline-flex items-center gap-1"
              >
                지난 달과 같이 채우기 <span aria-hidden>→</span>
              </button>
              {costMsg && (
                <div className="text-sm text-sub mb-3 px-3 py-2 rounded-md bg-bg border border-border">
                  {costMsg}
                </div>
              )}
              <ul className="space-y-2">
                {editingCosts.map((row, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => updateCostRow(i, 'label', e.target.value)}
                      placeholder="항목명"
                      maxLength={20}
                      className="field flex-1 min-w-0 h-10"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.amount ? Number(row.amount).toLocaleString('ko-KR') : ''}
                      onChange={(e) =>
                        updateCostRow(i, 'amount', e.target.value.replace(/[^\d]/g, ''))
                      }
                      placeholder="금액"
                      className="field w-32 h-10 num text-right"
                    />
                    <button
                      type="button"
                      onClick={() => removeCostRow(i)}
                      className="text-warm w-10 h-10 inline-flex items-center justify-center rounded-md hover:bg-warm/10 shrink-0"
                      aria-label="삭제"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              {editingCosts.length < MAX_COST_ITEMS && (
                <button
                  type="button"
                  onClick={addCostRow}
                  className="mt-3 text-sm text-accent font-medium px-3 h-10 rounded-lg hover:bg-accent/10"
                >
                  + 항목 추가
                </button>
              )}
            </div>
            <footer className="px-4 py-3 border-t border-border bg-card shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCostEditOpen(false)}
                disabled={costSaving}
                className="btn-outline flex-1 h-11"
              >
                취소
              </button>
              <button
                type="button"
                onClick={saveCosts}
                disabled={costSaving}
                className="btn-primary flex-[2] h-11"
              >
                {costSaving ? '저장 중…' : '저장'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
