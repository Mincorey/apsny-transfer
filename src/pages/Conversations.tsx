import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MessageCircle, ArrowRight, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface ConvItem {
  id: string;
  other: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  };
  last_message: string | null;
  last_message_at: string | null;
  unreadCount: number;
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2);
}

function formatTime(ts: string): string {
  return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ru });
}

export function Conversations() {
  const [convs, setConvs] = useState<ConvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserId(user.id);
        fetchConversations(user.id);
      }
    });
  }, []);

  // Список переписок не требует мгновенности. Realtime убран ради лимита 200 одновременных
  // подключений Free-тарифа; список обновляется при заходе на страницу (эффект выше)
  // и при возврате на вкладку. Живой чат остаётся внутри открытого диалога (DirectChat.tsx).
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) fetchConversations(userId);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [userId]);

  const fetchConversations = async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id,
          last_message,
          last_message_at,
          user1_id,
          user2_id,
          user1:users!conversations_user1_id_fkey(id, full_name, avatar_url),
          user2:users!conversations_user2_id_fkey(id, full_name, avatar_url)
        `)
        .or(`user1_id.eq.${uid},user2_id.eq.${uid}`)
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      const items: ConvItem[] = (data || []).map((c: any) => {
        const other = c.user1_id === uid ? c.user2 : c.user1;
        return {
          id: c.id,
          other,
          last_message: c.last_message,
          last_message_at: c.last_message_at,
          unreadCount: 0,
        };
      });

      // Fetch unread counts for each conversation
      if (items.length > 0) {
        const convIds = items.map(i => i.id);
        const { data: unreadData } = await supabase
          .from('direct_messages')
          .select('conversation_id')
          .in('conversation_id', convIds)
          .eq('is_read', false)
          .neq('sender_id', uid);

        const unreadMap: Record<string, number> = {};
        (unreadData || []).forEach((m: { conversation_id: string }) => {
          unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] ?? 0) + 1;
        });

        items.forEach(item => {
          item.unreadCount = unreadMap[item.id] ?? 0;
        });
      }

      setConvs(items);
    } catch (e) {
      if (import.meta.env.DEV) console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-display font-bold mb-4">Личные сообщения</h1>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-panel rounded-2xl p-4 flex items-center gap-3 animate-pulse">
            <div className="w-11 h-11 rounded-full bg-surface-container-high" />
            <div className="flex-1 space-y-2">
              <div className="h-3 rounded bg-surface-container-high w-1/3" />
              <div className="h-3 rounded bg-surface-container w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-display font-bold">Личные сообщения</h1>

      {convs.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
        >
          <MessageCircle size={40} className="text-on-surface-variant opacity-40" />
          <div className="text-on-surface-variant text-sm">Нет личных переписок</div>
          <div className="text-xs text-outline">
            Напишите пользователю со страницы его профиля
          </div>
        </motion.div>
      ) : (
        <AnimatePresence initial={false}>
          {convs.map((conv, i) => (
            <motion.button
              key={conv.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => navigate(`/conversations/${conv.id}`)}
              className="w-full glass-panel rounded-2xl p-4 flex items-center gap-3 hover:bg-surface-container-high/50 transition-colors text-left"
            >
              <div className="relative shrink-0">
                {conv.other?.avatar_url ? (
                  <img
                    src={conv.other.avatar_url}
                    alt={conv.other.full_name}
                    loading="lazy"
                    decoding="async"
                    className="w-11 h-11 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant text-sm font-semibold">
                    {conv.other ? getInitials(conv.other.full_name) : <User size={18} />}
                  </div>
                )}
                {conv.unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-primary-container text-background text-[10px] font-bold flex items-center justify-center px-1">
                    {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-on-surface text-sm truncate">
                    {conv.other?.full_name ?? 'Пользователь'}
                  </span>
                  {conv.last_message_at && (
                    <span className="text-[10px] text-on-surface-variant shrink-0">
                      {formatTime(conv.last_message_at)}
                    </span>
                  )}
                </div>
                {conv.last_message ? (
                  <p className={`text-xs truncate mt-0.5 ${conv.unreadCount > 0 ? 'text-on-surface font-medium' : 'text-on-surface-variant'}`}>
                    {conv.last_message}
                  </p>
                ) : (
                  <p className="text-xs text-outline mt-0.5">Нет сообщений</p>
                )}
              </div>

              <ArrowRight size={16} className="text-on-surface-variant shrink-0" />
            </motion.button>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
