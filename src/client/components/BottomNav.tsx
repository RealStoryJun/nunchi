import { NavLink } from 'react-router-dom';
import NavIcon, { IconName } from './NavIcon';

const items: { to: string; label: string; icon: IconName }[] = [
  { to: '/sales', label: '판매', icon: 'receipt' },
  { to: '/menus', label: '메뉴', icon: 'tag' },
  { to: '/bi', label: 'BI', icon: 'chart' },
  { to: '/needs', label: '니즈', icon: 'users' },
  { to: '/account', label: '설정', icon: 'settings' },
];

export default function BottomNav() {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t border-border z-30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center h-16 text-xs gap-1 ${
                  isActive ? 'text-accent font-semibold' : 'text-sub'
                }`
              }
            >
              <NavIcon name={it.icon} />
              <span>{it.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
