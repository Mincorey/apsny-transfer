import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, User, LogOut, Trophy, Briefcase, Bell } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LogoutModal } from './Sidebar';
import { useNotificationBadges } from '../../context/NotificationBadgeContext';

export function TopNav() {
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  // Счётчики берём из общего контекста, а не из пропсов: TopNav рисуется и в
  // MainLayout, и отдельно на карточке поездки — раньше во втором случае
  // значок пропадал, потому что пропсы туда никто не передавал.
  const { hasUnreadWon, unreadNotifications } = useNotificationBadges();

  return (
    <>
      <header className="hidden md:flex fixed top-0 left-0 right-0 z-50 h-16 items-center justify-center px-4 lg:px-6 bg-surface/80 backdrop-blur-2xl border-b border-outline-variant/20">
        {/*
          Меню центрируется абсолютно, а не колонкой сетки.
          Сначала я поставил равные колонки 1fr | auto | 1fr — центр стал
          настоящим, но боковые колонки сжались до ширины остатка и придавили
          логотип, он полез под меню. Здесь края живут в потоке и занимают
          сколько нужно, а меню висит ровно по середине шапки независимо от них.
        */}
        <div className="relative w-full max-w-5xl xl:max-w-6xl flex items-center justify-between gap-4">
          <NavLink to="/" className="flex items-center gap-2 shrink-0">
            <img src="/icons/icon-192.png" alt="" className="w-7 h-7 rounded-lg" />
            <span className="text-lg font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-container to-secondary-container whitespace-nowrap">
              APSNY-TRANSFER
            </span>
          </NavLink>

          <nav className="absolute left-1/2 -translate-x-1/2 flex items-center gap-0.5">
            <NavItem to="/" icon={<LayoutDashboard size={18} />} label="Лента" />
            <NavItem to="/create" icon={<PlusCircle size={18} />} label="Создать" />
            <NavItem to="/notifications" icon={<Bell size={18} />} label="Уведомления" badge={unreadNotifications} />
            <NavItem to="/my-trips" icon={<Briefcase size={18} />} label="Поездки" dotBadge={hasUnreadWon} />
            <NavItem to="/ratings" icon={<Trophy size={18} />} label="Рейтинги" />
            <NavItem to="/profile" icon={<User size={18} />} label="Профиль" />
          </nav>

          {/*
            Подпись у кнопки убрана насовсем. Раньше она появлялась только от
            1280 пикселей, и на границе этой ширины правый край шапки прыгал,
            утаскивая за собой всё меню. Иконка с подсказкой и внятным
            aria-label понятна и без слова.
          */}
          <button
            onClick={() => setShowLogoutModal(true)}
            title="Выйти"
            aria-label="Выйти из аккаунта"
            className="flex items-center justify-center w-10 h-10 rounded-xl text-on-surface-variant hover:text-error transition-colors hover:bg-error/10 shrink-0"
          >
            <LogOut size={18} />
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
