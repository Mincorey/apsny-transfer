-- ============================================================
-- 20260810_fix_1_5_accept_current_price_auth.sql
--
-- Закрывает пункт 1.5 аудита AUDIT_2026-08-10.md:
-- «Можно поставить ставку от имени другого пользователя».
--
-- ПРОБЛЕМА
-- --------
-- public.accept_current_price принимала того, от чьего имени делается ставка,
-- обычным параметром p_bidder_id и нигде не сверяла его с auth.uid():
--
--     IF v_ride.creator_id = p_bidder_id THEN ... END IF;
--     INSERT INTO public.bids (ride_id, bidder_id, amount)
--     VALUES (p_ride_id, p_bidder_id, v_ride.current_price);
--
-- Фронтенд честно подставлял свой userId, но запрос к REST API подменяется
-- в один клик через инструменты разработчика в браузере.
--
-- Подтверждено тестом на боевой базе (в транзакции с откатом): вызов от имени
-- одного пользователя с чужим p_bidder_id вернул success, и ставка в таблице
-- bids оказалась записана на постороннего пользователя.
--
-- Сверка с «правильной» place_bid показала не два пробела, а ТРИ. В place_bid
-- есть семь проверок, в accept_current_price было три. Отсутствовали:
--   1) авторизация (auth.uid() не использовался вообще);
--   2) окончание торгов — можно было «согласиться с ценой» после
--      auction_end_time, то есть влезть в уже закрытый аукцион;
--   3) запрет двух ставок подряд от одного участника — можно было вызывать
--      функцию сколько угодно раз, накручивая bids_count, засыпая создателя
--      уведомлениями и удерживая за собой позицию последней ставки
--      (а победителем finish_auction объявляет именно автора последней).
-- Пункт 3 в аудите не отмечен — найден при сверке с place_bid.
--
-- РЕШЕНИЕ
-- -------
-- Личность берётся только из сессии: v_bidder_id := auth.uid().
-- Параметр p_bidder_id сохранён, но стал необязательным и полностью
-- игнорируется — см. раздел о совместимости ниже.
-- Набор проверок приведён в соответствие с place_bid: авторизация →
-- поездка найдена → статус active → торги не истекли → не своя поездка →
-- не две ставки подряд.
--
-- ПОЧЕМУ ПАРАМЕТР НЕ УДАЛЁН СОВСЕМ
-- --------------------------------
-- База и фронтенд выкатываются раздельно, поэтому важно, чтобы работали обе
-- комбинации в переходный период:
--   • старый фронтенд + новая база — шлёт p_bidder_id, параметр на месте,
--     вызов проходит, значение игнорируется. Работает;
--   • новый фронтенд + старая база — не шлёт p_bidder_id, а в старой версии
--     параметр обязателен, PostgREST функцию бы не нашёл. Не работает.
-- Отсюда обязательный порядок выката: СНАЧАЛА эта миграция, ПОТОМ фронтенд.
-- Обе комбинации проверены тестом на боевой базе.
-- Параметр можно будет удалить отдельной миграцией, когда новый фронтенд
-- отработает какое-то время.
--
-- СВЯЗАННАЯ ПРАВКА ВО ФРОНТЕНДЕ
-- -----------------------------
-- src/pages/TripDetail.tsx, handleAcceptPrice — из вызова убран p_bidder_id.
-- Правка косметическая: значение и так игнорируется, но незачем отправлять
-- на сервер данные, которые он не должен принимать.
--
-- ОТКАТ
-- -----
-- Вернуть прежнее тело функции (делать не следует).
--
-- Миграция идемпотентна: create or replace.
-- ============================================================

begin;

create or replace function public.accept_current_price(p_ride_id uuid, p_bidder_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
    -- Личность берём ТОЛЬКО из сессии. Параметр p_bidder_id оставлен для
    -- совместимости со старым фронтендом и намеренно не используется.
    v_bidder_id   UUID := auth.uid();
BEGIN
    IF v_bidder_id IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация';
    END IF;

    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.status != 'active' THEN
        RAISE EXCEPTION 'Аукцион уже завершён';
    END IF;

    IF v_ride.auction_end_time IS NOT NULL AND v_ride.auction_end_time < now() THEN
        RAISE EXCEPTION 'Время приёма ставок истекло';
    END IF;

    IF v_ride.creator_id = v_bidder_id THEN
        RAISE EXCEPTION 'Нельзя делать ставку на свою поездку';
    END IF;

    SELECT bidder_id INTO v_last_bidder
    FROM public.bids
    WHERE ride_id = p_ride_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_bidder = v_bidder_id THEN
        RAISE EXCEPTION 'Вы уже сделали последнюю ставку, дождитесь другого участника';
    END IF;

    INSERT INTO public.bids (ride_id, bidder_id, amount)
    VALUES (p_ride_id, v_bidder_id, v_ride.current_price);

    UPDATE public.rides
    SET bids_count  = bids_count + 1,
        last_bid_at = now()
    WHERE id = p_ride_id;

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (
        v_ride.creator_id,
        'new_bid',
        'Водитель согласился с ценой!',
        'Ставка: ' || v_ride.current_price || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'amount', v_ride.current_price);
END;
$function$;

revoke all on function public.accept_current_price(uuid, uuid) from public, anon;
grant execute on function public.accept_current_price(uuid, uuid) to authenticated;

commit;
