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
  // splash가 0→100% 부드럽게 채워질 시간 보장 (LoadingScreen FILL_MS와 일치)
  const [minHold, setMinHold] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setMinHold(false), 850);
    return () => clearTimeout(t);
  }, []);
  if (loading || minHold)
    return <LoadingScreen label="가게 정보를 불러오는 중" />;
  if (!user) return <Navigate to="/login" replace />;
  if (
    requireBusinessType &&
    !user.business_type &&
    location.pathname !== '/onboarding'
  )
    return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
