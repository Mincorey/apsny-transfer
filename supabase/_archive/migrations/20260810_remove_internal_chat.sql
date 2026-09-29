-- ============================================================
-- 20260810_remove_internal_chat.sql
--
-- Полное удаление внутреннего чата из проекта.
--
-- ЗАЧЕМ
-- -----
-- Проект переезжает на арендованный VDS, и всё, что не нужно, должно исчезнуть
-- до переезда, а не после. Чат в проекте фактически не использовался: на момент
-- удаления в messages было 0 строк, в direct_messages 0, в conversations 1.
--
-- Честно про экономию: сами таблицы занимали около 232 КБ, на стоимость сервера
-- это не влияет никак. Реальная нагрузка была в другом:
--   • хук useUnreadCount опрашивал базу каждые 30 секунд у КАЖДОГО открытого
--     клиента, и на каждый опрос приходилось три запроса (rides, bids, messages);
--   • страницы чатов держали постоянные realtime-подписки на messages и
--     direct_messages, а realtime-подключения — самый дефицитный ресурс.
-- Вот это удаление и снимает.
--
-- ПОБОЧНЫЙ ЭФФЕКТ: ЗАКРЫТ ПУНКТ 2.4 АУДИТА
-- ----------------------------------------
-- Пункт 2.4 «Можно редактировать чужие сообщения в переписке» закрыт
-- автоматически — политики msg_update_participant и dm_update_participant
-- удалены вместе с таблицами. Править больше нечего.
--
-- ЧТО УДАЛЕНО
-- -----------
--   таблицы:  messages, direct_messages, conversations (со всеми политиками,
--             индексами и внешними ключами — через CASCADE);
--   функции:  get_or_create_conversation, cleanup_old_completed_messages;
--   тип уведомления new_message убран из списка допустимых.
--
-- ВАЖНО: RETENTION-ОЧИСТКА
-- ------------------------
-- Функция run_retention_cleanup (cron jobid 7, ежедневно в 3:00) вызывала
-- cleanup_old_completed_messages. Если удалить таблицы, не тронув её, задача
-- падала бы каждую ночь. Поэтому функция переписана без этого вызова —
-- ПЕРЕД удалением. Проверено запуском после удаления: отрабатывает.
--
-- ВАЖНО: REALTIME-ПУБЛИКАЦИЯ
-- --------------------------
-- Таблицы messages и direct_messages были добавлены в публикацию
-- supabase_realtime миграцией 20260605_realtime_publication.sql. Они убраны
-- из публикации явно, до DROP. В публикации остаются rides и bids —
-- живая цена и статус аукциона на странице поездки.
--
-- ЧТО ВЗАМЕН
-- ----------
-- Связь между участниками после аукциона — через контакты, которые
-- открываются создателю и победителю в get_trip_view. Сейчас это только
-- Telegram: телефон, WhatsApp и MAX скрыты от всех миграцией
-- 20260622_platega_free_publish_and_hide_contacts.sql (требование модерации
-- Platega). При переходе на ЮMoney это ограничение теряет смысл — вопрос
-- возврата телефона решается отдельно, вместе с пунктом 2.2 аудита.
--
-- ПОРЯДОК ВЫКАТА
-- --------------
-- Сначала выкатить фронтенд без чата, потом применить эту миграцию. Если
-- применить наоборот, старая версия сайта на разделе «Сообщения» будет
-- выдавать ошибки. Данных в чате нет, поэтому цена ошибки невелика,
-- но порядок лучше соблюсти.
--
-- ОТКАТ
-- -----
-- Отката нет: таблицы удаляются вместе со структурой. Восстановление —
-- только из резервной копии базы. Перед применением убедитесь, что
-- переписка действительно не нужна.
-- ============================================================

begin;

-- 1) Убрать таблицы из realtime-публикации ДО удаления.
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime drop table public.messages;
  end if;
  if exists (select 1 from pg_publication_tables
             where pubname='supabase_realtime' and schemaname='public' and tablename='direct_messages') then
    alter publication supabase_realtime drop table public.direct_messages;
  end if;
end $$;

-- 2) Переписать retention-очистку БЕЗ вызова функции чата.
--    Обязательно до DROP, иначе ночной cron начнёт падать.
create or replace function public.run_retention_cleanup()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
BEGIN
    PERFORM cleanup_old_notifications();
    PERFORM cleanup_old_cancelled_rides();
    -- cleanup_old_completed_messages удалена вместе с чатом (10.08.2026)
END;
$$;

-- 3) Удалить функции чата.
drop function if exists public.cleanup_old_completed_messages();
drop function if exists public.get_or_create_conversation(uuid, uuid);

-- 4) Удалить таблицы. CASCADE снимает политики, индексы и внешние ключи.
--    Порядок: сначала зависимая direct_messages, затем conversations.
drop table if exists public.direct_messages cascade;
drop table if exists public.conversations   cascade;
drop table if exists public.messages        cascade;

-- 5) Убрать new_message из допустимых типов уведомлений.
--    Проверено: строк с таким типом в notifications нет.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['new_bid','auction_won','auction_lost','ride_cancelled','review_received']));

commit;
