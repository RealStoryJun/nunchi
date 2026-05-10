import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-sub">
        불러오는 중…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
