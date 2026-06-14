import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Send, ArrowLeft, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DirectMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
}

interface OtherUser {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2);
}

export function DirectChat() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [content, setContent] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUser, setOtherUser] = useState<OtherUser | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    fetchConversationInfo();
    fetchMessages();
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !currentUserId) return;
    markAsRead();

    const channel = supabase
      .channel(`direct-chat-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as DirectMessage]);
        if ((payload.new as DirectMessage).sender_id !== currentUserId) {
          markAsRead();
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, currentUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversationInfo = async () => {
    const { data } = await supabase
      .from('conversations')
      .select(`
        user1_id, user2_id,
        user1:users!conversations_user1_id_fkey(id, full_name, avatar_url),
        user2:users!conversations_user2_id_fkey(id, full_name, avatar_url)
      `)
      .eq('id', conversationId!)
      .single();

    if (!data) return;
    const { data: { user } } = await supabase.auth.getUser();
    const uid = user?.id;
    const other = (data as any).user1_id === uid ? (data as any).user2 : (data as any).user1;
    setOtherUser(other);
  };

  const fetchMessages = async () => {
    const { data } = await supabase
      .from('direct_messages')
      .select('*')
      .eq('conversation_id', conversationId!)
      .order('created_at', { ascending: true });
    setMessages((data as DirectMessage[]) || []);
  };

  const markAsRead = async () => {
    if (!currentUserId) return;
    await supabase
      .from('direct_messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId!)
      .neq('sender_id', currentUserId)
      .eq('is_read', false);
  };

  const sendMessage = async () => {
    const text = content.trim();
    if (!text || !currentUserId || sending) return;
    setSending(true);
    setContent('');

    const { error } = await supabase
      .from('direct_messages')
      .insert({ conversation_id: conversationId!, sender_id: currentUserId, content: text });

    if (!error) {
      await supabase
        .from('conversations')
        .update({ last_message: text, last_message_at: new Date().toISOString() })
        .eq('id', conversationId!);
    }
    setSending(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-outline-variant/30">
        <button
          onClick={() => navigate('/conversations')}
          className="p-2 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        {otherUser?.avatar_url ? (
          <img src={otherUser.avatar_url} alt={otherUser.full_name} className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant text-sm font-semibold shrink-0">
            {otherUser ? getInitials(otherUser.full_name) : <User size={16} />}
          </div>
        )}
        <div>
          <div className="font-semibold text-on-surface text-sm">{otherUser?.full_name ?? '...'}</div>
          <div className="text-xs text-on-surface-variant">Личные сообщения</div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            const isMe = msg.sender_id === currentUserId;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.18 }}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    isMe
                      ? 'bg-[#00f0ff]/20 border border-[#00f0ff]/40 text-on-surface rounded-br-sm'
                      : 'bg-surface-container-high/80 border border-outline-variant/40 text-on-surface rounded-bl-sm'
                  }`}
                >
                  <p>{msg.content}</p>
                  <span className={`text-[10px] mt-1 block ${isMe ? 'text-primary-container/60 text-right' : 'text-on-surface-variant'}`}>
                    {formatTime(msg.created_at)}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Сообщение..."
          className="flex-1 input-glass rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline"
        />
        <button
          onClick={sendMessage}
          disabled={!content.trim() || sending}
          className="p-3 rounded-xl bg-primary-container/20 border border-primary-container/30 text-primary-container hover:bg-primary-container/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
