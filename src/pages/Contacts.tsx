import React, { useState } from 'react';
import { Mail, Send, CheckCircle, MessageCircle } from 'lucide-react';
import { InfoLayout, Section } from '../components/layout/InfoLayout';
import { supabase } from '../lib/supabase';
import { SITE, telegramUrl, mailtoUrl } from '../lib/siteInfo';

export function Contacts() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !message.trim()) {
      setError('Заполните имя и сообщение');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { error: insErr } = await supabase.from('contact_messages').insert({
        name: name.trim(),
        email: email.trim() || null,
        message: message.trim(),
      });
      if (insErr) throw insErr;
      setSent(true);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  }

  return (
    <InfoLayout title="Контакты" subtitle="Свяжитесь с нами любым удобным способом — мы на связи.">
      <Section title="Каналы связи">
        <div className="grid sm:grid-cols-2 gap-3">
          <a
            href={mailtoUrl}
            className="flex items-center gap-3 p-4 rounded-2xl glass-card hover:bg-white/5 transition-colors"
          >
            <Mail size={20} className="text-[#00f0ff] shrink-0" />
            <div>
              <div className="text-xs text-outline">Электронная почта</div>
              <div className="text-on-surface font-medium break-all">{SITE.email}</div>
            </div>
          </a>
          <a
            href={telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-2xl glass-card hover:bg-white/5 transition-colors"
          >
            <MessageCircle size={20} className="text-[#229ED9] shrink-0" />
            <div>
              <div className="text-xs text-outline">Telegram</div>
              <div className="text-on-surface font-medium">@{SITE.telegram}</div>
            </div>
          </a>
        </div>
        <p className="text-sm">
          Оператор сервиса: <span className="text-on-surface">{SITE.operatorName}</span>. Мы стараемся
          отвечать в течение одного рабочего дня.
        </p>
      </Section>

      <Section title="Форма обратной связи">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center glass-card rounded-2xl">
            <CheckCircle size={48} className="text-green-400" />
            <div className="text-lg font-bold text-on-surface">Сообщение отправлено</div>
            <div className="text-sm">Спасибо! Мы свяжемся с вами при необходимости.</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder="Ваше имя"
              maxLength={100}
              className="w-full px-4 py-3 rounded-xl input-glass text-sm"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email для ответа (необязательно)"
              maxLength={200}
              className="w-full px-4 py-3 rounded-xl input-glass text-sm"
            />
            <textarea
              value={message}
              onChange={(e) => { setMessage(e.target.value); setError(null); }}
              placeholder="Сообщение..."
              rows={5}
              maxLength={2000}
              className="w-full px-4 py-3 rounded-xl input-glass text-sm resize-none"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={sending}
              className="px-6 py-3 rounded-xl btn-mesh font-bold text-white flex items-center gap-2 disabled:opacity-50"
            >
              {sending ? (
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              ) : (
                <><Send size={15} /> Отправить</>
              )}
            </button>
          </form>
        )}
      </Section>
    </InfoLayout>
  );
}
