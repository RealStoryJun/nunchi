import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const { user, loading, login, loginMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // 2FA 2단계 상태 - null이면 1단계, 토큰이 있으면 2단계 코드 입력
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  if (loading) return null;
  if (user) return <Navigate to="/sales" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const r = await login(email, password);
      if (r.kind === 'mfa') {
        setMfaToken(r.mfa_token);
      } else {
        navigate('/sales');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setPending(false);
    }
  };

  const onMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setPending(true);
    try {
      await loginMfa(mfaToken, code);
      navigate('/sales');
    } catch (err) {
      setError(err instanceof Error ? err.message : '인증에 실패했습니다.');
      // 토큰 만료 메시지면 1단계로 복귀
      if (err instanceof Error && err.message.includes('만료')) {
        setMfaToken(null);
        setCode('');
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
      <main className="flex-1 flex items-start md:items-center justify-center px-6 pt-6 pb-10 md:pt-0">
        <div className="w-full max-w-sm">
          {mfaToken ? (
            <>
              <h1 className="font-display text-3xl text-ink mb-1">2단계 인증</h1>
              <p className="text-sub mb-6 break-keep">
                인증 앱에서 6자리 코드를 확인해서 입력해주세요. 백업코드(a1b2-c3d4)도 사용 가능합니다.
              </p>
              <form onSubmit={onMfaSubmit} className="card p-6 space-y-4">
                <div>
                  <label className="label">인증 코드</label>
                  <input
                    type="text"
                    required
                    autoComplete="one-time-code"
                    className="field num text-2xl tracking-widest text-center"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
                    placeholder="123456"
                    maxLength={20}
                    autoFocus
                  />
                </div>
                {error && <p className="text-warm text-sm break-keep">{error}</p>}
                <button type="submit" disabled={pending || code.length < 6} className="btn-primary w-full">
                  {pending ? '확인 중…' : '확인'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMfaToken(null); setCode(''); setError(null); }}
                  className="w-full text-sm text-sub hover:text-ink py-2"
                >
                  ← 처음부터 다시
                </button>
              </form>
            </>
          ) : (
            <>
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
                <div className="flex justify-between text-sm -mx-2">
                  <Link
                    to="/recover"
                    className="text-sub hover:text-ink px-2 py-2.5 rounded-md"
                  >
                    비밀번호 찾기
                  </Link>
                  <Link
                    to="/signup"
                    className="text-accent font-semibold px-2 py-2.5 rounded-md"
                  >
                    회원가입 →
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
