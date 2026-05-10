import { NavLink } from 'react-router-dom';

const items = [
  { to: '/sales', label: '판매', icon: '🧾' },
  { to: '/menus', label: '메뉴', icon: '🏷️' },
  { to: '/bi', label: 'BI', icon: '📊' },
  { to: '/account', label: '설정', icon: '⚙️' },
];

export default function BottomNav() {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t border-border z-30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-4">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center h-16 text-xs gap-0.5 ${
                  isActive ? 'text-accent font-semibold' : 'text-sub'
                }`
              }
            >
              <span className="text-lg leading-none">{it.icon}</span>
              <span>{it.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
