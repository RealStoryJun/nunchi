import { useEffect, useState } from 'react';
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
  is_demo: boolean;
  mfa_enabled: boolean;
  created_at: number;
  sales_count: number;
  menu_count: number;
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

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

type Tab = 'users' | 'stats' | 'audit' | 'push';

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
      <div className="card p-1 mb-4 inline-flex gap-1 flex-wrap">
        {(['users', 'stats', 'audit', 'push'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 h-9 rounded-lg text-sm font-medium transition ${
              tab === t ? 'bg-accent text-white' : 'text-ink hover:bg-black/5'
            }`}
          >
            {t === 'users' ? '사용자' : t === 'stats' ? '통계' : t === 'audit' ? '활동 로그' : '푸시 발송'}
          </button>
        ))}
      </div>
      {tab === 'users' && <UsersTab meId={user.id} />}
      {tab === 'stats' && <StatsTab />}
      {tab === 'audit' && <AuditTab />}
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

// ─── 활동 로그 탭 ─────────────────────────────────────────────────────
function AuditTab() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const load = async (c: number | null) => {
    setLoadingMore(true);
    setErr(null);
    try {
      const d = await apiGet<{ entries: AuditEntry[]; next_cursor: number | null }>(
        c ? `/api/admin/audit?cursor=${c}` : '/api/admin/audit',
      );
      setRows((prev) => (c ? [...prev, ...d.entries] : d.entries));
      setCursor(d.next_cursor);
      if (!d.next_cursor) setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '실패');
    } finally {
      setLoadingMore(false);
    }
  };
  useEffect(() => { load(null); /* eslint-disable-next-line */ }, []);
  if (err) return <p className="text-warm text-sm">{err}</p>;
  if (rows.length === 0 && loadingMore) {
    return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  }
  if (rows.length === 0) return <p className="text-sub text-center py-10">기록이 없습니다.</p>;
  return (
    <div>
      <div className="card divide-y divide-border overflow-hidden">
        {rows.map((r) => (
          <div key={r.id} className="px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium truncate">
                <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold mr-2 ${r.ok ? 'bg-accent/10 text-accent' : 'bg-warm/10 text-warm'}`}>
                  {r.action}
                </span>
                <span className="text-sub text-xs num">{r.admin_email ?? `id:${r.admin_user_id}`}</span>
              </span>
              <span className="text-sub text-xs num shrink-0">{fmtDateTime(r.at)}</span>
            </div>
            {r.target_json && (
              <div className="text-sub text-xs num mt-1 break-all">{r.target_json}</div>
            )}
            {r.error_msg && (
              <div className="text-warm text-xs mt-1 break-keep">⚠ {r.error_msg}</div>
            )}
          </div>
        ))}
      </div>
      {!done && (
        <button onClick={() => load(cursor)} disabled={loadingMore} className="btn-outline w-full mt-3">
          {loadingMore ? '불러오는 중…' : '더 보기'}
        </button>
      )}
    </div>
  );
}

