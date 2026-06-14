-- Migration: фиксация realtime-публикации (аудит I2)
-- Дата: 2026-06-05
--
-- Проблема: подписки postgres_changes работают только если таблицы добавлены в
-- публикацию supabase_realtime. На боевой БД публикация была ПУСТА — значит
-- оставленный realtime (живая цена/статус аукциона и живые чаты) не транслировался.
-- Раньше это, видимо, настраивалось вручную в дашборде и не воспроизводилось.
--
-- Добавляем только те таблицы, что реально нужны оставшимся подпискам:
--   rides, bids        — страница активного аукциона (TripDetail)
--   messages           — групповой чат поездки (Chat)
--   direct_messages    — личные сообщения (DirectChat)
-- notifications/conversations/messages-список переведены на опрос — не добавляем.
--
-- Идемпотентно: добавляем таблицу только если её ещё нет в публикации.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rides','bids','messages','direct_messages'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
