import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, User, Briefcase } from 'lucide-react';

interface BottomNavProps {
  hasUnreadWon?: boolean;
}

export function BottomNav({ hasUnreadWon = false }: BottomNavProps) {
  return (
    // <nav> вместо <div>: это ориентир для скринридера, по нему можно
    // перепрыгнуть к меню, не вычитывая всю страницу.
    <nav
      aria-label="Основное меню"
      className="glass-panel border-t border-outline-variant/30 px-4 py-5 pb-7 flex justify-around items-center rounded-t-3xl shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
    >
      <NavItem to="/" icon={<LayoutDashboard size={26} />} label="Лента" />
      <NavItem to="/create" icon={<PlusCircle size={34} />} label="Создать" isPrimary />
      <NavItem to="/my-trips" icon={<Briefcase size={26} />} label="Поездки" dot={hasUnreadWon} />
      <NavItem to="/profile" icon={<User size={26} />} label="Профиль" />
    </nav>
  );
}

function NavItem({
  to,
  icon,
  label,
  isPrimary = false,
  badge = 0,
  dot = false,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  isPrimary?: boolean;
  badge?: number;
  dot?: boolean;
}) {
  return (
    // aria-label нужен и там, где подпись видна: у «Создать» текст скрыт
    // совсем (isPrimary), у остальных он набран шрифтом в 9 пикселей внутри
    // ссылки-иконки. Признак «есть непрочитанное» тоже проговариваем словами —
    // зелёная точка сама по себе для скринридера не существует.
    // aria-current="page" для активного пункта NavLink проставляет сам.
    <NavLink
      to={to}
      end={to === '/'}
      aria-label={dot ? `${label} — есть непрочитанное` : label}
      className={({ isActive }) =>
        isPrimary
          ? 'text-primary-container -mt-7 w-16 h-16 rounded-full border border-primary-container/20 shadow-[0_4px_24px_rgba(0,240,255,0.2)] bg-surface-container flex flex-col items-center justify-center transition-all'
          : `flex flex-col items-center justify-center gap-0.5 transition-all px-2 w-14 ${
              isActive
                ? 'text-primary-container'
                : 'text-on-surface-variant hover:text-on-surface'
            }`
      }
    >
      <div className="relative">
        {icon}
        {badge > 0 && !isPrimary && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-primary-container text-background text-[9px] font-bold flex items-center justify-center px-1 leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
        {dot && !isPrimary && badge === 0 && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" />
        )}
      </div>
      {!isPrimary && <span className="text-[9px] font-medium">{label}</span>}
    </NavLink>
  );
}
