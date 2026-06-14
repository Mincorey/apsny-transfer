import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useParams, useNavigate } from 'react-router-dom';
import { Send, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '../context/ToastContext';

interface RideInfo {
  origin: string;
  destination: string;
  type: string;
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
  sender?: {
    full_name: string;
    avatar_url?: string;
  };
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2);
}

export function Chat() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rideInfo, setRideInfo] = useState<RideInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });

    if (rideId) {
      supabase
        .from('rides')
        .select('origin, destination, type')
        .eq('id', rideId)
        .single()
        .then(({ data }) => setRideInfo(data));

      fetchMessages();

      const channel = supabase
        .channel(`chat:${rideId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `ride_id=eq.${rideId}`,
        }, (payload) => {
          const newId = (payload.new as { id: string }).id;
          supabase
            .from('messages')
            .select('*, sender:users!messages_sender_id_fkey(full_name, avatar_url)')
            .eq('id', newId)
            .single()
            .then(({ data }) => {
              if (data) {
                setMessages(prev =>
                  prev.some(m => m.id === (data as Message).id)
                    ? prev
                    : [...prev, data as Message]
                );
              }
            });
        })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [rideId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mark received messages as read whenever chat is open and messages change
  useEffect(() => {
    if (!rideId || !currentUserId) return;
    supabase
      .from('messages')
      .update({ is_read: true })
      .eq('ride_id', rideId)
      .neq('sender_id', currentUserId)
      .eq('is_read', false)
      .then(() => {});
  }, [rideId, currentUserId, messages.length]);

  const fetchMessages = async () => {
    if (!rideId) return;
    const { data } = await supabase
      .from('messages')
      .select('*, sender:users!messages_sender_id_fkey(full_name, avatar_url)')
      .eq('ride_id', rideId)
      .order('created_at', { ascending: true });

    if (data) setMessages(data as any);
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!content.trim() || !currentUserId || !rideId) return;
    const text = content.trim();
    setContent('');
    const { error } = await supabase.from('messages').insert({
      ride_id: rideId,
      sender_id: currentUserId,
      content: text,
    });
    if (error) {
      setContent(text);
      showToast('error', 'Ошибка', 'Не удалось отправить сообщение');
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">

      {/* Header */}
      <div className="glass-panel p-4 mb-4 rounded-3xl flex items-center gap-4 shrink-0 border border-outline-variant/30">
        <button
          onClick={() => navigate('/messages')}
          className="p-2 hover:bg-surface-container rounded-full transition-colors shrink-0"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h2 className="font-bold text-lg truncate">
            {rideInfo ? `${rideInfo.origin} → ${rideInfo.destination}` : 'Загрузка...'}
          </h2>
          <p className="text-xs text-on-surface-variant uppercase tracking-widest">
            {rideInfo?.type === 'request' ? 'Запрос пассажира' : 'Предложение водителя'}
          </p>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 glass-card rounded-3xl mb-4 relative flex flex-col gap-3">
        <div className="absolute inset-0 bg-gradient-to-b from-surface-container/10 to-transparent pointer-events-none rounded-3xl" />

        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-on-surface-variant/40">Начните диалог</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m) => {
            const isMe = m.sender_id === currentUserId;
            const name = m.sender?.full_name || 'Пользователь';
            const avatar = m.sender?.avatar_url;

            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.18 }}
                className={`flex items-end gap-2 relative z-10 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {/* Avatar (others only) */}
                {!isMe && (
                  <div className="w-7 h-7 rounded-full bg-surface-container-high shrink-0 flex items-center justify-center text-[11px] font-bold text-primary-container overflow-hidden mb-5">
                    {avatar
                      ? <img src={avatar} alt={name} className="w-full h-full object-cover" />
                      : getInitials(name)
                    }
                  </div>
                )}

                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[76%] sm:max-w-[65%]`}>
                  {!isMe && (
                    <span className="text-[11px] text-on-surface-variant mb-1 px-1">{name}</span>
                  )}
                  <div className={`px-4 py-3 font-medium text-sm leading-relaxed ${
                    isMe
                      ? 'bg-gradient-to-br from-primary-container to-surface-tint text-on-primary-container rounded-3xl rounded-tr-sm shadow-[0_4px_24px_-4px_rgba(0,240,255,0.2)]'
                      : 'bg-surface-container-high border border-outline-variant/30 rounded-3xl rounded-tl-sm text-on-surface'
                  }`}>
                    {m.content}
                  </div>
                  <span className="text-[10px] text-on-surface-variant/40 mt-1 px-1">
                    {formatTime(m.created_at)}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={(e) => handleSend(e)} className="shrink-0 flex gap-3 relative z-10">
        <input
          type="text"
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          className="flex-1 input-glass rounded-2xl px-5 py-4 placeholder:text-outline shadow-lg bg-surface/50 backdrop-blur-xl border-white/10"
          placeholder="Написать сообщение..."
        />
        <button
          type="submit"
          disabled={!content.trim()}
          className="w-14 shrink-0 rounded-2xl btn-mesh flex items-center justify-center disabled:opacity-50 shadow-[0_0_20px_rgba(0,240,255,0.2)]"
        >
          <Send size={18} className="text-white" />
        </button>
      </form>
    </div>
  );
}
