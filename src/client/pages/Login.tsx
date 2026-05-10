import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/sales" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email, password);
      navigate('/sales');
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
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
      <main className="flex-1 flex items-start md:items-center justify-center px-6 pt-6 pb-10 md:pt-0">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-3xl text-ink mb-1">다시 오셨네요</h1>
          <p className="text-sub mb-6">로그인해서 오늘의 매출을 기록하세요.</p>
          <form onSubmit={onSubmit} className="card p-6 space-y-4">
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
              <label className="label">비밀번호</label>
              <input
                type="password"
                required
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-warm text-sm">{error}</p>}
            <button type="submit" disabled={pending} className="btn-primary w-full">
              {pending ? '로그인 중…' : '로그인'}
            </button>
            <div className="flex justify-between text-sm">
              <Link to="/recover" className="text-sub hover:text-ink">
                비밀번호 찾기
              </Link>
              <Link to="/signup" className="text-accent font-semibold">
                회원가입 →
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
