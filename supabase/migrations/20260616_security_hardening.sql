-- ============================================================
-- 20260616_security_hardening.sql
-- Ужесточение доступа к функциям после аудита (Supabase advisors).
--
-- Причина: Supabase по умолчанию выдаёт EXECUTE на новые функции в схеме public
-- ролям anon и authenticated. Для серверных/служебных функций это опасно —
-- например, publish_ride_paid (помечает оплату и публикует поездку) могла быть
-- вызвана залогиненным пользователем напрямую в обход оплаты, а tg_notify —
-- кем угодно для спама в Telegram. Здесь явно отзываем лишние права.
-- Идемпотентно, безопасно применять повторно.
-- ============================================================

-- Только сервер (service_role) и cron — никаким клиентским ролям нельзя.
revoke execute on function public.publish_ride_paid(text, text, numeric, jsonb) from anon, authenticated;
revoke execute on function public.tg_notify(text) from anon, authenticated;
revoke execute on function public.cleanup_unpaid_drafts() from anon, authenticated;

-- Клиентские RPC: оставляем authenticated (внутри есть проверка auth.uid()),
-- убираем ненужный доступ anon.
revoke execute on function public.start_ride_payment(uuid) from anon;
revoke execute on function public.get_ride_receipt(uuid)   from anon;
revoke execute on function public.delete_unpaid_draft(uuid) from anon;

-- Триггерная функция: фиксируем search_path (advisor 0011 function_search_path_mutable).
alter function public.force_ride_draft() set search_path = public;

-- Производительность: индекс на внешний ключ payments.user_id (advisor 0001).
create index if not exists idx_payments_user on public.payments(user_id);
