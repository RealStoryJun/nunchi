import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth, refreshAuth } from '../hooks/useAuth';
import { apiPost } from '../lib/api';

const PRESET_QUESTIONS = [
  '어릴 때 키운 첫 반려동물 이름은?',
  '내 인생 최고의 여행지는?',
  '초등학교 단짝의 이름은?',
  '내가 자주 가던 분식집 이름은?',
];

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

  if (loading) return null;
  if (user) return <Navigate to="/sales" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
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
      });
      await refreshAuth();
      navigate('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : '회원가입에 실패했습니다.');
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
              <label className="label">답변</label>
              <input
                required
                className="field"
                value={recoveryAnswer}
                onChange={(e) => setRecoveryAnswer(e.target.value)}
                placeholder="대소문자/공백은 무시됩니다"
              />
            </div>
            {error && <p className="text-warm text-sm">{error}</p>}
            <button type="submit" disabled={pending} className="btn-primary w-full">
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
