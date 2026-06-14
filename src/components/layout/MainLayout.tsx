import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { TopNav } from './TopNav';
import { BottomNav } from './BottomNav';
import { Footer } from './Footer';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import type { NotificationType } from '../../lib/supabase';

const toastTypeMap: Record<NotificationType, 'bid' | 'won' | 'info' | 'success' | 'error'> = {
  new_bid:        'bid',
  auction_won:    'won',
  auction_lost:   'error',
  new_message:    'info',
  ride_cancelled: 'error',
  review_received:'success',
};

// Free-тариф Supabase: realtime-подключения дефицитны (лимит 200 одновременных).
// Новые уведомления опрашиваются REST-запросом, а не постоянной realtime-подпиской,
// поэтому лимит 200 больше не привязан к числу пользователей онлайн.
const NOTIF_POLL_INTERVAL_MS = 20_000; // опрос раз в 20 секунд

export function MainLayout() {
  const { showToast } = useToast();
  const location = useLocation();
  const unreadCount = useUnreadCount();
  const [hasUnreadWon, setHasUnreadWon] = useState(false);

  // Check for unread auction_won notifications on mount
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('type', 'auction_won')
        .eq('is_read', false);
      if ((count ?? 0) > 0) setHasUnreadWon(true);
    });
  }, []);

  // Clear dot and mark as read when user opens My Trips
  useEffect(() => {
    if (location.pathname !== '/my-trips') return;
    if (!hasUnreadWon) return;
    setHasUnreadWon(false);
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', session.user.id)
        .eq('type', 'auction_won')
        .eq('is_read', false);
    });
  }, [location.pathname, hasUnreadWon]);

  // Опрос новых уведомлений (замена постоянной realtime-подписки).
  // Тостим только уведомления, появившиеся ПОСЛЕ загрузки страницы; исторические
  // непрочитанные auction_won обрабатываются точкой-индикатором (эффект выше).
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let uid: string | null = null;
    let since = new Date().toISOString();

    const poll = async () => {
      if (cancelled || !uid) return;
      // Не опрашиваем, пока вкладка скрыта — экономим запросы.
      if (typeof document !== 'undefined' && document.hidden) return;
      const { data } = await supabase
        .from('notifications')
        .select('type, title, body, created_at')
        .eq('user_id', uid)
        .gt('created_at', since)
        .order('created_at', { ascending: true });
      if (cancelled || !data || data.length === 0) return;
      for (const n of data as { type: NotificationType; title: string; body?: string | null; created_at: string }[]) {
        showToast(toastTypeMap[n.type] ?? 'info', n.title, n.body ?? undefined);
        if (n.type === 'auction_won') setHasUnreadWon(true);
      }
      since = data[data.length - 1].created_at;
    };

    // Мгновенно догоняем уведомления при возврате на вкладку.
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) poll();
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session?.user) return;
      uid = session.user.id;
      intervalId = setInterval(poll, NOTIF_POLL_INTERVAL_MS);
      document.addEventListener('visibilitychange', onVisibility);
    });

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [showToast]);

  return (
    <div className="h-screen overflow-hidden bg-background">
      <TopNav unreadCount={unreadCount} hasUnreadWon={hasUnreadWon} />

      <main className="h-full overflow-y-auto w-full md:pt-16">
        <div className="max-w-4xl mx-auto w-full md:p-8 p-4 pb-32 md:pb-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeInOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
        <Footer />
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50">
        <BottomNav unreadCount={unreadCount} hasUnreadWon={hasUnreadWon} />
      </div>
    </div>
  );
}
