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
  if (
    requireBusinessType &&
    !user.business_type &&
    location.pathname !== '/onboarding'
  )
    return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
