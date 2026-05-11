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
  created_at: number;
  sales_count: number;
  menu_count: number;
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

export default function Admin() {
  const { user, loading } = useAuth();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false); // 삭제 진행 중
  const [busyList, setBusyList] = useState(false); // 목록 재조회 중 (기존 목록은 흐리게 유지)
  const [error, setError] = useState<string | null>(null);

  const me = user?.id ?? -1;
  const isAdmin = !!user?.is_admin;

  // 검색 (입력 시 300ms debounce, 초기 1회는 즉시). 재검색 시 기존 목록을 흐리게 유지 — 스켈레톤 깜빡임 방지.
  useEffect(() => {
    if (loading || !isAdmin) return;
    let alive = true;
    const t = window.setTimeout(() => {
      setBusyList(true);
      setError(null);
      apiGet<{ users: AdminUser[]; total: number }>(
        `/api/admin/users?q=${encodeURIComponent(q)}`,
      )
        .then((d) => {
          if (!alive) return;
          setUsers(d.users);
          setTotal(d.total);
        })
        .catch((e) => {
          if (!alive) return;
          setUsers((prev) => prev ?? []);
          setError(e instanceof Error ? e.message : '불러오기 실패');
        })
        .finally(() => {
          if (alive) setBusyList(false);
        });
    }, q ? 300 : 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, loading, isAdmin]);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/sales" replace />;

  const selectableIds = users?.filter((u) => u.id !== me).map((u) => u.id) ?? [];
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const refetch = async () => {
    setBusyList(true);
    // _ts: 검색 effect의 인플라이트 GET과 dedup 키가 겹치지 않도록 (삭제 직후 stale 목록 방지)
    try {
      const d = await apiGet<{ users: AdminUser[]; total: number }>(
        `/api/admin/users?q=${encodeURIComponent(q)}&_ts=${Date.now()}`,
      );
      setUsers(d.users);
      setTotal(d.total);
    } catch (e) {
      setUsers((prev) => prev ?? []);
      setError(e instanceof Error ? e.message : '목록을 새로 불러오지 못했습니다.');
    } finally {
      setBusyList(false);
    }
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !confirm(
        `선택한 ${ids.length}개 계정을 삭제할까요?\n해당 계정의 메뉴·판매 기록도 함께 삭제되며, 되돌릴 수 없습니다.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiPost<{ deleted: number; skippedSelf: boolean }>(
        '/api/admin/users/delete',
        { ids },
      );
      setSelected(new Set());
      await refetch();
      if (d.skippedSelf) alert('본인 계정은 삭제할 수 없어 제외했습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <div className="flex items-baseline gap-3 mb-1">
        <h1 className="font-display text-2xl md:text-3xl">계정 관리</h1>
        <span className="text-sub text-sm">관리자 전용</span>
      </div>
      <p className="text-sub text-sm mb-4">
        전체 {total ?? '…'}개 계정
        {q && users ? ` · "${q}" 검색결과 ${users.length}개` : ''}
      </p>

      {/* 검색 */}
      <div className="card p-2 mb-3 flex items-center gap-2">
        <span className="text-sub pl-1.5">
          <NavIcon name="search" size={18} />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이메일 또는 가게 이름으로 검색"
          className="flex-1 bg-transparent outline-none text-sm py-2 num"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="text-sub text-sm px-2 h-8 rounded hover:bg-black/5"
          >
            지우기
          </button>
        )}
      </div>

      {/* 선택 삭제 바 */}
      {selected.size > 0 && (
        <div className="card p-3 mb-3 flex items-center justify-between bg-warm/[0.04] border-warm/30 anim-fade">
          <span className="text-sm">
            <b className="num">{selected.size}</b>개 선택됨
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-sm text-sub px-3 h-9 rounded-lg hover:bg-black/5"
            >
              선택 해제
            </button>
            <button
              type="button"
              onClick={bulkDelete}
              disabled={busy}
              className="btn-warm px-4 h-9 text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <NavIcon name="trash" size={15} />
              {busy ? '삭제 중…' : '선택 삭제'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-warm text-sm mb-3">{error}</p>}

      {/* 목록 */}
      {users === null || (busyList && users.length === 0) ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="card p-10 text-center text-sub">
          {q ? '검색 결과가 없습니다.' : '계정이 없습니다.'}
        </div>
      ) : (
        <div
          className={`card divide-y divide-border overflow-hidden transition-opacity ${
            busyList ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          <div className="px-4 py-2.5 flex items-center gap-3 bg-bg/60 text-xs text-sub">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="w-4 h-4 accent-accent shrink-0"
              aria-label="전체 선택"
            />
            <span className="flex-1">계정 ({users.length})</span>
            <span className="hidden sm:block w-28 text-right">가입일</span>
            <span className="w-14 text-right">판매</span>
          </div>
          {users.map((u) => {
            const self = u.id === me;
            return (
              <label
                key={u.id}
                className={`px-4 py-3 flex items-center gap-3 ${
                  self ? 'opacity-70' : 'cursor-pointer hover:bg-black/[0.02]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(u.id)}
                  onChange={() => toggleOne(u.id)}
                  disabled={self}
                  className="w-4 h-4 accent-accent shrink-0 disabled:opacity-40"
                  aria-label={`${u.business_name} 선택`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium truncate">
                      {u.business_name}
                    </span>
                    {u.is_admin && (
                      <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">
                        ADMIN
                      </span>
                    )}
                    {self && (
                      <span className="text-[10px] text-sub shrink-0">(나)</span>
                    )}
                  </div>
                  <div className="text-sub text-xs num truncate">{u.email}</div>
                  <div className="text-sub text-[11px] mt-0.5">
                    {businessTypeLabel(u.business_type)} · 메뉴 {u.menu_count}개
                    <span className="sm:hidden"> · 가입 {fmtDate(u.created_at)}</span>
                  </div>
                </div>
                <span className="hidden sm:block w-28 text-right text-xs text-sub num">
                  {fmtDate(u.created_at)}
                </span>
                <span className="w-14 text-right num text-sm">
                  {u.sales_count}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
