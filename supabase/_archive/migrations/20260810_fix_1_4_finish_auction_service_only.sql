-- ============================================================
-- 20260810_fix_1_4_finish_auction_service_only.sql
--
-- Закрывает пункт 1.4 аудита AUDIT_2026-08-10.md:
-- «Любой авторизованный может досрочно закрыть ЧУЖОЙ аукцион».
--
-- ПРОБЛЕМА
-- --------
-- public.finish_auction(uuid) задумана как служебная — её дёргают cron-задачи
-- и get_trip_view при открытии страницы истёкшей поездки. Но EXECUTE был выдан
-- роли authenticated, а внутри функции не проверялось ни кто вызывает, ни
-- истёк ли вообще срок аукциона. Она просто закрывала торги и объявляла
-- победителем автора последней по времени ставки.
--
-- Схема злоупотребления: сделал ставку → сразу вызвал finish_auction →
-- выиграл аукцион по своей же цене, не дав другим перебить. Работало и на
-- чужих поездках: достаточно знать id, а все id видны в ленте.
--
-- Подтверждено тестом на боевой базе (в транзакции с откатом): вызов
-- finish_auction на чужой ИДУЩИЙ аукцион вернул {"success": true,
-- "status": "booked", "winner_id": <вызывающий>} — поездка реально перешла
-- в booked с назначенным победителем.
--
-- РЕШЕНИЕ — два независимых рубежа
-- --------------------------------
-- 1. Отозвать EXECUTE у anon, authenticated и PUBLIC. Функция остаётся
--    доступной postgres и service_role — этого достаточно:
--      • cron-задачи (jobid 1 и 3) выполняются от имени postgres;
--      • close_expired_auctions, process_expired_auctions и get_trip_view
--        объявлены SECURITY DEFINER с владельцем postgres, поэтому вложенный
--        вызов finish_auction идёт от владельца и прав вызывающего не требует.
--    Проверено: фронтенд finish_auction напрямую не вызывает вообще.
--
-- 2. Добавить внутрь функции проверку, что срок аукциона действительно истёк.
--    Это второй рубеж на случай, если EXECUTE когда-нибудь выдадут заново —
--    ровно такая регрессия уже случалась с политикой rides_update_own
--    (её удалили в мае и вернули в июне, см. миграцию 20260810_fix_1_1).
--    Проверка безопасна для всех трёх легальных вызывающих: оба cron-обхода
--    отбирают поездки условием auction_end_time < now(), get_trip_view
--    вызывает функцию по тому же условию. А close_auction_early — легальное
--    досрочное закрытие владельцем — finish_auction не вызывает вообще,
--    он делает всю работу сам и свою проверку владельца имеет.
--
--    Возвращается не исключение, а {"success": false,
--    "reason": "auction_not_expired"} — чтобы не рвать цикл в cron-обходах,
--    по аналогии с уже существующим ответом "not_active".
--
-- ЧЕГО ЭТА МИГРАЦИЯ НЕ КАСАЕТСЯ
-- -----------------------------
-- Победитель по-прежнему определяется как автор ПОСЛЕДНЕЙ по времени ставки,
-- а не лучшей по цене. Это отдельная проблема — она разбирается в пункте 2.3
-- аудита (ставку можно записать в таблицу bids напрямую, минуя place_bid,
-- и тем самым стать «последним»). Здесь логика выбора победителя намеренно
-- оставлена без изменений, чтобы патч оставался узким.
--
-- ОТКАТ
-- -----
--   GRANT EXECUTE ON FUNCTION public.finish_auction(uuid) TO authenticated;
-- (делать не следует)
--
-- Миграция идемпотентна: create or replace + revoke.
-- ============================================================

begin;

create or replace function public.finish_auction(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
    v_ride   RECORD;
    v_winner UUID;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND OR v_ride.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'not_active');
    END IF;

    -- Второй рубеж: закрывать можно только уже истёкший аукцион.
    -- Легальное досрочное закрытие владельцем идёт через close_auction_early,
    -- который эту функцию не вызывает.
    IF v_ride.auction_end_time IS NULL OR v_ride.auction_end_time > now() THEN
        RETURN jsonb_build_object('success', false, 'reason', 'auction_not_expired');
    END IF;

    SELECT bidder_id INTO v_winner
    FROM public.bids
    WHERE ride_id = p_ride_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_winner IS NULL THEN
        UPDATE public.rides SET status = 'cancelled' WHERE id = p_ride_id;
        RETURN jsonb_build_object('success', true, 'status', 'cancelled');
    END IF;

    UPDATE public.rides
    SET status = 'booked', winner_id = v_winner, auction_end_time = now()
    WHERE id = p_ride_id;

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (v_winner, 'auction_won', 'Вы выиграли аукцион!',
            'Поздравляем! Поездка ' || v_ride.origin || ' → ' || v_ride.destination || ' ваша.',
            p_ride_id);

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (v_ride.creator_id, 'auction_won', 'Аукцион завершён',
            'Найден ' || (CASE WHEN v_ride.type = 'request' THEN 'водитель' ELSE 'пассажир' END),
            p_ride_id);

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    SELECT DISTINCT b.bidder_id, 'auction_lost', 'Аукцион завершён',
           'По поездке ' || v_ride.origin || ' → ' || v_ride.destination || ' выбрали другого участника.',
           p_ride_id
    FROM public.bids b
    WHERE b.ride_id = p_ride_id
      AND b.bidder_id <> v_winner;

    RETURN jsonb_build_object('success', true, 'status', 'booked', 'winner_id', v_winner);
END;
$function$;

-- Служебная функция: только postgres и service_role.
revoke all on function public.finish_auction(uuid) from public, anon, authenticated;

commit;
