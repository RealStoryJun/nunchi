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
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-sub">
        불러오는 중…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (
    requireBusinessType &&
    !user.business_type &&
    location.pathname !== '/onboarding'
  )
    return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
