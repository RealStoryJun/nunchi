import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth, refreshAuth } from '../hooks/useAuth';
import { apiGet, apiPost } from '../lib/api';

const PRESET_QUESTIONS = [
  '어릴 때 키운 첫 반려동물 이름은?',
  '내 인생 최고의 여행지는?',
  '초등학교 단짝의 이름은?',
  '내가 자주 가던 분식집 이름은?',
];

// Turnstile global API 타입 (스크립트 로드 후 window.turnstile)
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        opts: { sitekey: string; callback: (token: string) => void; 'error-callback'?: () => void; theme?: 'light' | 'dark' | 'auto' },
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

export default function Signup() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [recoveryQuestion, setRecoveryQuestion] = useState(PRESET_QUESTIONS[0]);
  const [customQuestion, setCustomQuestion] = useState('');
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Turnstile site key — TURNSTILE_SITE_KEY env 설정돼 있으면 widget 노출, 아니면 자동 통과
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>('');
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  // 1. site key fetch
  useEffect(() => {
    apiGet<{ site_key: string | null }>('/api/auth/turnstile/config')
      .then((d) => setSiteKey(d.site_key))
      .catch(() => setSiteKey(null));
  }, []);

  // 2. site key 있으면 Turnstile script 로드 + widget 렌더링
  useEffect(() => {
    if (!siteKey || !turnstileRef.current) return;
    const ensureScript = () =>
      new Promise<void>((resolve) => {
        if (window.turnstile) return resolve();
        const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
        if (existing) {
          existing.addEventListener('load', () => resolve());
          return;
        }
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        s.async = true; s.defer = true;
        s.onload = () => resolve();
        document.head.appendChild(s);
      });
    ensureScript().then(() => {
      if (!turnstileRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        callback: (token) => setTurnstileToken(token),
        'error-callback': () => setTurnstileToken(''),
        theme: 'light',
      });
    });
  }, [siteKey]);

  if (loading) return null;
  if (user) return <Navigate to="/sales" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (siteKey && !turnstileToken) {
      setError('봇 검증을 완료해주세요.');
      return;
    }
    setPending(true);
    try {
      const q =
        recoveryQuestion === '__custom__' ? customQuestion.trim() : recoveryQuestion;
      if (!q) throw new Error('보안질문을 입력해주세요.');
      await apiPost('/api/auth/signup', {
        email,
        password,
        businessName,
        recoveryQuestion: q,
        recoveryAnswer,
        ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      });
      await refreshAuth();
      navigate('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : '회원가입에 실패했습니다.');
      // 봇 검증은 일회용 — 실패 후 widget 재발급
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        setTurnstileToken('');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 max-w-5xl mx-auto w-full">
        <Link to="/">
          <Logo />
        </Link>
      </header>
      <main className="flex-1 flex items-start md:items-center justify-center px-6 pt-4 pb-10 md:pt-0">
        <div className="w-full max-w-md">
          <h1 className="font-display text-3xl text-ink mb-1">눈치 시작하기</h1>
          <p className="text-sub mb-6">가게 이름과 이메일만 있으면 끝.</p>
          <form onSubmit={onSubmit} className="card p-6 space-y-4">
            <div>
              <label className="label">가게 이름</label>
              <input
                required
                className="field"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="예: 동네카페 눈치"
              />
            </div>
            <div>
              <label className="label">이메일</label>
              <input
                type="email"
                required
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">비밀번호 (8자 이상, 영문+숫자)</label>
              <input
                type="password"
                required
                minLength={8}
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">비밀번호 찾기용 질문</label>
              <select
                className="field"
                value={recoveryQuestion}
                onChange={(e) => setRecoveryQuestion(e.target.value)}
              >
                {PRESET_QUESTIONS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
                <option value="__custom__">직접 입력…</option>
              </select>
              {recoveryQuestion === '__custom__' && (
                <input
                  className="field mt-2"
                  placeholder="질문을 입력하세요"
                  value={customQuestion}
                  onChange={(e) => setCustomQuestion(e.target.value)}
                />
              )}
            </div>
            <div>
              <label className="label">답변 (4자 이상)</label>
              <input
                required
                minLength={4}
                className="field"
                value={recoveryAnswer}
                onChange={(e) => setRecoveryAnswer(e.target.value)}
                placeholder="대소문자/공백은 무시됩니다"
              />
            </div>
            {/* Turnstile widget — site key 있을 때만 렌더 */}
            {siteKey && <div ref={turnstileRef} className="flex justify-center" />}
            {error && <p className="text-warm text-sm">{error}</p>}
            <button
              type="submit"
              disabled={pending || (!!siteKey && !turnstileToken)}
              className="btn-primary w-full"
            >
              {pending ? '가입 중…' : '가입하고 시작하기'}
            </button>
            <p className="text-sm text-sub text-center">
              이미 계정이 있나요?{' '}
              <Link to="/login" className="text-accent font-semibold">
                로그인
              </Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
