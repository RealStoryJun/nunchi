import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout, refreshAuth, useAuth } from '../hooks/useAuth';
import {
  BUSINESS_TYPES,
  businessTypeLabel,
} from '../lib/businessTypes';
import { apiPost } from '../lib/api';

export default function Account() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [editingType, setEditingType] = useState(false);
  const [pending, setPending] = useState(false);

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };
  const setType = async (id: string) => {
    setPending(true);
    try {
      await apiPost('/api/me/business-type', { businessType: id });
      await refreshAuth();
      setEditingType(false);
    } finally {
      setPending(false);
    }
  };
  if (!user) return null;
  const current = BUSINESS_TYPES.find((t) => t.id === user.business_type);
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <h1 className="font-display text-2xl md:text-3xl mb-4">계정 설정</h1>
      <div className="card p-5 space-y-4">
        <div>
          <div className="text-sub text-sm">가게 이름</div>
          <div className="text-lg font-semibold">{user.business_name}</div>
        </div>
        <div>
          <div className="text-sub text-sm">이메일</div>
          <div className="num">{user.email}</div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sub text-sm">업종</div>
            {!editingType && (
              <button
                type="button"
                onClick={() => setEditingType(true)}
                className="text-xs text-accent font-medium hover:underline"
              >
                변경
              </button>
            )}
          </div>
          {!editingType ? (
            <div className="flex items-center gap-2">
              {current && <span className="text-xl">{current.emoji}</span>}
              <span className="font-medium">
                {businessTypeLabel(user.business_type)}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 anim-fade">
              {BUSINESS_TYPES.map((t) => {
                const active = user.business_type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={pending}
                    onClick={() => setType(t.id)}
                    className={`card flex flex-col items-center justify-center gap-1
                                px-2 py-3 min-h-[88px] transition active:scale-[0.97]
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
          )}
        </div>
        <div className="pt-2 border-t border-border" />
        <button onClick={onLogout} className="btn-outline w-full">
          로그아웃
        </button>
      </div>
      <p className="text-sub text-sm mt-4 text-center">
        AI 분석, 다크모드, 직원 추가 등은 다음 단계에서 추가될 예정입니다.
      </p>
    </div>
  );
}
