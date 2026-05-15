import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout, refreshAuth, useAuth } from '../hooks/useAuth';
import {
  BUSINESS_TYPES,
  BUSINESS_GROUPS,
  businessTypeLabel,
} from '../lib/businessTypes';
import { apiPost } from '../lib/api';
import { invalidateByPrefix } from '../lib/cache';
import NavIcon from '../components/NavIcon';
import TwoFactorCard from '../components/TwoFactorCard';

export default function Account() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [editingType, setEditingType] = useState(false);
  const [pending, setPending] = useState(false);
  const typeGridRef = useRef<HTMLDivElement | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameErr, setNameErr] = useState<string | null>(null);

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };
  const setType = async (id: string) => {
    setPending(true);
    try {
      await apiPost('/api/me/business-type', { businessType: id });
      await refreshAuth();
      // 업종 카테고리가 바뀌면 AI 인사이트도 다른 어휘로 다시 생성돼야 함.
      // 서버는 ai_insights 전부 삭제했지만 클라 localStorage 캐시는 별도 invalidate.
      if (user?.id) invalidateByPrefix(`insights:${user.id}:`);
      setEditingType(false);
    } finally {
      setPending(false);
    }
  };
  const startEditName = () => {
    setNameInput(user?.business_name ?? '');
    setNameErr(null);
    setEditingName(true);
  };
  const saveName = async () => {
    if (savingName) return;
    const v = nameInput.trim();
    if (!v) {
      setNameErr('가게 이름을 입력해주세요.');
      return;
    }
    setSavingName(true);
    setNameErr(null);
    try {
      await apiPost('/api/me/business-name', { businessName: v });
      await refreshAuth();
      setEditingName(false);
    } catch (e) {
      setNameErr(e instanceof Error ? e.message : '변경에 실패했습니다.');
    } finally {
      setSavingName(false);
    }
  };
  if (!user) return null;
  const current = BUSINESS_TYPES.find((t) => t.id === user.business_type);
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <h1 className="font-display text-2xl md:text-3xl mb-4">계정 설정</h1>
      <div className="card p-5 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-sub text-sm">가게 이름</div>
            {!editingName && (
              <button
                type="button"
                onClick={startEditName}
                className="text-sm text-accent font-medium px-3 h-9 rounded-lg hover:bg-accent/10 -my-1"
              >
                변경
              </button>
            )}
          </div>
          {!editingName ? (
            <div className="text-lg font-semibold">{user.business_name}</div>
          ) : (
            <div className="space-y-2 anim-fade">
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={40}
                className="field md:max-w-sm"
                placeholder="가게 이름"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
              />
              {nameErr && <p className="text-warm text-sm">{nameErr}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveName}
                  disabled={savingName}
                  className="btn-primary px-4 h-9 text-sm disabled:opacity-50"
                >
                  {savingName ? '저장 중…' : '저장'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="btn-outline px-4 h-9 text-sm"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
        <div>
          <div className="text-sub text-sm">이메일</div>
          <div className="num">{user.email}</div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sub text-sm">업종</div>
            <button
              type="button"
              onClick={() => {
                setEditingType((v) => !v);
                // 그리드(34 tile, 6 group) 펼치면 자동 스크롤 - fold 아래 묻히지 않도록
                if (!editingType) {
                  requestAnimationFrame(() => {
                    typeGridRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                  });
                }
              }}
              className="text-sm text-accent font-medium px-3 h-9 rounded-lg hover:bg-accent/10 -my-1"
            >
              {editingType ? '취소' : '변경'}
            </button>
          </div>
          {!editingType ? (
            <div className="flex items-center gap-2">
              {current && <span className="text-xl">{current.emoji}</span>}
              <span className="font-medium">
                {businessTypeLabel(user.business_type)}
              </span>
            </div>
          ) : (
            <div ref={typeGridRef} className="anim-fade space-y-4">
              {/* 34 tile 6 그룹으로 묶음 (Onboarding과 동일 구조) - 평면 grid는 모바일 fold 아래 묻혀 PT/농구 찾기 어려움 */}
              {BUSINESS_GROUPS.map((g) => (
                <div key={g.group}>
                  <div className="text-sub text-xs font-semibold uppercase tracking-wide mb-2 px-1">
                    {g.group}
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {g.items.map((t) => {
                      const active = user.business_type === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={pending}
                          onClick={() => setType(t.id)}
                          className={`card flex flex-col items-center justify-center gap-1
                                      px-2 py-3 min-h-[88px] transition active:scale-[0.97]
                                      disabled:opacity-50 disabled:cursor-wait
                                      ${
                                        active
                                          ? 'ring-2 ring-accent border-accent bg-accent/[0.03]'
                                          : ''
                                      }`}
                        >
                          <span className="text-2xl leading-none">{t.emoji}</span>
                          <span
                            className={`block w-full text-xs truncate text-center mt-0.5
                                        ${active ? 'font-semibold text-accent' : 'text-ink'}`}
                          >
                            {t.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pt-2 border-t border-border" />
        <button onClick={onLogout} className="btn-outline w-full">
          로그아웃
        </button>
      </div>

      <div className="mt-4">
        <TwoFactorCard />
      </div>

      {user.is_admin && (
        <Link
          to="/admin"
          className="card p-4 mt-4 flex items-center gap-3 hover:border-accent/40 transition group"
        >
          <span className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <NavIcon name="shield" size={18} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="font-medium block">계정 관리 (관리자)</span>
            <span className="text-sub text-sm block break-keep">
              가입 계정 검색 · 가입일 조회 · 일괄 삭제
            </span>
          </span>
          <span className="text-sub group-hover:text-accent transition">→</span>
        </Link>
      )}

      <p className="text-sub text-sm mt-4 text-center">
        AI 분석, 다크모드, 직원 추가 등은 다음 단계에서 추가될 예정입니다.
      </p>
    </div>
  );
}
