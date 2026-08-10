-- ============================================================
-- 20260810_fix_1_3_cancel_ride_owner_check.sql
--
-- Закрывает пункт 1.3 аудита AUDIT_2026-08-10.md:
-- «Любой авторизованный может отменить ЧУЖУЮ поездку».
--
-- ПРОБЛЕМА
-- --------
-- В теле public.cancel_ride(uuid) не было ни одной проверки прав: функция
-- находила поездку, убеждалась что та активна, и отменяла её. При этом
-- функция объявлена SECURITY DEFINER, то есть выполняется от имени владельца
-- базы, и RLS её не ограничивает, а EXECUTE выдан роли authenticated.
--
-- Итог: любой вошедший пользователь мог отменить любую чужую поездку, зная
-- только её id — а все id видны в ленте. Скрипт в цикле по ленте кладёт весь
-- сервис: все активные аукционы отменяются, всем участникам торгов уходят
-- уведомления «Поездка отменена».
--
-- Подтверждено тестом на боевой базе (в транзакции с откатом): вызов
-- cancel_ride на чужую активную поездку возвращал {"success": true,
-- "status": "cancelled"}, статус поездки фактически менялся на cancelled.
--
-- РЕШЕНИЕ
-- -------
-- Добавлены две проверки перед отменой:
--   1. v_uid IS NULL  → 'Требуется авторизация';
--   2. creator_id <> v_uid → 'Отменить поездку может только её создатель'.
--
-- Почему проверка на NULL обязательна, хотя в патче аудита её не было:
-- в SQL сравнение с NULL даёт не FALSE, а NULL, и конструкция
-- IF creator_id <> auth.uid() THEN ... при auth.uid() = NULL не срабатывает —
-- защита молча пропускает вызов. Проверено запросом: результат сравнения
-- uuid <> NULL равен NULL, ветка IF не выполняется. Сейчас EXECUTE выдан
-- только роли authenticated, но полагаться на это одно — хрупко.
--
-- Порядок проверок выбран такой: сначала авторизация, потом существование
-- поездки, потом владелец, и только потом статус. Так чужому пользователю
-- не сообщается статус чужой поездки — он получает отказ по праву доступа.
--
-- Остальное тело функции не изменилось: та же блокировка FOR UPDATE, та же
-- рассылка уведомлений участникам ставок, тот же формат ответа.
-- Фронтенд менять не требуется — TripDetail.handleCancelRide уже показывает
-- текст серверной ошибки пользователю через errorMsg.
--
-- Для сравнения: «правильный» аналог close_auction_early такую проверку
-- всегда имел — тем заметнее был пробел здесь.
--
-- ОТКАТ
-- -----
-- Вернуть прежнее тело функции без проверок (делать не следует).
--
-- Миграция идемпотентна: create or replace.
-- ============================================================

begin;

create or replace function public.cancel_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
    v_ride RECORD;
    v_uid  uuid := auth.uid();
BEGIN
    -- Без этой проверки сравнение creator_id <> NULL даёт NULL,
    -- и проверка владельца ниже молча пропустит вызов.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация';
    END IF;

    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.creator_id <> v_uid THEN
        RAISE EXCEPTION 'Отменить поездку может только её создатель';
    END IF;

    IF v_ride.status != 'active' THEN
        RAISE EXCEPTION 'Можно отменить только активные поездки';
    END IF;

    UPDATE public.rides
    SET status = 'cancelled', cancelled_at = now()
    WHERE id = p_ride_id;

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    SELECT DISTINCT bidder_id, 'ride_cancelled', 'Поездка отменена', NULL, p_ride_id
    FROM public.bids
    WHERE ride_id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END;
$function$;

revoke all on function public.cancel_ride(uuid) from public, anon;
grant execute on function public.cancel_ride(uuid) to authenticated;

commit;
