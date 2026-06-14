import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { NavLink } from 'react-router-dom';
import { MessageSquare, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ConvRide {
  id: string;
  origin: string;
  destination: string;
  type: string;
  created_at: string;
  lastMessage?: string;
  lastMessageAt?: string;
  lastMessageSenderId?: string;
  unreadCount: number;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Вчера';
  if (diffDays < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function Messages() {
  const [rides, setRides] = useState<ConvRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserId(user.id);
        fetchChats(user.id);
      }
    });
  }, []);

  // Список чатов не требует мгновенности. Realtime убран ради лимита 200 одновременных
  // подключений Free-тарифа; список обновляется при заходе на страницу (эффект выше)
  // и при возврате на вкладку. Живой чат остаётся внутри открытого диалога (Chat.tsx).
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) fetchChats(userId);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [userId]);

  const fetchChats = async (uid: string) => {
    try {
      // Get rides where user is creator
      const { data: myRides } = await supabase
        .from('rides')
        .select('id, origin, destination, type, created_at')
        .eq('creator_id', uid);

      // Get rides where user has placed bids
      const { data: myBids } = await supabase
        .from('bids')
        .select('ride_id')
        .eq('bidder_id', uid);

      const bidRideIds = myBids?.map(b => b.ride_id) || [];
      let bidRides: any[] = [];
      if (bidRideIds.length > 0) {
        const { data } = await supabase
          .from('rides')
          .select('id, origin, destination, type, created_at')
          .in('id', bidRideIds);
        if (data) bidRides = data;
      }

      const all = [...(myRides || []), ...bidRides];
      const uniqueRides = Array.from(new Map(all.map(r => [r.id, r])).values()) as any[];

      if (uniqueRides.length === 0) {
        setRides([]);
        setLoading(false);
        return;
      }

      const rideIds = uniqueRides.map(r => r.id);

      // Load all messages for these rides in one query (newest first)
      const { data: allMessages } = await supabase
        .from('messages')
        .select('id, ride_id, sender_id, content, created_at, is_read')
        .in('ride_id', rideIds)
        .order('created_at', { ascending: false });

      // Build per-ride conversation summary
      const convMap: Record<string, { lastMessage: string; lastMessageAt: string; lastMessageSenderId: string; unreadCount: number }> = {};

      (allMessages || []).forEach(msg => {
        if (!convMap[msg.ride_id]) {
          // First (= newest) message for this ride
          convMap[msg.ride_id] = {
            lastMessage: msg.content,
            lastMessageAt: msg.created_at,
            lastMessageSenderId: msg.sender_id,
            unreadCount: 0,
          };
        }
        if (!msg.is_read && msg.sender_id !== uid) {
          convMap[msg.ride_id].unreadCount++;
        }
      });

      const enriched: ConvRide[] = uniqueRides.map(ride => ({
        ...ride,
        lastMessage: convMap[ride.id]?.lastMessage,
        lastMessageAt: convMap[ride.id]?.lastMessageAt,
        lastMessageSenderId: convMap[ride.id]?.lastMessageSenderId,
        unreadCount: convMap[ride.id]?.unreadCount || 0,
      }));

      enriched.sort((a, b) => {
        const tA = a.lastMessageAt || a.created_at;
        const tB = b.lastMessageAt || b.created_at;
        return new Date(tB).getTime() - new Date(tA).getTime();
      });

      setRides(enriched);
    } catch (e) {
      if (import.meta.env.DEV) console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const totalUnread = rides.reduce((sum, r) => sum + r.unreadCount, 0);

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="w-8 h-8 animate-spin border-4 border-primary-container border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-display font-bold">Сообщения</h1>
        {totalUnread > 0 && (
          <span className="px-2.5 py-0.5 rounded-full bg-primary-container text-on-primary-container text-sm font-bold">
            {totalUnread}
          </span>
        )}
      </div>

      {rides.length === 0 ? (
        <div className="glass-panel p-12 text-center rounded-3xl text-on-surface-variant flex flex-col items-center gap-4">
          <MessageSquare size={48} className="opacity-20" />
          <p>У вас пока нет активных чатов.<br />Создайте поездку или сделайте ставку.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence>
            {rides.map((ride, i) => (
              <motion.div
                key={ride.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <NavLink to={`/messages/${ride.id}`}>
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    className={`glass-card p-4 rounded-2xl transition-colors md:flex md:items-center md:gap-4 flex flex-col gap-3 ${
                      ride.unreadCount > 0 ? 'border-2 border-primary-container' : 'border border-transparent'
                    }`}
                  >
                    {/* Mobile: Row 1 - Route info */}
                    <div className="flex md:hidden items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="font-bold text-sm truncate">{ride.origin}</span>
                        <ArrowRight size={12} className="text-on-surface-variant shrink-0" />
                        <span className="font-bold text-sm truncate">{ride.destination}</span>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-on-surface-variant/60 font-medium whitespace-nowrap">
                        {ride.type === 'request' ? 'Пассажир' : 'Водитель'}
                      </span>
                    </div>

                    {/* Mobile: Row 2 - Last message */}
                    <div className="flex md:hidden gap-2 items-start">
                      <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary-container shrink-0">
                        <MessageSquare size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        {ride.lastMessage ? (
                          <p className={`text-sm line-clamp-2 ${
                            ride.unreadCount > 0 ? 'text-on-surface font-semibold' : 'text-on-surface-variant'
                          }`}>
                            {ride.lastMessageSenderId === userId ? 'Вы: ' : ''}
                            {ride.lastMessage}
                          </p>
                        ) : (
                          <p className="text-sm text-on-surface-variant/50 italic">Нет сообщений</p>
                        )}
                      </div>
                    </div>

                    {/* Mobile: Row 3 - Time and badge */}
                    <div className="flex md:hidden justify-between items-center text-xs">
                      {ride.lastMessageAt && (
                        <span className="text-on-surface-variant">
                          {formatTime(ride.lastMessageAt)}
                        </span>
                      )}
                      {ride.unreadCount > 0 && (
                        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary-container text-on-primary-container text-[11px] font-bold flex items-center justify-center">
                          {ride.unreadCount > 9 ? '9+' : ride.unreadCount}
                        </span>
                      )}
                    </div>

                    {/* Desktop layout */}
                    <div className="hidden md:flex items-center gap-4 w-full">
                      {/* Route icon */}
                      <div className="w-11 h-11 rounded-full bg-surface-container-high flex items-center justify-center text-primary-container shrink-0">
                        <MessageSquare size={20} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm">{ride.origin}</span>
                          <ArrowRight size={12} className="text-on-surface-variant shrink-0" />
                          <span className="font-bold text-sm">{ride.destination}</span>
                          <span className="ml-1 text-[10px] uppercase tracking-wider text-on-surface-variant/60 font-medium">
                            {ride.type === 'request' ? '· Пассажир' : '· Водитель'}
                          </span>
                        </div>

                        {ride.lastMessage ? (
                          <p className={`text-sm truncate mt-0.5 ${
                            ride.unreadCount > 0 ? 'text-on-surface font-semibold' : 'text-on-surface-variant'
                          }`}>
                            {ride.lastMessageSenderId === userId ? 'Вы: ' : ''}
                            {ride.lastMessage}
                          </p>
                        ) : (
                          <p className="text-sm text-on-surface-variant/50 mt-0.5 italic">Нет сообщений</p>
                        )}
                      </div>

                      {/* Right: time + unread badge */}
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {ride.lastMessageAt && (
                          <span className="text-xs text-on-surface-variant">
                            {formatTime(ride.lastMessageAt)}
                          </span>
                        )}
                        {ride.unreadCount > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary-container text-on-primary-container text-[11px] font-bold flex items-center justify-center">
                            {ride.unreadCount > 9 ? '9+' : ride.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                </NavLink>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
