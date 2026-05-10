import { useNavigate } from 'react-router-dom';
import { logout, useAuth } from '../hooks/useAuth';

export default function Account() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const onLogout = async () => {
    await logout();
    navigate('/login');
  };
  if (!user) return null;
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
