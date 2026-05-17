import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { apiGet, apiPost } from '../lib/api';
import { businessTypeLabel } from '../lib/businessTypes';
import { Skeleton } from '../components/Skeleton';
import NavIcon from '../components/NavIcon';

interface AdminUser {
  id: number;
  email: string;
  business_name: string;
  business_type: string | null;
  is_admin: boolean;
  is_master: boolean;
  is_demo: boolean;
  mfa_enabled: boolean;
  created_at: number;
  sales_count: number;
  menu_count: number;
  last_login_at: number | null;     // user_login_events 최신 timestamp
  last_activity_at: number | null;  // sales·needs·login 중 최신
  access_until: number | null;      // 사용 기간 만료 (NULL = 무제한, master·demo)
}
interface AdminStats {
  total_users: number;
  demo_users: number;
  week_new_users: number;
  total_sales: number;
  total_needs: number;
  month_ai_calls: number;
  year_month: string;
}
interface AuditEntry {
  id: number;
  admin_user_id: number;
  admin_email: string | null;
  action: string;
  target_json: string | null;
  ip: string | null;
  ua: string | null;
  at: number;
  ok: boolean;
  error_msg: string | null;
}
interface LoginEntry {
  id: number;
  user_id: number;
  user_email: string | null;
  ip: string | null;
  ua: string | null;
  is_new_device: boolean;
  at: number;
}
interface PushLogEntry {
  id: number;
  admin_user_id: number;
  admin_email: string | null;
  target_kind: 'all' | 'user';
  target_user_id: number | null;
  title: string;
  body: string;
  url: string | null;
  subscribers_sent: number;
  subscribers_failed: number;
  at: number;
}
type LogKind = 'audit' | 'login' | 'push';
type LogEntry = AuditEntry | LoginEntry | PushLogEntry;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

type Tab = 'users' | 'access' | 'stats' | 'audit' | 'push';

