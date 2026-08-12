import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, User, Briefcase, Bell } from 'lucide-react';
import { useNotificationBadges } from '../../context/NotificationBadgeContext';

/**
 * Нижнее меню (только мобильная вёрстка).
 *
 * Порядок пунктов подобран не случайно. Кнопка «Создать» — главное действие
 * сервиса, она вынесена в приподнятый круг и обязана стоять ровно посередине:
 * так её видно первой, и до неё одинаково удобно дотянуться большим пальцем
 * любой руки. Посередине она стоит только при нечётном числе пунктов, поэтому
 * их пять, а не четыре. До 12.08.2026 пунктов было четыре, и круг «Создать»
 * оказывался сдвинут влево от центра — это и выглядело неаккуратно, и было
 * неудобно.
 *
 * Слева от круга — то, что человек смотрит: лента и уведомления. Справа —
 * то, что принадлежит ему: свои поездки и профиль.
 */
export function BottomNav() {
  const { hasUnreadWon, unreadNotifications } = useNotificationBadges();

  return (
    // <nav> вместо <div>: это ориентир для скринридера, по нему можно
    // перепрыгнуть к меню, не вычитывая всю страницу.
    <nav
      aria-label="Основное меню"
      className="glass-panel border-t border-outline-variant/30 px-4 py-5 pb-7 flex justify-around items-center rounded-t-3xl shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
    >
      <NavItem to="/" icon={<LayoutDashboard size={26} />} label="Лента" />
      <NavItem to="/notifications" icon={<Bell size={26} />} label="Уведомления" badge={unreadNotifications} />
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
      aria-label={
        badge > 0
          ? `${label} — непрочитанных: ${badge}`
          : dot
            ? `${label} — есть непрочитанное`
            : label
      }
      className={({ isActive }) =>
        isPrimary
          ? 'text-primary-container -mt-7 w-16 h-16 rounded-full border border-primary-container/20 shadow-[0_4px_24px_rgba(0,240,255,0.2)] bg-surface-container flex flex-col items-center justify-center transition-all'
          : `flex flex-col items-center justify-center gap-0.5 transition-all px-1 w-[62px] ${
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
      {/* Подпись в одну строку: «Уведомления» — самое длинное слово в меню,
          на узких телефонах оно переносилось бы и ломало высоту ряда. */}
      {!isPrimary && (
        <span className="text-[9px] font-medium whitespace-nowrap max-w-full overflow-hidden text-ellipsis">
          {label}
        </span>
      )}
    </NavLink>
  );
}
