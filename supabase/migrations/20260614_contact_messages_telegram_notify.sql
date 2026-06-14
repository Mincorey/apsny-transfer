-- Доставка сообщений формы контактов (public.contact_messages) в Telegram-бот.
-- Секреты (telegram_bot_token, telegram_chat_id) хранятся в Supabase Vault,
-- в коде/репозитории их НЕТ. Установить их один раз вручную (psql / SQL editor):
--   select vault.create_secret('<BOT_TOKEN>', 'telegram_bot_token');
--   select vault.create_secret('<CHAT_ID>',  'telegram_chat_id');
-- Отправка асинхронная через pg_net (не блокирует INSERT формы).

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_contact_telegram()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
DECLARE
  v_token text;
  v_chat  text;
  v_text  text;
BEGIN
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'telegram_bot_token';
  SELECT decrypted_secret INTO v_chat  FROM vault.decrypted_secrets WHERE name = 'telegram_chat_id';

  -- Секреты ещё не настроены — тихо выходим, чтобы не ломать отправку формы.
  IF v_token IS NULL OR v_chat IS NULL THEN
    RETURN NEW;
  END IF;

  v_text :=
    '🆕 <b>Новое сообщение с сайта</b>' || E'\n' ||
    '<i>APSNY-TRANSFER · форма обратной связи</i>' || E'\n' ||
    '━━━━━━━━━━━━━━' || E'\n' ||
    '👤 <b>Имя:</b> ' || COALESCE(replace(replace(replace(NEW.name,    '&','&amp;'),'<','&lt;'),'>','&gt;'), '—') || E'\n' ||
    '✉️ <b>Email:</b> ' || COALESCE(replace(replace(replace(NEW.email,  '&','&amp;'),'<','&lt;'),'>','&gt;'), '— не указан') || E'\n' ||
    '🕒 <b>Время:</b> ' || to_char(NEW.created_at AT TIME ZONE 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') || ' (МСК)' || E'\n' ||
    '━━━━━━━━━━━━━━' || E'\n' ||
    '💬 <b>Сообщение:</b>' || E'\n' ||
    COALESCE(replace(replace(replace(NEW.message, '&','&amp;'),'<','&lt;'),'>','&gt;'), '—');

  PERFORM net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'chat_id', v_chat,
      'text', v_text,
      'parse_mode', 'HTML',
      'disable_web_page_preview', true
    )
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_contact_telegram() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_contact_telegram ON public.contact_messages;
CREATE TRIGGER trg_notify_contact_telegram
AFTER INSERT ON public.contact_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_contact_telegram();
