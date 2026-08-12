import React, { useState } from 'react';
import { Mail, Send, CheckCircle } from 'lucide-react';
import { InfoLayout, Section } from '../components/layout/InfoLayout';
import { supabase } from '../lib/supabase';
import { SITE, mailtoUrl } from '../lib/siteInfo';

export function Contacts() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  // Ловушка для ботов: настоящий посетитель это поле не видит и не заполняет.
  // Простые боты, автозаполняющие все поля формы, впишут туда что-нибудь —
  // такие сообщения база отклоняет (см. supabase/migrations/20260810_fix_3_4_contact_rate_limit.sql).
  const [website, setWebsite] = useState('');
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
        website: website.trim() || null,
      });
      if (insErr) throw insErr;
      setSent(true);
    } catch (err: any) {
      // Сообщения о превышении лимита (см. миграцию) уже написаны по-русски
      // и понятны как есть; для прочих ошибок — общий текст.
      const raw = err?.message ?? '';
      setError(
        /слишком много сообщений|форма временно перегружена/i.test(raw)
          ? raw
          : 'Не удалось отправить сообщение. Попробуйте ещё раз чуть позже.'
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <InfoLayout title="Контакты" subtitle="Свяжитесь с нами любым удобным способом — мы на связи.">
      <Section title="Каналы связи">
        <div className="grid gap-3">
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
        </div>
        <p className="text-sm">
          Это основной канал связи с поддержкой сервиса по любым вопросам — регистрация,
          оплата, возвраты, обработка персональных данных. Мы стараемся отвечать в течение
          одного рабочего дня.
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
              aria-label="Ваше имя"
              autoComplete="name"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder="Ваше имя"
              maxLength={100}
              className="w-full px-4 py-3 rounded-xl input-glass text-sm"
            />
            <input
              type="email"
              aria-label="Email для ответа, необязательно"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email для ответа (необязательно)"
              maxLength={200}
              className="w-full px-4 py-3 rounded-xl input-glass text-sm"
            />
            <textarea
              aria-label="Текст сообщения"
              value={message}
              onChange={(e) => { setMessage(e.target.value); setError(null); }}
              placeholder="Сообщение..."
              rows={5}
              maxLength={2000}
              className="w-full px-4 py-3 rounded-xl input-glass text-sm resize-none"
            />
            {/* Honeypot: скрыто от людей, видно только автозаполняющим ботам. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
              <label htmlFor="website">Оставьте это поле пустым</label>
              <input
                id="website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
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
