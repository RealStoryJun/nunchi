import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Protected({
  children,
  requireBusinessType = true,
}: {
  children: ReactNode;
  requireBusinessType?: boolean;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();
  // 로딩 중엔 빈 배경만 — 진행 표시는 화면 중앙의 TopProgress 카드가 담당
  // (/api/me fetch가 인플라이트로 추적되므로 200ms 이상이면 자동으로 카드 노출)
  if (loading) return <div className="min-h-screen bg-bg" aria-busy="true" />;
  if (!user) return <Navigate to="/login" replace />;
  if (
    requireBusinessType &&
    !user.business_type &&
    location.pathname !== '/onboarding'
  )
    return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
