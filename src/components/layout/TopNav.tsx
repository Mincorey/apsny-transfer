import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, User, LogOut, Trophy, Briefcase, Bell } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LogoutModal } from './Sidebar';

interface TopNavProps {
  hasUnreadWon?: boolean;
  unreadNotifications?: number;
}

export function TopNav({ hasUnreadWon = false, unreadNotifications = 0 }: TopNavProps) {
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  return (
    <>
      <header className="hidden md:flex fixed top-0 left-0 right-0 z-50 h-16 items-center justify-center px-4 lg:px-6 bg-surface/80 backdrop-blur-2xl border-b border-outline-variant/20">
        <div className="w-full max-w-5xl grid grid-cols-[auto_1fr_auto] items-center gap-4">
          <NavLink to="/" className="flex items-center gap-2 shrink-0">
            <img src="/icons/icon-192.png" alt="" className="w-7 h-7 rounded-lg" />
            <span className="text-lg font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-container to-secondary-container whitespace-nowrap">
              APSNY-TRANSFER
            </span>
          </NavLink>

          <nav className="flex items-center justify-center gap-0.5">
            <NavItem to="/" icon={<LayoutDashboard size={18} />} label="Лента" />
            <NavItem to="/create" icon={<PlusCircle size={18} />} label="Создать" />
            <NavItem to="/notifications" icon={<Bell size={18} />} label="Уведомления" badge={unreadNotifications} />
            <NavItem to="/my-trips" icon={<Briefcase size={18} />} label="Поездки" dotBadge={hasUnreadWon} />
            <NavItem to="/ratings" icon={<Trophy size={18} />} label="Рейтинги" />
            <NavItem to="/profile" icon={<User size={18} />} label="Профиль" />
          </nav>

          <button
            onClick={() => setShowLogoutModal(true)}
            title="Выйти"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-on-surface-variant hover:text-error transition-colors hover:bg-error/10 shrink-0"
          >
            <LogOut size={18} />
            <span className="hidden xl:inline text-sm font-medium">Выйти</span>
          </button>
        </div>
      </header>

      <LogoutModal
        open={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => supabase.auth.signOut()}
      />
    </>
  );
}

function NavItem({
  to,
  icon,
  label,
  badge = 0,
  dotBadge = false,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  dotBadge?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={label}
      // Подпись видна только на широких экранах (класс xl:inline), на средних
      // остаётся голая иконка — поэтому имя пункта проговариваем всегда.
      aria-label={badge > 0 ? `${label} — непрочитанных: ${badge}` : label}
      className={({ isActive }) =>
        `flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
          isActive
            ? 'glass-card text-primary-container ambient-glow border border-primary-container/30'
            : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
        }`
      }
    >
      <div className="relative shrink-0">
        {icon}
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-primary-container text-background text-[9px] font-bold flex items-center justify-center px-1 leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
        {dotBadge && badge === 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-yellow-400" />
        )}
      </div>
      <span className="hidden xl:inline">{label}</span>
    </NavLink>
  );
}
