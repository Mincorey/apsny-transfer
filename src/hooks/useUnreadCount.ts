import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Free-тариф Supabase: realtime-подключения дефицитны (лимит 200 одновременных),
// а REST-запросы безлимитны. Поэтому счётчик непрочитанных считается опросом,
// а не постоянной realtime-подпиской на всю таблицу messages.
const POLL_INTERVAL_MS = 30_000; // опрос раз в 30 секунд

export function useUnreadCount(): number {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async (uid: string, rideIds: string[]) => {
    if (rideIds.length === 0) { setCount(0); return; }
    const { count: c } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .in('ride_id', rideIds)
      .eq('is_read', false)
      .neq('sender_id', uid);
    setCount(c ?? 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let uid: string | null = null;
    let rideIds: string[] = [];

    const tick = () => {
      if (cancelled || !uid) return;
      // Не опрашиваем, пока вкладка скрыта — экономим запросы.
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchCount(uid, rideIds);
    };

    // Мгновенно обновляем счётчик при возврате на вкладку.
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) tick();
    };

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled || !session?.user) return;
      uid = session.user.id;

      const [{ data: myRides }, { data: myBids }] = await Promise.all([
        supabase.from('rides').select('id').eq('creator_id', uid),
        supabase.from('bids').select('ride_id').eq('bidder_id', uid),
      ]);
      if (cancelled) return;

      rideIds = [...new Set([
        ...(myRides?.map((r: { id: string }) => r.id) ?? []),
        ...(myBids?.map((b: { ride_id: string }) => b.ride_id) ?? []),
      ])];

      await fetchCount(uid, rideIds);

      intervalId = setInterval(tick, POLL_INTERVAL_MS);
      document.addEventListener('visibilitychange', onVisibility);
    });

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchCount]);

  return count;
}
