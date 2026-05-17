import { ReactNode, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Logo from './Logo';
import BottomNav from './BottomNav';
import NavIcon, { IconName } from './NavIcon';
import { useAuth, logout, refreshAuth } from '../hooks/useAuth';

const sideItems: { to: string; label: string; icon: IconName }[] = [
  { to: '/needs', label: '고객 니즈', icon: 'users' },
  { to: '/sales', label: '판매 입력', icon: 'receipt' },
  { to: '/menus', label: '메뉴 관리', icon: 'tag' },
  { to: '/bi', label: 'BI 대시보드', icon: 'chart' },
  { to: '/account', label: '계정 설정', icon: 'settings' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const onLogout = async () => {
    await logout();
    navigate('/login');
  };
  // 만료 시점에 자동 refresh - 카트 담고 자정 넘겼을 때 stale isReadOnly 방지.
  // 7일 이내일 때만 timer (setTimeout 25일 wrap-around 회피).
  useEffect(() => {
    if (!user || user.is_master || user.access_until == null) return;
    const remainMs = user.access_until - Date.now();
    if (remainMs <= 0) return;
    if (remainMs > 7 * 24 * 60 * 60 * 1000) return;
    const t = window.setTimeout(() => refreshAuth(), remainMs + 1000);
    return () => window.clearTimeout(t);
  }, [user?.access_until, user?.is_master]);
  // 어드민 모드 - admin/master 시 일반 nav 숨김. URL 직접 입력은 허용 (본인 가게 확인용).
  // 헤더 가게 이름 자리도 "관리자 모드" 라벨로 교체.
  const isAdminMode = !!user?.is_admin;
  const navItems: { to: string; label: string; icon: IconName }[] = isAdminMode
    ? [{ to: '/admin', label: '관리자', icon: 'shield' }]
    : sideItems;
  return (
    <div className="min-h-screen md:flex">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex md:flex-col md:w-64 md:shrink-0 md:border-r md:border-border md:bg-card md:min-h-screen md:p-6 md:gap-6">
        <Logo />
        {user && (
          isAdminMode ? (
            <span className="inline-flex items-center gap-1 self-start bg-warm/10 text-warm text-xs font-semibold px-2 py-1 rounded-full">
              <NavIcon name="shield" size={14} />
              관리자 모드
            </span>
          ) : (
            <div className="text-sm">
              <div className="text-sub">가게 이름</div>
              <div className="font-semibold truncate">{user.business_name}</div>
            </div>
          )
        )}
        <nav className="flex flex-col gap-1">
          {navItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 h-11 rounded-xl text-sm transition ${
                  isActive
                    ? 'bg-accent text-white font-semibold'
                    : 'text-ink hover:bg-black/5'
                }`
              }
            >
              <NavIcon name={it.icon} size={18} />
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className={isAdminMode ? 'mt-2' : 'mt-auto'}>
          <button
            type="button"
            onClick={onLogout}
            className="btn-ghost w-full text-sub"
          >
            로그아웃
          </button>
        </div>
      </aside>
      {/* 우측 column (모바일 헤더 + 배너 + 본문). 데스크탑에서 aside 옆 vertical stack. */}
      <div className="flex-1 min-w-0 md:flex md:flex-col">
        {/* 모바일 헤더 */}
        <header className="md:hidden sticky top-0 z-20 bg-card/90 backdrop-blur border-b border-border px-4 h-14 flex items-center justify-between">
          <Logo size={26} />
          {user && (
            isAdminMode ? (
              <span className="inline-flex items-center gap-1 bg-warm/10 text-warm text-xs font-semibold px-2 py-1 rounded-full shrink-0">
                <NavIcon name="shield" size={12} />
                관리자 모드
              </span>
            ) : (
              <span className="text-sm font-semibold truncate max-w-[55%]">
                {user.business_name}
              </span>
            )
          )}
        </header>
        {/* 사용 기간 만료 임박/만료 배너 (2026-05-16). master·access_until null 인 사용자는 비표시.
            <= 0 으로 boundary 정정 (정확히 0일 시점 = 만료). */}
        {user && !user.is_master && user.access_until != null && (() => {
          const now = Date.now();
          const remainMs = user.access_until - now;
          const dayMs = 24 * 60 * 60 * 1000;
          if (remainMs <= 0) {
            return (
              <div className="bg-warm/10 border-b border-warm/30 px-6 py-2 text-warm text-sm text-center break-keep">
                사용 기간이 끝났어요. 입력·수정이 막혀 있어요. 연장은{' '}
                <a href="mailto:god8night@gmail.com" className="underline font-medium">관리자에게 문의</a>해주세요.
              </div>
            );
          }
          if (remainMs < 7 * dayMs) {
            const remainDays = Math.ceil(remainMs / dayMs);
            return (
              <div className="bg-warn/10 border-b border-warn/30 px-6 py-2 text-warn text-sm text-center break-keep">
                사용 기간이 {remainDays}일 남았어요. 끝나면 입력·수정이 막혀요. 연장은{' '}
                <a href="mailto:god8night@gmail.com" className="underline font-medium">관리자에게 문의</a>해주세요.
              </div>
            );
          }
          return null;
        })()}
        <main className={`flex-1 ${isAdminMode ? 'pb-10' : 'pb-24'} md:pb-10 md:px-8 md:py-6`}>{children}</main>
      </div>
      {!isAdminMode && <BottomNav />}
    </div>
  );
}
