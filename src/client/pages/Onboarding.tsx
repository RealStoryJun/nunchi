import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { apiPost } from '../lib/api';
import { BUSINESS_GROUPS } from '../lib/businessTypes';
import { refreshAuth, useAuth } from '../hooks/useAuth';

export default function Onboarding() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  // 이미 설정한 사용자는 건너뜀
  if (user.business_type) return <Navigate to="/sales" replace />;

  const submit = async () => {
    if (!selected) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/api/me/business-type', { businessType: selected });
      await refreshAuth();
      navigate('/tutorial');
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="px-5 pt-5 pb-2 flex items-center justify-between max-w-2xl mx-auto w-full anim-fade">
        <Logo size={26} />
        <span className="text-sub text-sm">1 / 1</span>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-5 pt-4 pb-32 md:flex md:flex-col md:justify-center md:pt-0 md:pb-24">
        <div
          className="anim-rise"
          style={{ animationDelay: '40ms' }}
        >
          <p className="text-sub text-sm mb-1">
            {user.business_name}님, 환영해요
          </p>
          <h1 className="font-display text-3xl md:text-4xl leading-tight text-ink break-keep">
            어떤 업종이세요?
          </h1>
          <p className="text-sub mt-2 text-sm md:text-base">
            업종에 맞춰 메뉴 등록과 분석을 도와드릴게요.
          </p>
        </div>

        {/* 업종 26개 - 그룹별 헤더로 묶어 보여줘 select 길이를 시각적으로 압축 (사장님 의견) */}
        <div className="mt-6 space-y-5">
          {BUSINESS_GROUPS.map((g) => (
            <div key={g.group}>
              <div className="text-sub text-xs font-semibold uppercase tracking-wide mb-2 px-1">
                {g.group}
              </div>
              <ul className="grid grid-cols-3 md:grid-cols-4 gap-2">
                {g.items.map((t, i) => {
                  const active = selected === t.id;
                  return (
                    <li
                      key={t.id}
                      className="anim-rise"
                      style={{ animationDelay: `${120 + Math.min(i, 5) * 25}ms` }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelected(t.id)}
                        aria-pressed={active}
                        className={`relative w-full min-w-0 card flex flex-col items-center justify-center
                                    gap-1 px-2 py-4 min-h-[112px] transition-all duration-200
                                    focus:outline-none active:scale-[0.97]
                                    ${
                                      active
                                        ? 'ring-2 ring-accent border-accent bg-accent/[0.03] scale-[1.02] anim-select'
                                        : 'hover:border-accent/40'
                                    }`}
                      >
                        {active && (
                          <span
                            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-accent
                                       text-white text-xs flex items-center justify-center anim-check"
                            aria-hidden
                          >
                            ✓
                          </span>
                        )}
                        <span className="text-3xl leading-none">{t.emoji}</span>
                        <span
                          className={`block w-full text-sm truncate text-center mt-1 transition-colors
                                      ${active ? 'font-semibold text-accent' : 'font-medium text-ink'}`}
                        >
                          {t.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {error && (
          <p className="text-warm text-sm mt-4 anim-fade text-center">{error}</p>
        )}
      </main>

      <div
        className="fixed inset-x-0 bg-gradient-to-t from-bg via-bg to-transparent
                   pt-6 pb-4 px-5 z-30"
        style={{ bottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={submit}
            disabled={!selected || submitting}
            className={`btn w-full text-base font-semibold transition-all
                        ${
                          selected
                            ? 'bg-accent text-white hover:bg-[#163a2a] anim-fade'
                            : 'bg-border text-sub cursor-not-allowed'
                        }`}
          >
            {submitting ? '저장 중…' : selected ? '다음' : '업종을 선택해주세요'}
          </button>
        </div>
      </div>
    </div>
  );
}
