import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, refreshAuth } from '../hooks/useAuth';
import { apiPost } from '../lib/api';
import LoadingScreen from './LoadingScreen';

export default function Protected({
  children,
  requireBusinessType = true,
}: {
  children: ReactNode;
  requireBusinessType?: boolean;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();
  // "누가 봐도 기다린다"는 상황에서만 splash. 1초 미만 로딩은 안 보임.
  const [showSplash, setShowSplash] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowSplash(false);
      return;
    }
    const t = setTimeout(() => setShowSplash(true), 1000);
    return () => clearTimeout(t);
  }, [loading]);
  if (loading) return showSplash ? <LoadingScreen label="가게 정보를 불러오는 중" /> : null;
  if (!user) return <Navigate to="/login" replace />;
  // admin/master 가 일반 사용자 페이지에 진입 시 /admin 으로 강제 redirect.
  // PR D 의 escape hatch (URL 직접 입력 허용) 제거 - 사장님 결정 2026-05-18:
  // "가끔 /sales 로 접속해서 아무것도 안 되는 경우" 차단. 본래 spec "admin 접속은 admin 만" 더 엄격 적용.
  // /onboarding 은 신규 계정 첫 진입 흐름이라 제외.
  const adminOnlyBlocked = ['/sales', '/menus', '/bi', '/needs', '/account', '/tutorial'];
  if (
    (user.is_admin || user.is_master) &&
    adminOnlyBlocked.includes(location.pathname)
  ) {
    return <Navigate to="/admin" replace />;
  }
  if (
    requireBusinessType &&
    !user.business_type &&
    location.pathname !== '/onboarding'
  )
    return <Navigate to="/onboarding" replace />;
  return (
    <>
      {children}
      {user.requires_security_setup && <SecurityQuestionSetupModal />}
    </>
  );
}

// 어드민이 임의로 생성한 계정 (recovery_question = sentinel) 의 첫 보안질문 설정 모달.
// 사용자가 본인 질문/답을 직접 설정해야 비밀번호 찾기 (/recover) 사용 가능.
// 닫기 불가 - 설정 완료해야 dismiss.
function SecurityQuestionSetupModal() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await apiPost('/api/auth/recovery-question', {
        question: question.trim(),
        answer: answer.trim(),
      });
      await refreshAuth();
      // refreshAuth 가 user.requires_security_setup 을 false 로 갱신 → 모달 자동 unmount
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="card max-w-md w-full p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-lg">보안질문 설정</h3>
          <p className="text-sub text-sm mt-1 break-keep">
            관리자가 만든 계정이라 보안질문이 아직 비어 있어요. 본인만 답할 수 있는 질문·답변을 설정해주세요. 비밀번호를 잊었을 때 이 답변으로 본인 확인을 합니다.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">보안질문 (4-100자)</label>
            <input required minLength={4} maxLength={100}
              className="field" value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
              placeholder="예: 어렸을 때 키운 첫 반려동물의 이름은?" />
          </div>
          <div>
            <label className="label">답변 (4자 이상)</label>
            <input required minLength={4}
              className="field" value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={busy}
              placeholder="대소문자·공백은 무시됩니다" />
          </div>
          {error && <p className="text-warm text-sm">{error}</p>}
          <button type="submit"
            disabled={busy || question.trim().length < 4 || answer.trim().length < 4}
            className="btn-primary w-full h-10">
            {busy ? '저장 중…' : '설정 완료'}
          </button>
        </form>
      </div>
    </div>
  );
}