// ─── 사용자 탭 (기존 + step-up 모달) ───────────────────────────────────
function UsersTab({ meId }: { meId: number }) {
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

  const refetch = async () => {
    setBusyList(true);
    try {
      const d = await apiGet<{ users: AdminUser[]; total: number }>(
        `/api/admin/users?q=${encodeURIComponent(q)}&_ts=${Date.now()}`,
      );
      setUsers(d.users); setTotal(d.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '실패');
    } finally { setBusyList(false); }
  };

  const requestBulkDelete = () => {
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}개 계정을 삭제할까요?\n해당 계정의 메뉴·판매 기록도 함께 삭제되며, 되돌릴 수 없습니다.`)) return;
    setStepUpOpen(true); setStepUpPw(''); setStepUpErr(null);
  };

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
      const d = await apiPost<{ deleted: number; skippedSelf: boolean }>(
        '/api/admin/users/delete', { ids },
      );
      setSelected(new Set());
      setStepUpOpen(false);
      await refetch();
      if (d.skippedSelf) alert('본인 계정은 삭제할 수 없어 제외했습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setBusy(false); setStepUpBusy(false);
    }
  };

  return (
    <>
      <p className="text-sub text-sm mb-4">
        전체 {total ?? '…'}개 계정{q && users ? ` · "${q}" 검색결과 ${users.length}개` : ''}
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
        <div className="card p-3 mb-3 flex items-center justify-between bg-warm/[0.04] border-warm/30 anim-fade">
          <span className="text-sm"><b className="num">{selected.size}</b>개 선택됨</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelected(new Set())}
              className="text-sm text-sub px-3 h-9 rounded-lg hover:bg-black/5">선택 해제</button>
            <button type="button" onClick={requestBulkDelete} disabled={busy}
              className="btn-warm px-4 h-9 text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <NavIcon name="trash" size={15} />
              {busy ? '삭제 중…' : '선택 삭제'}
            </button>
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
            <span className="hidden sm:block w-28 text-right">가입일</span>
            <span className="w-14 text-right">판매</span>
          </div>
          {users.map((u) => {
            const self = u.id === meId;
            return (
              <label key={u.id}
                className={`px-4 py-3 flex items-center gap-3 ${self ? 'opacity-70' : 'cursor-pointer hover:bg-black/[0.02]'}`}>
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)}
                  disabled={self} className="w-4 h-4 accent-accent shrink-0 disabled:opacity-40"
                  aria-label={`${u.business_name} 선택`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium truncate">{u.business_name}</span>
                    {u.is_admin && <span className="text-[11px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">ADMIN</span>}
                    {u.is_demo && <span className="text-[11px] font-bold text-sub bg-border/40 px-1.5 py-0.5 rounded shrink-0">DEMO</span>}
                    {u.mfa_enabled && <span className="text-[11px] shrink-0" title="2단계 인증">🔒</span>}
                    {self && <span className="text-[11px] text-sub shrink-0">(나)</span>}
                  </div>
                  <div className="text-sub text-xs num truncate">{u.email}</div>
                  <div className="text-sub text-[11px] mt-0.5">
                    {businessTypeLabel(u.business_type)} · 메뉴 {u.menu_count}개
                    <span className="sm:hidden"> · 가입 {fmtDate(u.created_at)}</span>
                  </div>
                </div>
                <span className="hidden sm:block w-28 text-right text-xs text-sub num">{fmtDate(u.created_at)}</span>
                <span className="w-14 text-right num text-sm">{u.sales_count}</span>
              </label>
            );
          })}
        </div>
      )}

      {stepUpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 anim-fade"
          onClick={(e) => { if (e.target === e.currentTarget) setStepUpOpen(false); }}
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
                else if (e.key === 'Escape') setStepUpOpen(false);
              }}
            />
            {stepUpErr && <p className="text-warm text-sm mt-2 break-keep">{stepUpErr}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setStepUpOpen(false)} className="btn-outline flex-1">취소</button>
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
interface PushLog {
  id: number;
  target_kind: 'all' | 'user';
  target_user_id: number | null;
  title: string;
  body: string;
  url: string | null;
  subscribers_sent: number;
  subscribers_failed: number;
  created_at: number;
}

function PushTab() {
  const [target, setTarget] = useState<'all' | 'user'>('all');
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; expired?: number; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<PushLog[] | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPw, setStepUpPw] = useState('');
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpErr, setStepUpErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ logs: PushLog[] }>('/api/admin/push/log')
      .then((d) => setLogs(d.logs))
      .catch(() => setLogs([])); // 에러도 빈 list 로 떨궈서 skeleton 무한 회피
  }, []);

  const reset = () => {
    setTitle(''); setBody(''); setUrl('/'); setUserId(''); setTarget('all'); setResult(null); setError(null);
  };

  const refreshLogs = async () => {
    try {
      const d = await apiGet<{ logs: PushLog[] }>('/api/admin/push/log');
      setLogs(d.logs);
    } catch {/* 무시 */}
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
      setTitle(''); setBody(''); setUrl('/'); setUserId('');
      await refreshLogs();
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

      <div className="mt-6">
        <h3 className="font-semibold mb-2">최근 발송 이력</h3>
        {logs === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <p className="text-sub text-sm">아직 발송한 알림이 없어요.</p>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {logs.map((l) => (
              <li key={l.id} className="px-4 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{l.title}</span>
                  <span className="text-sub text-xs num shrink-0">{fmtDateTime(l.created_at)}</span>
                </div>
                <div className="text-sub text-xs mt-0.5">
                  {l.target_kind === 'all' ? '전체' : `사용자 ${l.target_user_id}`} · 성공 {l.subscribers_sent} · 실패 {l.subscribers_failed}
                </div>
                <div className="text-ink/80 mt-1 break-keep">{l.body}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

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
