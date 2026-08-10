import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, User, LogOut, Trophy, Briefcase, ChevronLeft, ChevronRight, Info, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Modal } from '../ui/Modal';

interface SidebarProps {
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ isCollapsed = false, onToggle }: SidebarProps) {
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const confirmLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <aside className={`h-full bg-surface-container-low flex flex-col justify-between py-8 transition-all duration-300 ${isCollapsed ? 'px-2' : 'px-6'}`}>
      <div>
        {/* Logo */}
        <div className={`mb-12 overflow-hidden ${isCollapsed ? 'flex justify-center' : ''}`}>
          {isCollapsed ? (
            <img src="/icons/icon-192.png" alt="APSNY-TRANSFER" className="w-9 h-9 rounded-lg" />
          ) : (
            <div className="flex items-center gap-2.5">
              <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg shrink-0" />
              <span className="text-xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-container to-secondary-container whitespace-nowrap">
                APSNY-TRANSFER
              </span>
            </div>
          )}
        </div>

        <nav className="space-y-1">
          <NavItem to="/" icon={<LayoutDashboard size={20} />} label="Лента аукционов" collapsed={isCollapsed} />
          <NavItem to="/create" icon={<PlusCircle size={20} />} label="Создать поездку" collapsed={isCollapsed} />
          <NavItem to="/my-trips" icon={<Briefcase size={20} />} label="Мои поездки" collapsed={isCollapsed} />
          <NavItem to="/ratings" icon={<Trophy size={20} />} label="Рейтинги" collapsed={isCollapsed} />
          <NavItem to="/profile" icon={<User size={20} />} label="Мой профиль" collapsed={isCollapsed} />
        </nav>

        <nav className="mt-6 pt-6 border-t border-white/5 space-y-1">
          <NavItem to="/about" icon={<Info size={20} />} label="О проекте" collapsed={isCollapsed} />
          <NavItem to="/contacts" icon={<Mail size={20} />} label="Контакты" collapsed={isCollapsed} />
        </nav>
      </div>

      <div className="flex flex-col gap-1">
        <button
          onClick={() => setShowLogoutModal(true)}
          title={isCollapsed ? 'Выйти' : undefined}
          className={`flex items-center gap-3 py-3 text-on-surface-variant hover:text-error transition-colors rounded-xl hover:bg-error/10 w-full ${isCollapsed ? 'justify-center px-2' : 'px-4 text-left'}`}
        >
          <LogOut size={20} />
          {!isCollapsed && <span className="font-medium">Выйти</span>}
        </button>

        {onToggle && (
          <button
            onClick={onToggle}
            title={isCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            className={`flex items-center gap-3 py-3 text-on-surface-variant hover:text-on-surface transition-colors rounded-xl hover:bg-surface-container-high w-full ${isCollapsed ? 'justify-center px-2' : 'px-4'}`}
          >
            {isCollapsed ? <ChevronRight size={18} /> : (
              <>
                <ChevronLeft size={18} />
                <span className="font-medium text-sm">Свернуть</span>
              </>
            )}
          </button>
        )}
      </div>

      <LogoutModal
        open={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={confirmLogout}
      />
    </aside>
  );
}

export function LogoutModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-error/10 border border-error/25 flex items-center justify-center shadow-[0_0_24px_rgba(239,68,68,0.2)]">
          <LogOut size={28} className="text-error" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-display font-semibold text-on-surface">Выйти из аккаунта?</h3>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Вы будете перенаправлены на страницу входа.
          </p>
        </div>
        <div className="flex gap-3 w-full pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all font-medium text-sm"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-error/15 border border-error/30 text-error hover:bg-error/25 transition-all font-semibold text-sm shadow-[0_0_12px_rgba(239,68,68,0.15)]"
          >
            Выйти
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NavItem({
  to,
  icon,
  label,
  badge = 0,
  collapsed = false,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  collapsed?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 py-3 rounded-xl transition-all ${
          collapsed ? 'justify-center px-2' : 'px-4'
        } ${
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
      </div>
      {!collapsed && <span className="font-medium">{label}</span>}
    </NavLink>
  );
}
