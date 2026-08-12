import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * Счётчики для значков в меню: непрочитанные уведомления и точка на «Поездках»
 * о выигранном аукционе.
 *
 * Зачем отдельный контекст. Раньше счётчик жил внутри MainLayout и приезжал
 * в меню пропсами. Но карточка поездки (`/trips/:id`) и страницы вроде
 * «О проекте» объявлены отдельными маршрутами вне MainLayout и рисуют TopNav
 * сами — пропсов им никто не передавал, и значок там просто пропадал. Карточка
 * поездки — самая посещаемая страница сервиса, и именно на ней человек не
 * видел, что ему что-то пришло.
 *
 * Провайдер стоит выше маршрутов, поэтому счётчик один на всё приложение
 * и одинаков на любой странице. Пересчёт — при каждом переходе: страница
 * уведомлений гасит записи, и сюда приходит уже честный итог.
 */

interface NotificationBadges {
  unreadNotifications: number;
  hasUnreadWon: boolean;
  /** Прибавить непрочитанное, когда опрос принёс новое уведомление. */
  bumpUnread: () => void;
  setHasUnreadWon: (v: boolean) => void;
  refresh: () => void;
}

const Ctx = createContext<NotificationBadges>({
  unreadNotifications: 0,
  hasUnreadWon: false,
  bumpUnread: () => {},
  setHasUnreadWon: () => {},
  refresh: () => {},
});

export function useNotificationBadges(): NotificationBadges {
  return useContext(Ctx);
}

export function NotificationBadgeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [hasUnreadWon, setHasUnreadWon] = useState(false);

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setUnreadNotifications(0);
      setHasUnreadWon(false);
      return;
    }
    const [{ count: total }, { count: won }] = await Promise.all([
      supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('is_read', false),
      supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('type', 'auction_won')
        .eq('is_read', false),
    ]);
    setUnreadNotifications(total ?? 0);
    setHasUnreadWon((won ?? 0) > 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => { cancelled = true; };
  }, [location.pathname, refresh]);

  const bumpUnread = useCallback(() => setUnreadNotifications((c) => c + 1), []);

  const value = useMemo(
    () => ({ unreadNotifications, hasUnreadWon, bumpUnread, setHasUnreadWon, refresh }),
    [unreadNotifications, hasUnreadWon, bumpUnread, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