export default function Admin() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_admin) return <Navigate to="/sales" replace />;

  return (
    <div className="max-w-3xl xl:max-w-4xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <div className="flex items-baseline gap-3 mb-3">
        <h1 className="font-display text-2xl md:text-3xl">관리자</h1>
        <span className="text-sub text-sm">관리자 전용</span>
      </div>
      {/* 5 chip 모바일 한 줄 유지 (사장님 룰 chip/tab wrap auto-🔴). flex-wrap 제거. */}
      <div className="card p-1 mb-4 inline-flex gap-1">
        {(['users', 'access', 'stats', 'audit', 'push'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 h-9 rounded-lg text-sm font-medium transition ${
              tab === t ? 'bg-accent text-white' : 'text-ink hover:bg-black/5'
            }`}
          >
            {t === 'users' ? '사용자'
              : t === 'access' ? '권한'
              : t === 'stats' ? '통계'
              : t === 'audit' ? '로그' : '푸시'}
          </button>
        ))}
      </div>
      {tab === 'users' && <UsersTab meId={user.id} isMaster={!!user.is_master} />}
      {tab === 'access' && <AccessTab meId={user.id} isMaster={!!user.is_master} />}
      {tab === 'stats' && <StatsTab />}
      {tab === 'audit' && <LogTab />}
      {tab === 'push' && <PushTab />}
    </div>
  );
}

// ─── 통계 탭 ──────────────────────────────────────────────────────────
function StatsTab() {
  const [data, setData] = useState<AdminStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiGet<AdminStats>('/api/admin/stats').then(setData).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="text-warm text-sm">{err}</p>;
  if (!data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
    );
  }
  const cards = [
    { label: '실 사용자', value: data.total_users.toLocaleString('ko-KR'), hint: `데모 ${data.demo_users}개 제외` },
    { label: '이번 주 신규', value: `+${data.week_new_users.toLocaleString('ko-KR')}`, hint: '최근 7일' },
    { label: '총 판매 기록', value: data.total_sales.toLocaleString('ko-KR'), hint: '데모 제외' },
    { label: '총 고객 니즈', value: data.total_needs.toLocaleString('ko-KR'), hint: '데모 제외' },
    { label: `AI 호출 (${data.year_month})`, value: data.month_ai_calls.toLocaleString('ko-KR'), hint: '이번 달, 데모 포함' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c, i) => (
        <div key={i} className="card p-4">
          <div className="text-sub text-xs">{c.label}</div>
          <div className="num text-2xl font-bold mt-1">{c.value}</div>
          <div className="text-sub text-[11px] mt-1 break-keep">{c.hint}</div>
        </div>
      ))}
    </div>
  );
}

// ─── 통합 로그 탭 (audit + login + push) ──────────────────────────────
type LogRange = '1d' | '7d' | '30d' | 'all';
function LogTab() {
  const [kind, setKind] = useState<LogKind>('audit');
  const [q, setQ] = useState('');
  const [range, setRange] = useState<LogRange>('30d');
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // step-up: kind=login 진입 시 403 받으면 inline 비번 입력 노출. 인증 통과 후 자동 재시도.
  const [needAuth, setNeedAuth] = useState(false);
  const [pw, setPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  // race-guard: 매 load 시 seq++ 하고 응답 도착 시 현재 seq 와 일치할 때만 state 반영.
  // kind/q/range 가 비동기 사이 변경되면 stale 응답 무시.
  const seqRef = useRef(0);
  // q 디바운스 timer. kind/range 변경 시도 cancel 해서 stale q closure fetch 방지.
  const qTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // from 시각을 페이지 세션 내에서 고정. range 또는 q/kind 변경 시 재계산.
  // (Date.now() 매번이면 페이지 경계 millseconds drift 가능)
  const fromAnchorRef = useRef(Date.now());

  // 필터 → URL 빌더. cursor null = 초기 페이지, 숫자 = 이어보기.
  // from 은 fromAnchorRef 기준으로 고정 (페이지 세션 동안 drift 방지).
  const buildUrl = (c: number | null, qVal: string, k: LogKind, r: LogRange): string => {
    const params = new URLSearchParams();
    params.set('kind', k);
    if (qVal.trim()) params.set('q', qVal.trim());
    if (r !== 'all') {
      const days = r === '1d' ? 1 : r === '7d' ? 7 : 30;
      params.set('from', String(fromAnchorRef.current - days * 24 * 60 * 60 * 1000));
    }
    if (c) params.set('cursor', String(c));
    return `/api/admin/audit?${params.toString()}`;
  };

  const load = async (c: number | null, qVal: string, k: LogKind, r: LogRange) => {
    const my = ++seqRef.current;
    setLoadingMore(true);
    setErr(null);
    setNeedAuth(false);
    // 초기 페이지면 stale rows 즉시 비움 (kind 전환 직후 wrong cast 회피).
    if (c === null) { setRows([]); setCursor(null); setDone(false); }
    try {
      const d = await apiGet<{ entries: LogEntry[]; next_cursor: number | null }>(buildUrl(c, qVal, k, r));
      if (my !== seqRef.current) return; // stale 응답 폐기
      setRows((prev) => (c ? [...prev, ...d.entries] : d.entries));
      setCursor(d.next_cursor);
      setDone(!d.next_cursor);
    } catch (e) {
      if (my !== seqRef.current) return;
      const msg = e instanceof Error ? e.message : '실패';
      // kind=login step-up 만료 시 inline 비번 입력 (서버가 403 + 메시지)
      if (k === 'login' && msg.includes('관리자 인증')) {
        setNeedAuth(true);
        setPw('');
      } else {
        setErr(msg);
      }
    } finally {
      if (my === seqRef.current) setLoadingMore(false);
    }
  };

  const authThenRetry = async () => {
    if (pwBusy || !pw) return;
    setPwBusy(true);
    try {
      await apiPost('/api/admin/step-up', { password: pw });
      setNeedAuth(false);
      setPw('');
      void load(null, q, kind, range);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '인증 실패');
    } finally {
      setPwBusy(false);
    }
  };

  // 변경 트리거는 onChange handler 안에서 직접 처리:
  //   - kind/range: 즉시 reload (사용자 의도: 토글 = 즉시 반응)
  //   - q: 300ms 디바운스 (입력 중 burst 방지)
  // useEffect 는 마운트 1회만. cleanup 으로 unmount 시 진행 중 timer 취소.
  useEffect(() => {
    void load(null, q, kind, range);
    return () => { if (qTimerRef.current) clearTimeout(qTimerRef.current); };
    /* eslint-disable-next-line */
  }, []);

  const reload = (k: LogKind, r: LogRange, qVal: string) => {
    if (qTimerRef.current) { clearTimeout(qTimerRef.current); qTimerRef.current = null; }
    fromAnchorRef.current = Date.now();
    void load(null, qVal, k, r);
  };
  const onKindChange = (k: LogKind) => { setKind(k); reload(k, range, q); };
  const onRangeChange = (r: LogRange) => { setRange(r); reload(kind, r, q); };
  const onQChange = (v: string) => {
    setQ(v);
    if (qTimerRef.current) clearTimeout(qTimerRef.current);
    qTimerRef.current = setTimeout(() => {
      qTimerRef.current = null;
      fromAnchorRef.current = Date.now();
      void load(null, v, kind, range);
    }, 300);
  };

  return (
    <div>
      {/* 필터 한 줄 (모바일 chip wrap 회피 위해 select 3개 + input). 데스크탑 폭 캡. */}
      <div className="flex items-center gap-2 mb-3 md:max-w-2xl">
        <select value={kind} onChange={(e) => onKindChange(e.target.value as LogKind)}
          className="field h-9 px-2 text-sm shrink-0 w-auto">
          <option value="audit">어드민 행위</option>
          <option value="login">사용자 로그인</option>
          <option value="push">푸시 발송</option>
        </select>
        <input value={q} onChange={(e) => onQChange(e.target.value)}
          placeholder={kind === 'audit' ? '이메일·action' : kind === 'login' ? '이메일' : '이메일·제목'}
          className="field h-9 flex-1 min-w-0 text-sm" />
        <select value={range} onChange={(e) => onRangeChange(e.target.value as LogRange)}
          className="field h-9 px-2 text-sm shrink-0 w-auto">
          <option value="1d">오늘</option>
          <option value="7d">7일</option>
          <option value="30d">30일</option>
          <option value="all">전체</option>
        </select>
      </div>

      {needAuth ? (
        <div className="card p-4 bg-warm/5 border-warm/30 md:max-w-2xl">
          <p className="text-sm mb-2 break-keep">
            사용자 로그인 기록은 민감 정보예요. 비밀번호를 다시 입력해주세요.
          </p>
          <div className="flex gap-2">
            <input type="password" autoFocus value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && pw && !pwBusy) void authThenRetry(); }}
              placeholder="비밀번호"
              className="field h-11 flex-1 text-sm" />
            <button onClick={authThenRetry} disabled={pwBusy || !pw}
              className="btn-primary px-4 h-11 text-sm shrink-0 disabled:opacity-50">
              {pwBusy ? '확인 중…' : '인증'}
            </button>
          </div>
          {err && <p className="text-warm text-xs mt-2 break-keep">{err}</p>}
        </div>
      ) : rows.length === 0 && loadingMore ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        err
          ? <p className="text-warm text-sm">{err}</p>
          : <p className="text-sub text-center py-10">
              {q.trim() ? '조건에 해당하는 기록이 없어요.'
                : range !== 'all'
                  ? (kind === 'audit' ? '최근 어드민 행위 기록이 없어요.'
                    : kind === 'login' ? '최근 로그인 기록이 없어요.'
                    : '최근 푸시 발송 기록이 없어요.')
                  : '아직 기록이 없어요.'}
            </p>
      ) : (
        <>
          {err && (
            <p className="text-warm text-sm mb-2 break-keep">
              ⚠ {err} · <button type="button" className="underline" onClick={() => load(cursor, q, kind, range)}>다시 시도</button>
            </p>
          )}
          <div className="card divide-y divide-border overflow-hidden">
            {rows.map((r) => <LogRow key={`${kind}-${r.id}`} kind={kind} row={r} />)}
          </div>
          {!done && (
            <button onClick={() => load(cursor, q, kind, range)} disabled={loadingMore} className="btn-outline w-full mt-3">
              {loadingMore ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// 종류별 행 표시. kind discriminator 로 narrow.
// 머신 action 토큰 → 한국어 라벨. raw 는 hover/tap 시 title 로 노출 + target_json 에 detail.
const ACTION_LABELS: Record<string, string> = {
  'step_up': '재인증',
  'users.create': '계정 생성',
  'users.role': '권한 변경',
  'users.role.bulk': '권한 일괄',
  'users.access': '사용기간',
  'users.access.bulk_extend': '기간 연장',
  'users.access.bulk_revoke': '기간 회수',
  'users.delete': '계정 삭제',
  'users.password.reset': '비번 재설정',
  'push.send': '푸시 발송',
  'export.sales': '판매 CSV',
  'export.needs': '니즈 CSV',
};
const labelFor = (action: string): string => ACTION_LABELS[action] ?? action;

// target_json 의 raw JSON 을 사람 친화 한 줄 요약으로 변환.
// 사장님 요청: "누구 계정 삭제했는지" 같이 구체적인 정보 표시 (raw 코드 X).
function formatAuditSummary(action: string, targetJson: string | null): string | null {
  if (!targetJson) return null;
  let t: Record<string, unknown>;
  try { t = JSON.parse(targetJson) as Record<string, unknown>; } catch { return null; }
  const s = (k: string): string | undefined => (typeof t[k] === 'string' ? t[k] as string : undefined);
  const n = (k: string): number | undefined => (typeof t[k] === 'number' ? t[k] as number : undefined);
  const isSelf = t.reason === 'self';

  switch (action) {
    case 'users.create': {
      const biz = s('businessName') ?? s('business_name');
      const email = s('email');
      const days = n('days');
      return `${biz ?? '?'} (${email ?? '?'}) 계정 생성${days ? ` · ${days}일` : ''}`;
    }
    case 'users.password.reset':
      if (isSelf) return '자기 자신 변경 시도 (차단)';
      return `${s('email') ?? `id ${n('targetId')}`} 비밀번호 재설정`;
    case 'users.access': {
      if (isSelf) return '자기 자신 변경 시도 (차단)';
      const who = s('email') ?? s('businessName') ?? `id ${n('targetId')}`;
      const u = t.access_until;
      const until = u == null ? '무제한' : new Date(u as number).toISOString().slice(0, 10);
      return `${who} 사용기간 → ${until}`;
    }
    case 'users.access.bulk_extend':
      return `${n('count') ?? '?'}명 사용기간 +${n('days') ?? '?'}일 연장`;
    case 'users.access.bulk_revoke':
      return `${n('count') ?? '?'}명 사용기간 즉시 만료`;
    case 'users.role': {
      if (isSelf) return '자기 자신 변경 시도 (차단)';
      const who = s('email') ?? s('businessName') ?? `id ${n('targetId')}`;
      return `${who} → ${t.is_admin ? '어드민' : '일반'}`;
    }
    case 'users.role.bulk':
      return `${n('count') ?? '?'}명 → ${t.is_admin ? '어드민' : '일반'}`;
    case 'users.delete': {
      const count = n('count');
      const emails = Array.isArray(t.emails) ? (t.emails as string[]) : null;
      if (emails && emails.length > 0) {
        const head = emails.slice(0, 2).join(', ');
        const more = emails.length > 2 ? ` 외 ${emails.length - 2}명` : '';
        return `${head}${more} 계정 삭제`;
      }
      return `${count ?? '?'}명 계정 삭제`;
    }
    case 'push.send': {
      if (t.reason === 'step-up_missing') return 'step-up 미통과 (차단)';
      const target = t.target;
      const tStr = target === 'all' ? '전체' :
        (target && typeof target === 'object' && 'userId' in target)
          ? `user ${(target as { userId: number }).userId}` : '?';
      return `푸시 → ${tStr} · 성공 ${n('sent') ?? 0} / 실패 ${n('failed') ?? 0}`;
    }
    case 'export.sales':
    case 'export.needs': {
      const period = s('ym') ?? s('period');
      return `userId ${n('userId') ?? '?'}${period ? ` · ${period}` : ''}`;
    }
    case 'step_up':
      return '재인증 통과';
    default:
      return null;
  }
}

function LogRow({ kind, row }: { kind: LogKind; row: LogEntry }) {
  if (kind === 'audit') {
    const r = row as AuditEntry;
    return (
      <div className="px-4 py-3 text-sm">
        {/* chip 줄 (chip + 시각) + email 줄 — 모바일에서 truncate 깨짐 회피 */}
        <div className="flex items-center justify-between gap-2">
          <span title={r.action}
            className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold ${r.ok ? 'bg-accent/10 text-accent' : 'bg-warm/10 text-warm'}`}>
            {labelFor(r.action)}
          </span>
          <span className="text-sub text-xs num shrink-0">{fmtDateTime(r.at)}</span>
        </div>
        <div className="text-sub text-xs num mt-1 truncate">{r.admin_email ?? `id:${r.admin_user_id}`}</div>
        {(() => {
          const summary = formatAuditSummary(r.action, r.target_json);
          return summary ? (
            <div className="text-sm mt-1 break-keep">{summary}</div>
          ) : null;
        })()}
        {r.target_json && (
          <details className="mt-1">
            <summary className="text-sub text-[11px] cursor-pointer hover:text-ink select-none">자세히</summary>
            <div className="text-sub text-[11px] num mt-1 break-all bg-bg/40 p-2 rounded">{r.target_json}</div>
          </details>
        )}
        {r.error_msg && <div className="text-warm text-xs mt-1 break-keep">⚠ {r.error_msg}</div>}
      </div>
    );
  }
  if (kind === 'login') {
    const r = row as LoginEntry;
    return (
      <div className="px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          {r.is_new_device ? (
            <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold bg-warm/10 text-warm">새 디바이스</span>
          ) : <span className="text-sub text-xs">로그인</span>}
          <span className="text-sub text-xs num shrink-0">{fmtDateTime(r.at)}</span>
        </div>
        <div className="text-sub text-xs num mt-1 truncate">{r.user_email ?? `id:${r.user_id}`}</div>
        {(r.ip || r.ua) && (
          <div className="text-sub text-xs num mt-1 break-all">
            {r.ip ?? ''}{r.ip && r.ua ? ' · ' : ''}{r.ua ?? ''}
          </div>
        )}
      </div>
    );
  }
  // kind === 'push'
  const r = row as PushLogEntry;
  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{r.title}</span>
        <span className="text-sub text-xs num shrink-0">{fmtDateTime(r.at)}</span>
      </div>
      <div className="text-sub text-xs mt-0.5">
        {r.admin_email ?? `id:${r.admin_user_id}`} · {r.target_kind === 'all' ? '전체' : `사용자 ${r.target_user_id}`} · 성공 {r.subscribers_sent} · 실패 {r.subscribers_failed}
      </div>
      <div className="text-sub text-xs mt-1 break-keep">{r.body}</div>
    </div>
  );
}

