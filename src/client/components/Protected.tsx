import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
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
  // 진짜 로딩이 있을 때만 splash. 150ms 미만 짧은 로딩은 깜빡임 방지로 표시 안 함.
  const [showSplash, setShowSplash] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowSplash(false);
      return;
    }
    const t = setTimeout(() => setShowSplash(true), 150);
    return () => clearTimeout(t);
  }, [loading]);
  if (loading) return showSplash ? <LoadingScreen label="가게 정보를 불러오는 중" /> : null;
  if (!user) return <Navigate to="/login" replace />;
  if (
    requireBusinessType &&
    !user.business_type &&
    location.pathname !== '/onboarding'
  )
    return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
