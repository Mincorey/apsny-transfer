-- Таблица для формы обратной связи (страница «Контакты»).
-- Любой посетитель (anon) может отправить сообщение; читать может только владелец
-- БД (через дашборд). Клиентам SELECT/UPDATE/DELETE запрещены.
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id         uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  name       text NOT NULL,
  email      text,
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_insert_any ON public.contact_messages;
CREATE POLICY contact_insert_any ON public.contact_messages
  FOR INSERT
  WITH CHECK (
    length(btrim(name)) BETWEEN 1 AND 100
    AND length(btrim(message)) BETWEEN 1 AND 2000
    AND (email IS NULL OR length(email) <= 200)
  );

REVOKE ALL ON public.contact_messages FROM anon, authenticated;
GRANT INSERT ON public.contact_messages TO anon, authenticated;