// ─── 사용자 탭 (기존 + step-up 모달) ───────────────────────────────────
function UsersTab({ meId, isMaster }: { meId: number; isMaster: boolean }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [busyList, setBusyList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPw, setStepUpPw] = useState('');
  const [stepUpErr, setStepUpErr] = useState<string | null>(null);
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [csvTarget, setCsvTarget] = useState<AdminUser | null>(null);

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      setBusyList(true);
      setError(null);
      apiGet<{ users: AdminUser[]; total: number }>(`/api/admin/users?q=${encodeURIComponent(q)}`)
        .then((d) => { if (alive) { setUsers(d.users); setTotal(d.total); } })
        .catch((e) => { if (alive) { setUsers((p) => p ?? []); setError(e.message); } })
        .finally(() => { if (alive) setBusyList(false); });
    }, q ? 300 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q]);

  const selectableIds = users?.filter((u) => u.id !== meId).map((u) => u.id) ?? [];
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const toggleOne = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const requestBulkDelete = () => {
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}개 계정을 삭제할까요?\n해당 계정의 메뉴·판매 기록도 함께 삭제되며, 되돌릴 수 없습니다.`)) return;
    setPendingAction({ kind: 'delete' });
    setStepUpOpen(true); setStepUpPw(''); setStepUpErr(null);
  };

  // 마스터만: 다른 user 의 admin 권한 토글 (master·자기 자신은 토글 X).
  // delete 와 동일하게 step-up 모달 거침 (10분 TTL 통과 시 즉시, 아니면 비밀번호 재입력).
  // 사용자 탭은 정보 조회·검색·삭제만. 권한 변경은 별도 '권한 관리' 탭 (사장님 결정 2026-05-16).
  // pendingAction state 는 모달 닫기 시 reset 용 (현재 delete 하나뿐이지만 setter 만 사용).
  const [, setPendingAction] = useState<{ kind: 'delete' } | null>(null);

  const doStepUpThenDelete = async () => {
    setStepUpBusy(true); setStepUpErr(null);
    try {
      await apiPost('/api/admin/step-up', { password: stepUpPw });
    } catch (e) {
      setStepUpErr(e instanceof Error ? e.message : '인증 실패');
      setStepUpBusy(false);
      return;
    }
    setBusy(true);
    try {
      const ids = [...selected];
      const d = await apiPost<{ deleted: number; deletedIds: number[]; skippedSelf: boolean; skippedMasters?: number }>(
        '/api/admin/users/delete', { ids },
      );
      // 낙관적 갱신: 서버가 알려준 deletedIds 만 클라 state 에서 제거.
      // refetch 대신 즉시 반영 → D1 read-after-write 지연 회피 (사장님 보고 14→1→13 stale 버그 fix).
      const deletedSet = new Set(d.deletedIds);
      setUsers((prev) => (prev ?? []).filter((u) => !deletedSet.has(u.id)));
      setTotal((prev) => Math.max(0, (prev ?? 0) - d.deletedIds.length));
      setSelected(new Set());
      setStepUpOpen(false);
      setPendingAction(null);
      const notes: string[] = [];
      if (d.skippedSelf) notes.push('본인 계정은 제외했어요');
      if (d.skippedMasters && d.skippedMasters > 0)
        notes.push(`마스터 계정 ${d.skippedMasters}개는 제외했어요`);
      if (notes.length > 0) alert(notes.join('. '));
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setBusy(false); setStepUpBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-2">
        <p className="text-sub text-sm min-w-0 truncate">
          전체 {total ?? '…'}개 계정{q && users ? ` · "${q}" 검색결과 ${users.length}개` : ''}
        </p>
        <button type="button" onClick={() => setCreateOpen(true)}
          className="btn-primary px-3 h-8 text-xs shrink-0">+ 신규 계정</button>
      </div>
      <div className="card p-2 mb-3 flex items-center gap-2">
        <span className="text-sub pl-1.5"><NavIcon name="search" size={18} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="이메일 또는 가게 이름으로 검색"
          className="flex-1 bg-transparent outline-none text-sm py-2 num" />
        {q && (
          <button type="button" onClick={() => setQ('')}
            className="text-sub text-sm px-2 h-8 rounded hover:bg-black/5">지우기</button>
        )}
      </div>
      {csvTarget && (
        <AdminUserCsvModal user={csvTarget} onClose={() => setCsvTarget(null)} />
      )}
      {createOpen && (
        <AdminCreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={(u) => {
            // 낙관적 갱신 - refetch 안 함 (D1 stale read 회피, PR A 동일 패턴)
            setUsers((prev) => [
              {
                id: u.id, email: u.email, business_name: u.business_name,
                business_type: null, is_admin: false, is_master: false, is_demo: false,
                mfa_enabled: false, totp_enabled_at: null, created_at: Date.now(),
                sales_count: 0, menu_count: 0,
                access_until: u.access_until ?? null,
                last_login_at: null, last_activity_at: null,
              },
              ...(prev ?? []),
            ]);
            setTotal((prev) => (prev ?? 0) + 1);
          }}
        />
      )}
      {resetTarget && (
        <AdminPasswordResetModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
      {selected.size > 0 && (
        <div className="card p-3 mb-3 flex items-center justify-between bg-warm/[0.04] border-warm/30 anim-fade">
          <span className="text-sm"><b className="num">{selected.size}</b>개 선택됨</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelected(new Set())}
              className="text-sm text-sub px-3 h-9 rounded-lg hover:bg-black/5">선택 해제</button>
            {isMaster ? (
              <button type="button" onClick={requestBulkDelete} disabled={busy}
                className="btn-warm px-4 h-9 text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                <NavIcon name="trash" size={15} />
                {busy ? '삭제 중…' : '선택 삭제'}
              </button>
            ) : (
              <span className="text-sub text-xs">삭제는 마스터만</span>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-warm text-sm mb-3">{error}</p>}
      {users === null || (busyList && users.length === 0) ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : users.length === 0 ? (
        <div className="card p-10 text-center text-sub">{q ? '검색 결과가 없습니다.' : '계정이 없습니다.'}</div>
      ) : (
        <div className={`card divide-y divide-border overflow-hidden transition-opacity ${busyList ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="px-4 py-2.5 flex items-center gap-3 bg-bg/60 text-xs text-sub">
            <input type="checkbox" checked={allSelected} onChange={toggleAll}
              className="w-4 h-4 accent-accent shrink-0" aria-label="전체 선택" />
            <span className="flex-1">계정 ({users.length})</span>
            <span className="hidden md:block w-20 text-right">최근 활동</span>
            <span className="hidden sm:block w-20 text-right">가입일</span>
            <span className="w-14 text-right">판매</span>
            <span className="w-[88px] shrink-0" aria-hidden />
            <span className="w-12 shrink-0" aria-hidden />
          </div>
          {users.map((u) => {
            const self = u.id === meId;
            return (
              <div key={u.id}
                className={`px-4 py-3 flex items-start gap-3 ${self ? 'opacity-70' : 'hover:bg-black/[0.02]'}`}>
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)}
                  disabled={self || !isMaster}
                  className="w-4 h-4 mt-1 accent-accent shrink-0 disabled:opacity-40"
                  aria-label={`${u.business_name} 선택`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium truncate min-w-[60px] sm:min-w-[80px]">{u.business_name}</span>
                    {u.is_master && <span className="text-[11px] font-bold text-warm bg-warm/10 px-1.5 py-0.5 rounded shrink-0">MASTER</span>}
                    {u.is_admin && !u.is_master && <span className="text-[11px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">ADMIN</span>}
                    {u.is_demo && <span className="text-[11px] font-bold text-sub bg-border/40 px-1.5 py-0.5 rounded shrink-0">DEMO</span>}
                    {u.mfa_enabled && <span className="text-[11px] shrink-0" title="2단계 인증">🔒</span>}
                    {self && !u.is_master && <span className="hidden sm:inline-flex text-[11px] text-sub shrink-0">(나)</span>}
                  </div>
                  <div className="text-sub text-xs num truncate">{u.email}</div>
                  <div className="text-sub text-[11px] mt-0.5">
                    {businessTypeLabel(u.business_type)} · 메뉴 {u.menu_count}개
                    <span className="sm:hidden"> · 가입 {fmtDate(u.created_at)}</span>
                    {u.last_login_at && (
                      <span className="md:hidden"> · 최근 {fmtDateTime(u.last_login_at)}</span>
                    )}
                    {!u.is_master && !u.is_demo && (
                      <>
                        {' '}·{' '}
                        {u.access_until == null ? (
                          <span className="text-accent">무제한</span>
                        ) : u.access_until < Date.now() ? (
                          <span className="text-warm font-medium">만료</span>
                        ) : (
                          <span>D-{Math.ceil((u.access_until - Date.now()) / (24 * 60 * 60 * 1000))}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <span className="hidden md:block w-20 text-right text-[11px] text-sub num shrink-0">
                  {u.last_activity_at ? fmtDateTime(u.last_activity_at) : '없음'}
                </span>
                <span className="hidden sm:block w-20 text-right text-xs text-sub num shrink-0">{fmtDate(u.created_at)}</span>
                <span className="w-14 text-right num text-sm shrink-0 tabular-nums">{u.sales_count}</span>
                <button type="button"
                  onClick={!self && !u.is_master ? () => setResetTarget(u) : undefined}
                  disabled={self || u.is_master}
                  className="btn-outline px-2 h-8 text-xs shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`${u.business_name} 비밀번호 재설정`}>
                  비번 재설정
                </button>
                <button type="button" onClick={() => setCsvTarget(u)}
                  className="btn-outline px-2 h-8 text-xs shrink-0"
                  aria-label={`${u.business_name} CSV 내보내기`}>
                  CSV
                </button>
              </div>
            );
          })}
        </div>
      )}

      {stepUpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 anim-fade"
          onClick={(e) => { if (e.target === e.currentTarget) { setStepUpOpen(false); setPendingAction(null); } }}
        >
          <div className="card max-w-sm md:max-w-md w-full p-5 anim-pop">
            <h2 className="font-semibold mb-2">관리자 인증</h2>
            <p className="text-sub text-sm mb-3 break-keep">
              위험한 작업이라 비밀번호를 한 번 더 확인합니다. 인증 후 10분 동안 같은 작업을 반복할 수 있어요.
            </p>
            <input
              type="password" autoFocus className="field" value={stepUpPw}
              onChange={(e) => setStepUpPw(e.target.value)} placeholder="비밀번호"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && stepUpPw && !stepUpBusy) doStepUpThenDelete();
                else if (e.key === 'Escape') { setStepUpOpen(false); setPendingAction(null); }
              }}
            />
            {stepUpErr && <p className="text-warm text-sm mt-2 break-keep">{stepUpErr}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setStepUpOpen(false); setPendingAction(null); }} className="btn-outline flex-1">취소</button>
              <button onClick={doStepUpThenDelete} disabled={stepUpBusy || !stepUpPw} className="btn-warm flex-1">
                {stepUpBusy ? '확인 중…' : '인증 후 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── 푸시 발송 탭 (PR 3 Phase 4) ───────────────────────────────────────
// 발송 이력은 "로그" 탭 (kind=push) 으로 일반화됨 — 여기서는 발송 폼만.

function PushTab() {
  const [target, setTarget] = useState<'all' | 'user'>('all');
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; expired?: number; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPw, setStepUpPw] = useState('');
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpErr, setStepUpErr] = useState<string | null>(null);

  const reset = () => {
    setTitle(''); setBody(''); setUrl('/'); setUserId(''); setTarget('all'); setResult(null); setError(null);
  };

  const requestSend = () => {
    if (!title.trim() || !body.trim()) { setError('제목과 본문을 입력해주세요.'); return; }
    if (target === 'user' && (!userId.trim() || !/^\d+$/.test(userId.trim()))) {
      setError('유효한 사용자 ID 가 필요해요.'); return;
    }
    if (url.trim() && !url.trim().startsWith('/')) { setError('URL 은 / 로 시작해야 해요.'); return; }
    setError(null); setStepUpOpen(true); setStepUpPw(''); setStepUpErr(null);
  };

  const doStepUpThenSend = async () => {
    setStepUpBusy(true); setStepUpErr(null);
    try {
      await apiPost('/api/admin/step-up', { password: stepUpPw });
    } catch (e) {
      setStepUpErr(e instanceof Error ? e.message : '인증 실패');
      setStepUpBusy(false);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        target: target === 'all' ? 'all' : { userId: Number(userId) },
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || '/',
      };
      const d = await apiPost<{ sent: number; failed: number; expired?: number; note?: string }>(
        '/api/admin/push/send', payload,
      );
      setResult(d);
      setStepUpOpen(false);
      // 발송 성공 후 폼 자동 초기화 (실수 재발송 방지). 결과 카드는 별도 state라 유지됨.
      // 이력 확인은 "로그" 탭 (kind=push) 에서.
      setTitle(''); setBody(''); setUrl('/'); setUserId('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '발송 실패';
      setError(msg);
      setStepUpErr(msg); // 모달이 열린 채라면 모달 안에도 표시 (dead-end 회피)
    } finally {
      setBusy(false); setStepUpBusy(false);
    }
  };

  return (
    <>
      <div className="card p-5 space-y-4">
        <div>
          <label className="label">발송 대상</label>
          <div className="flex gap-2 md:max-w-md">
            <button
              type="button"
              onClick={() => setTarget('all')}
              className={`flex-1 h-10 rounded-lg text-sm border transition ${
                target === 'all'
                  ? 'bg-accent text-white border-accent font-medium'
                  : 'bg-card text-ink border-border hover:border-accent/40'
              }`}
            >
              전체 사장님
            </button>
            <button
              type="button"
              onClick={() => setTarget('user')}
              className={`flex-1 h-10 rounded-lg text-sm border transition ${
                target === 'user'
                  ? 'bg-accent text-white border-accent font-medium'
                  : 'bg-card text-ink border-border hover:border-accent/40'
              }`}
            >
              특정 사용자
            </button>
          </div>
          {target === 'user' && (
            <input
              type="text"
              inputMode="numeric"
              pattern="\d*"
              className="field mt-2 md:max-w-xs"
              placeholder="사용자 ID (사용자 탭에서 확인)"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          )}
        </div>

        <div>
          <label className="label">제목 (최대 80자)</label>
          <input
            className="field md:max-w-md"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 새 기능 안내"
          />
        </div>

        <div>
          <label className="label">본문 (최대 200자)</label>
          <textarea
            className="field !h-auto min-h-[88px] py-3 md:max-w-md"
            rows={3}
            value={body}
            maxLength={200}
            onChange={(e) => setBody(e.target.value)}
            placeholder="예: 농구·골프·축구 업종이 추가됐어요. 설정에서 업종을 변경해보세요."
          />
        </div>

        <div>
          <label className="label">클릭 시 이동 (앱 내부 경로, / 로 시작)</label>
          <input
            className="field md:max-w-sm"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/"
          />
        </div>

        {error && <p className="text-warm text-sm">{error}</p>}
        {result && (
          <div className="rounded-xl border border-border bg-card p-3 text-sm">
            <div className="font-medium mb-1">발송 결과</div>
            <div>성공 {result.sent}건, 실패 {result.failed}건{result.expired ? `, 만료 정리 ${result.expired}건` : ''}</div>
            {result.note && <div className="text-sub mt-1">{result.note}</div>}
          </div>
        )}

        <div className="flex gap-2 pt-1 md:max-w-md">
          <button type="button" onClick={reset} className="btn-outline">초기화</button>
          <button type="button" onClick={requestSend} disabled={busy} className="btn-primary flex-1 disabled:opacity-50">
            {busy ? '발송 중…' : '발송하기'}
          </button>
        </div>
      </div>

      <p className="text-sub text-xs mt-4">발송 이력은 "로그" 탭에서 확인할 수 있어요.</p>

      {/* step-up 비밀번호 모달 (UsersTab 동일 패턴) */}
      {stepUpOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-md p-5 shadow-2xl">
            <h2 className="font-display text-xl mb-2">관리자 인증</h2>
            <p className="text-sub text-sm mb-3">알림 발송 전에 비밀번호를 한 번 더 확인해요. 이후 10분간 다시 안 물어요.</p>
            <input
              type="password"
              className="field"
              value={stepUpPw}
              onChange={(e) => setStepUpPw(e.target.value)}
              placeholder="비밀번호"
              autoFocus
            />
            {stepUpErr && <p className="text-warm text-sm mt-2">{stepUpErr}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setStepUpOpen(false)} className="btn-outline flex-1">취소</button>
              <button onClick={doStepUpThenSend} disabled={stepUpBusy || !stepUpPw} className="btn-primary flex-1">
                {stepUpBusy ? '확인 중…' : '인증 후 발송'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── 권한 관리 탭 (PR 5+ 2026-05-16) ─────────────────────────────────────
// 사용 기간(access_until) + 어드민 권한(is_admin) 일괄 관리.
// 일괄 액션: +30/+90일 연장 / 즉시 만료 (admin·master 둘 다) / 어드민 지정·해제 (master 만)
function AccessTab({ meId, isMaster }: { meId: number; isMaster: boolean }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busyList, setBusyList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPw, setStepUpPw] = useState('');
  const [stepUpErr, setStepUpErr] = useState<string | null>(null);
  const [stepUpBusy, setStepUpBusy] = useState(false);
  type Action = { kind: 'extend'; days: number } | { kind: 'revoke' } | { kind: 'role'; is_admin: boolean };
  const [pendingAction, setPendingAction] = useState<Action | null>(null);

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      setBusyList(true); setError(null);
      apiGet<{ users: AdminUser[]; total: number }>(`/api/admin/users?q=${encodeURIComponent(q)}`)
        .then((d) => { if (alive) setUsers(d.users); })
        .catch((e) => { if (alive) { setUsers((p) => p ?? []); setError(e.message); } })
        .finally(() => { if (alive) setBusyList(false); });
    }, q ? 300 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q]);

  const refetch = async () => {
    setBusyList(true);
    try {
      const d = await apiGet<{ users: AdminUser[]; total: number }>(`/api/admin/users?q=${encodeURIComponent(q)}`);
      setUsers(d.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : '실패');
    } finally { setBusyList(false); }
  };

  // 권한 관리 대상: master·demo·자기 자신은 선택 X (server 도 silently 제외하지만 UI 가이드)
  const eligibleIds = users?.filter((u) => u.id !== meId && !u.is_master && !u.is_demo).map((u) => u.id) ?? [];

  // 검색이 좁아져서 선택했던 user 가 화면에서 사라지면 selected 도 자동 정리 (flow review #1).
  // 사장님이 "보이는 것만 처리" 라고 오해하지 않도록.
  useEffect(() => {
    if (!users) return;
    const eligibleSet = new Set(eligibleIds);
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => eligibleSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(eligibleIds));
  const toggleOne = (id: number) => setSelected((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const requestAction = (a: Action) => {
    if (selected.size === 0) return;
    const verb =
      a.kind === 'extend' ? `${a.days}일 연장`
      : a.kind === 'revoke' ? '즉시 만료'
      : a.is_admin ? '어드민 지정' : '어드민 해제';
    if (!confirm(`선택한 ${selected.size}명에게 "${verb}" 적용할까요?`)) return;
    setPendingAction(a); setError(null); setInfo(null);
    setStepUpOpen(true); setStepUpPw(''); setStepUpErr(null);
  };

  // 지정 연장 - 사장님이 일수 직접 입력 (사장님 결정 2026-05-16, prompt 로 간단히)
  const requestExtendCustom = () => {
    if (selected.size === 0) return;
    const raw = window.prompt('연장할 일수를 입력하세요 (1-3650일)');
    if (raw == null) return;
    const days = parseInt(raw.trim(), 10);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      alert('1-3650 사이 숫자만 입력 가능해요.');
      return;
    }
    requestAction({ kind: 'extend', days });
  };

  const doStepUpThenApply = async () => {
    if (!pendingAction) return;
    setStepUpBusy(true); setStepUpErr(null);
    try {
      await apiPost('/api/admin/step-up', { password: stepUpPw });
    } catch (e) {
      setStepUpErr(e instanceof Error ? e.message : '인증 실패');
      setStepUpBusy(false);
      return;
    }
    setBusy(true);
    try {
      const ids = [...selected];
      let r: { updated: number; skipped: number };
      if (pendingAction.kind === 'extend') {
        r = await apiPost('/api/admin/users/access/bulk', { userIds: ids, days: pendingAction.days });
      } else if (pendingAction.kind === 'revoke') {
        r = await apiPost('/api/admin/users/access/bulk', { userIds: ids, revoke: true });
      } else {
        r = await apiPost('/api/admin/users/role/bulk', { userIds: ids, is_admin: pendingAction.is_admin });
      }
      setSelected(new Set());
      setStepUpOpen(false);
      setPendingAction(null);
      await refetch();
      setInfo(`${r.updated}명 처리됨${r.skipped > 0 ? ` (마스터·데모·본인 ${r.skipped}명 제외)` : ''}`);
    } catch (e) {
      setStepUpErr(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(false); setStepUpBusy(false);
    }
  };

  return (
    <>
      <p className="text-sub text-sm mb-4 break-keep">
        사용 기간 연장·만료, 어드민 권한 지정·해제를 일괄로 처리. 마스터·데모·본인 계정은 자동 제외.
      </p>

      <div className="card p-2 mb-3 flex items-center gap-2">
        <span className="text-sub pl-1.5"><NavIcon name="search" size={18} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="이메일 또는 가게 이름으로 검색"
          className="flex-1 bg-transparent outline-none text-sm py-2 num" />
        {q && (
          <button type="button" onClick={() => setQ('')}
            className="text-sub text-sm px-2 h-8 rounded hover:bg-black/5">지우기</button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="card p-3 mb-3 bg-accent/[0.04] border-accent/30 anim-fade">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm"><b className="num">{selected.size}</b>명 선택됨</span>
            <button type="button" onClick={() => setSelected(new Set())}
              className="text-sm text-sub px-3 h-8 rounded-lg hover:bg-black/5">선택 해제</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => requestAction({ kind: 'extend', days: 30 })}
              disabled={busy}
              className="btn-primary px-3 h-9 text-sm disabled:opacity-50">30일 연장</button>
            <button type="button" onClick={requestExtendCustom}
              disabled={busy}
              className="btn-outline px-3 h-9 text-sm disabled:opacity-50">지정 연장</button>
            <button type="button" onClick={() => requestAction({ kind: 'revoke' })}
              disabled={busy}
              className="btn-warm px-3 h-9 text-sm disabled:opacity-50">즉시 만료</button>
            {isMaster && (
              <>
                <span className="w-px h-9 bg-border mx-1 hidden sm:block" aria-hidden />
                <button type="button" onClick={() => requestAction({ kind: 'role', is_admin: true })}
                  disabled={busy}
                  className="px-3 h-9 text-sm rounded-lg border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50">어드민 지정</button>
                <button type="button" onClick={() => requestAction({ kind: 'role', is_admin: false })}
                  disabled={busy}
                  className="px-3 h-9 text-sm rounded-lg border border-border text-sub hover:border-warm hover:text-warm disabled:opacity-50">어드민 해제</button>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-warm text-sm mb-3">{error}</p>}
      {info && <p className="text-accent text-sm mb-3">{info}</p>}

      {users === null || (busyList && users.length === 0) ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : users.length === 0 ? (
        <div className="card p-10 text-center text-sub">{q ? '검색 결과가 없습니다.' : '계정이 없습니다.'}</div>
      ) : (
        <div className={`card divide-y divide-border overflow-hidden transition-opacity ${busyList ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="px-4 py-2.5 flex items-center gap-3 bg-bg/60 text-xs text-sub">
            <input type="checkbox" checked={allSelected} onChange={toggleAll}
              className="w-4 h-4 accent-accent shrink-0" aria-label="전체 선택" />
            <span className="flex-1">계정 ({users.length})</span>
            <span className="hidden sm:block w-20 text-right">현재 상태</span>
            <span className="w-20 text-right">사용 기간</span>
          </div>
          {users.map((u) => {
            const self = u.id === meId;
            const disabled = self || u.is_master || u.is_demo;
            const expired = u.access_until != null && u.access_until < Date.now();
            return (
              <label key={u.id}
                className={`px-4 py-3 flex items-center gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-black/[0.02]'}`}>
                <input type="checkbox"
                  checked={selected.has(u.id)} onChange={() => toggleOne(u.id)}
                  disabled={disabled}
                  className="w-4 h-4 accent-accent shrink-0 disabled:opacity-40"
                  aria-label={`${u.business_name} 선택`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium truncate">{u.business_name}</span>
                    {u.is_master && <span className="text-[11px] font-bold text-warm bg-warm/10 px-1.5 py-0.5 rounded shrink-0">MASTER</span>}
                    {u.is_admin && !u.is_master && <span className="text-[11px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">ADMIN</span>}
                    {u.is_demo && <span className="text-[11px] font-bold text-sub bg-border/40 px-1.5 py-0.5 rounded shrink-0">DEMO</span>}
                    {self && <span className="text-[11px] text-sub shrink-0">(나)</span>}
                  </div>
                  <div className="text-sub text-xs num truncate">{u.email}</div>
                </div>
                <span className="hidden sm:block w-20 text-right text-xs shrink-0">
                  {u.is_master ? <span className="text-warm font-medium">MASTER</span>
                    : u.is_admin ? <span className="text-accent font-medium">ADMIN</span>
                    : <span className="text-sub">일반</span>}
                </span>
                <span className="w-20 text-right text-xs num shrink-0">
                  {u.is_master || u.is_demo ? <span className="text-accent">무제한</span>
                    : u.access_until == null ? <span className="text-accent">무제한</span>
                    : expired ? <span className="text-warm font-medium">만료</span>
                    : <span>D-{Math.ceil((u.access_until - Date.now()) / (24 * 60 * 60 * 1000))}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {stepUpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 anim-fade"
          onClick={(e) => { if (e.target === e.currentTarget) { setStepUpOpen(false); setPendingAction(null); } }}
        >
          <div className="card max-w-sm md:max-w-md w-full p-5 anim-pop">
            <h2 className="font-semibold mb-2">관리자 인증</h2>
            <p className="text-sub text-sm mb-3 break-keep">
              비밀번호를 한 번 더 확인합니다. 인증 후 10분 동안 같은 작업을 반복할 수 있어요.
            </p>
            <input
              type="password" autoFocus className="field" value={stepUpPw}
              onChange={(e) => setStepUpPw(e.target.value)} placeholder="비밀번호"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && stepUpPw && !stepUpBusy) doStepUpThenApply();
                else if (e.key === 'Escape') { setStepUpOpen(false); setPendingAction(null); }
              }}
            />
            {stepUpErr && <p className="text-warm text-sm mt-2 break-keep">{stepUpErr}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setStepUpOpen(false); setPendingAction(null); }} className="btn-outline flex-1">취소</button>
              <button onClick={doStepUpThenApply} disabled={stepUpBusy || !stepUpPw}
                className={pendingAction?.kind === 'revoke' ? 'btn-warm flex-1' : 'btn-primary flex-1'}>
                {stepUpBusy ? '확인 중…' : '인증 후 적용'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── 임시 비번 표시 카드 (생성·reset 공통) ───────────────────────────────
function TempPasswordCard({ tempPw, label }: { tempPw: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tempPw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard 권한 없으면 select-all 로 폴백
    }
  };
  return (
    <div className="bg-warn/10 border border-warn/30 rounded-lg p-3 space-y-2">
      <p className="text-warn text-sm font-medium">⚠️ {label} - 이 화면을 닫으면 다시 볼 수 없어요</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-bg p-2 rounded text-center font-mono text-base tracking-wider select-all break-all">
          {tempPw}
        </code>
        <button type="button" onClick={copy}
          className="btn-outline px-3 h-10 text-sm shrink-0">
          {copied ? '✓ 복사' : '복사'}
        </button>
      </div>
      <p className="text-warn text-xs">사용자에게 안전한 채널로 전달해주세요. 첫 로그인 후 보안질문 설정을 안내해주세요.</p>
    </div>
  );
}

// ─── 신규 계정 생성 모달 ────────────────────────────────────────────────
function AdminCreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (u: { id: number; email: string; business_name: string; access_until: number | null }) => void;
}) {
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [days, setDays] = useState<string>('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ tempPw: string; email: string; days: number } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const d = Math.max(1, Math.min(3650, Number(days) || 30));
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{
        user: { id: number; email: string; business_name: string; access_until: number | null };
        temp_password: string;
      }>('/api/admin/users/create', { email: email.trim().toLowerCase(), businessName: businessName.trim(), days: d });
      onCreated(r.user);
      setCreated({ tempPw: r.temp_password, email: r.user.email, days: d });
    } catch (err) {
      setError(err instanceof Error ? err.message : '생성 실패');
    } finally {
      setBusy(false);
    }
  };

  // 임시 비번 표시 중에는 backdrop 닫기 차단 (실수 닫으면 비번 다시 못 봄)
  const onBackdrop = () => { if (created) return; onClose(); };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onBackdrop}>
      <div className="card max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        {created ? (
          <>
            <h3 className="font-semibold text-lg">계정이 생성됐어요</h3>
            <div className="text-sm space-y-1">
              <p>이메일: <b className="num">{created.email}</b></p>
              <p>사용 기간: {created.days}일</p>
            </div>
            <TempPasswordCard tempPw={created.tempPw} label="임시 비밀번호" />
            <button type="button" onClick={onClose} className="btn-primary w-full h-10">확인</button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <h3 className="font-semibold text-lg">신규 사용자 계정 생성</h3>
            <p className="text-sub text-sm">
              임시 비밀번호가 자동 생성됩니다. 사용자가 첫 로그인 후 보안질문을 직접 설정해야 비밀번호 찾기를 쓸 수 있어요.
            </p>
            <div>
              <label className="label">이메일</label>
              <input type="email" required className="field num" value={email}
                onChange={(e) => setEmail(e.target.value)} disabled={busy}
                placeholder="user@example.com" />
            </div>
            <div>
              <label className="label">가게 이름</label>
              <input required maxLength={40} className="field" value={businessName}
                onChange={(e) => setBusinessName(e.target.value)} disabled={busy}
                placeholder="예: 든든한식당" />
            </div>
            <div>
              <label className="label">사용 기간 (일, 1-3650)</label>
              <input type="number" inputMode="numeric" min={1} max={3650} className="field num" value={days}
                onChange={(e) => setDays(e.target.value)} disabled={busy} />
            </div>
            {error && <p className="text-warm text-sm">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} disabled={busy}
                className="btn-outline flex-1 h-10">취소</button>
              <button type="submit" disabled={busy || !email.trim() || !businessName.trim()}
                className="btn-primary flex-1 h-10">
                {busy ? '생성 중…' : '생성'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── 비번 reset 모달 ────────────────────────────────────────────────────
function AdminPasswordResetModal({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<{ tempPw: string; email: string; businessName: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ temp_password: string; email: string; business_name: string }>(
        '/api/admin/users/password/reset', { userId: user.id },
      );
      setReset({ tempPw: r.temp_password, email: r.email, businessName: r.business_name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reset 실패');
    } finally {
      setBusy(false);
    }
  };

  // 임시 비번 표시 중에는 backdrop 닫기 차단 (실수 닫으면 비번 다시 못 봄)
  const onBackdrop = () => { if (reset) return; onClose(); };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onBackdrop}>
      <div className="card max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        {reset ? (
          <>
            <h3 className="font-semibold text-lg">비밀번호가 재설정됐어요</h3>
            <div className="text-sm space-y-1">
              <p>대상: <b>{reset.businessName}</b></p>
              <p className="text-sub num">{reset.email}</p>
              <p className="text-sub text-xs mt-2">기존 로그인 세션은 모두 자동 로그아웃됐어요.</p>
            </div>
            <TempPasswordCard tempPw={reset.tempPw} label="새 임시 비밀번호" />
            <button type="button" onClick={onClose} className="btn-primary w-full h-10">확인</button>
          </>
        ) : (
          <>
            <h3 className="font-semibold text-lg">비밀번호 재설정</h3>
            <p className="text-sm">
              <b>{user.business_name}</b> (<span className="num">{user.email}</span>) 의
              비밀번호를 새 임시 비밀번호로 재설정합니다.
            </p>
            <p className="text-sub text-sm break-keep">
              기존 비밀번호는 무효화되고 모든 디바이스에서 자동 로그아웃됩니다.
              임시 비밀번호는 1회만 표시되니 즉시 사용자에게 전달해주세요.
            </p>
            <label className="flex items-start gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-accent" />
              <span>위 내용을 확인했고, 진행합니다.</span>
            </label>
            {error && <p className="text-warm text-sm">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} disabled={busy}
                className="btn-outline flex-1 h-10">취소</button>
              <button type="button" onClick={submit} disabled={busy || !confirmed}
                className="btn-warm flex-1 h-10">
                {busy ? '처리 중…' : '비밀번호 재설정'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── per-account CSV 내보내기 모달 (사용자 row 의 📥 클릭) ──────────────
// 매출(sales) + 니즈(needs) 두 파일 한 번에 다운로드. 기간 4 옵션.
function AdminUserCsvModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [period, setPeriod] = useState<'current_month' | 'prev_month' | 'this_year' | 'all'>('current_month');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const qs = `userId=${user.id}&period=${period}`;
      // fetch + Blob - 401/403 에러를 명확히 표시 + X-Truncated 헤더 활용 가능
      const salesInfo = await fetchAndDownload(`/api/admin/export/sales?${qs}`);
      const needsInfo = await fetchAndDownload(`/api/admin/export/needs?${qs}`);
      const truncNote = [
        salesInfo.truncated ? `매출 ${salesInfo.rowCount}건 (5만 제한 도달, 더 좁은 기간으로 다시 받아주세요)` : '',
        needsInfo.truncated ? `니즈 ${needsInfo.rowCount}건 (5만 제한 도달)` : '',
      ].filter(Boolean).join('\n');
      alert(`매출·니즈 CSV 두 파일이 다운로드됐어요.${truncNote ? `\n\n⚠ ${truncNote}` : ''}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '다운로드 실패');
      setBusy(false);
    }
  };

  const periodOptions: { v: typeof period; label: string }[] = [
    { v: 'current_month', label: '당월 (이번 달 1일 ~ 오늘)' },
    { v: 'prev_month', label: '전월 (지난 달 1일 ~ 말일)' },
    { v: 'this_year', label: '올해 (1월 1일 ~ 오늘)' },
    { v: 'all', label: '전체 (개시 ~ 오늘)' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={busy ? undefined : onClose}>
      <div className="card max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg">매출·니즈 CSV 내보내기</h3>
        <div className="text-sm space-y-1">
          <p>대상: <b>{user.business_name}</b></p>
          <p className="text-sub num">{user.email}</p>
          <p className="text-sub text-xs">매출(sales) + 니즈(needs) 두 파일이 순서대로 다운로드됩니다.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="label">기간</legend>
          {periodOptions.map(({ v, label }) => (
            <label key={v} className="flex items-center gap-2 cursor-pointer text-sm py-2.5">
              <input type="radio" name="period" value={v}
                checked={period === v}
                onChange={() => setPeriod(v)}
                disabled={busy}
                className="w-4 h-4 accent-accent" />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {error && <p className="text-warm text-sm">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="btn-outline flex-1 h-10">취소</button>
          <button type="button" onClick={download} disabled={busy}
            className="btn-primary flex-1 h-10">
            {busy ? '다운로드 중…' : '다운로드'}
          </button>
        </div>
      </div>
    </div>
  );
}

// fetch → blob → download. 401/403 시 JSON 에러 메시지 throw, X-Truncated/X-Row-Count 헤더 활용.
async function fetchAndDownload(url: string): Promise<{ truncated: boolean; rowCount: number }> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body?.error) msg = body.error;
    } catch { /* JSON 파싱 실패 - status 만 표시 */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = cd.match(/filename="([^"]+)"/);
  const filename = m ? m[1] : 'export.csv';
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // revoke 는 다음 tick 에 (브라우저가 다운로드 시작할 시간 확보)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return {
    truncated: res.headers.get('X-Truncated') === '1',
    rowCount: Number(res.headers.get('X-Row-Count') ?? '0'),
  };
}
