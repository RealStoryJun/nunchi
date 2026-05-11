import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Logo from './Logo';
import BottomNav from './BottomNav';
import NavIcon, { IconName } from './NavIcon';
import { useAuth, logout } from '../hooks/useAuth';

const sideItems: { to: string; label: string; icon: IconName }[] = [
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
  const navItems = user?.is_admin
    ? [...sideItems, { to: '/admin', label: '계정 관리', icon: 'shield' as IconName }]
    : sideItems;
  return (
    <div className="min-h-screen md:flex">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex md:flex-col md:w-64 md:shrink-0 md:border-r md:border-border md:bg-card md:min-h-screen md:p-6 md:gap-6">
        <Logo />
        {user && (
          <div className="text-sm">
            <div className="text-sub">가게 이름</div>
            <div className="font-semibold truncate">{user.business_name}</div>
          </div>
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
        <div className="mt-auto">
          <button
            type="button"
            onClick={onLogout}
            className="btn-ghost w-full text-sub"
          >
            로그아웃
          </button>
        </div>
      </aside>
      {/* 모바일 헤더 */}
      <header className="md:hidden sticky top-0 z-20 bg-card/90 backdrop-blur border-b border-border px-4 h-14 flex items-center justify-between">
        <Logo size={26} />
        {user && (
          <span className="text-sm font-semibold truncate max-w-[55%]">
            {user.business_name}
          </span>
        )}
      </header>
      <main className="flex-1 pb-24 md:pb-10 md:px-8 md:py-6">{children}</main>
      <BottomNav />
    </div>
  );
}
