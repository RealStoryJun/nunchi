import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { apiPost } from '../lib/api';

export default function Recover() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const startRecover = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const data = await apiPost<{ recoveryQuestion: string }>(
        '/api/auth/recover/start',
        { email },
      );
      setQuestion(data.recoveryQuestion);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : '실패');
    } finally {
      setPending(false);
    }
  };

  const verifyRecover = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiPost('/api/auth/recover/verify', {
        email,
        answer,
        newPassword,
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : '실패');
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
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-3xl text-ink mb-1">비밀번호 찾기</h1>
          <p className="text-sub mb-6">
            가입할 때 등록한 보안질문 답변으로 새 비밀번호를 설정합니다.
          </p>
          {step === 1 && (
            <form onSubmit={startRecover} className="card p-6 space-y-4">
              <div>
                <label className="label">이메일</label>
                <input
                  type="email"
                  required
                  className="field"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error && <p className="text-warm text-sm">{error}</p>}
              <button type="submit" disabled={pending} className="btn-primary w-full">
                {pending ? '확인 중…' : '다음'}
              </button>
              <p className="text-sm text-center">
                <Link to="/login" className="text-sub">
                  로그인으로 돌아가기
                </Link>
              </p>
            </form>
          )}
          {step === 2 && (
            <form onSubmit={verifyRecover} className="card p-6 space-y-4">
              <div>
                <label className="label">보안질문</label>
                <p className="text-ink font-medium">{question}</p>
              </div>
              <div>
                <label className="label">답변</label>
                <input
                  required
                  className="field"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </div>
              <div>
                <label className="label">새 비밀번호 (8자 이상, 영문+숫자)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  className="field"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-warm text-sm">{error}</p>}
              <button type="submit" disabled={pending} className="btn-primary w-full">
                {pending ? '재설정 중…' : '비밀번호 재설정'}
              </button>
            </form>
          )}
          {step === 3 && (
            <div className="card p-6 text-center space-y-4">
              <p className="text-2xl">✅</p>
              <p>비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.</p>
              <button
                onClick={() => navigate('/login')}
                className="btn-primary w-full"
              >
                로그인하러 가기
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
