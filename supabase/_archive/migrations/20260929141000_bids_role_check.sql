-- Аудит 29.09.2026, пункт В-6.
--
-- Логика сервиса: на ЗАПРОС пассажира (type = 'request') торгуются водители,
-- на ПРЕДЛОЖЕНИЕ водителя (type = 'offer') — пассажиры. Раньше ни place_bid,
-- ни accept_current_price роль не проверяли: пассажир мог «выиграть» запрос
-- другого пассажира, и им взаимно открывались контакты; водитель — предложение
-- другого водителя. На бою таких ставок не было (0 из 20), но ничто их не
-- останавливало.
--
-- Роль берём из профиля в базе, а не из параметра — клиенту не доверяем.
-- Тексты функций — боевые на 29.09.2026, добавлена только проверка роли.

create or replace function public.place_bid(p_ride_id uuid, p_amount numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
    v_bidder_id   UUID;
    v_role        TEXT;
BEGIN
    v_bidder_id := auth.uid();

    IF v_bidder_id IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация';
    END IF;

    -- Абсолютные границы ставки. Без них проверки ниже пропускают любое
    -- отрицательное число: оно меньше текущей цены, и разница с ней
    -- больше шага.
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Ставка должна быть больше нуля';
    END IF;

    IF p_amount > 1000000 THEN
        RAISE EXCEPTION 'Ставка не может превышать 1 000 000 рублей';
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

    -- В-6: торгуется только «другая сторона».
    SELECT role INTO v_role FROM public.users WHERE id = v_bidder_id;
    IF v_ride.type = 'request' AND v_role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Предлагать цену на запросы пассажиров могут только водители';
    END IF;
    IF v_ride.type = 'offer' AND v_role IS DISTINCT FROM 'passenger' THEN
        RAISE EXCEPTION 'Торговаться за места в поездке водителя могут только пассажиры';
    END IF;

    SELECT bidder_id INTO v_last_bidder
    FROM public.bids
    WHERE ride_id = p_ride_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_bidder = v_bidder_id THEN
        RAISE EXCEPTION 'Вы уже сделали последнюю ставку, дождитесь другого участника';
    END IF;

    IF v_ride.type = 'request' THEN
        IF p_amount >= v_ride.current_price THEN
            RAISE EXCEPTION 'Ставка должна быть ниже текущей цены';
        END IF;
        IF (v_ride.current_price - p_amount) < v_ride.bid_step THEN
            RAISE EXCEPTION 'Шаг ставки должен быть не менее % рублей', v_ride.bid_step;
        END IF;
    ELSE
        IF p_amount <= v_ride.current_price THEN
            RAISE EXCEPTION 'Ставка должна быть выше текущей цены';
        END IF;
        IF (p_amount - v_ride.current_price) < v_ride.bid_step THEN
            RAISE EXCEPTION 'Шаг ставки должен быть не менее % рублей', v_ride.bid_step;
        END IF;
    END IF;

    UPDATE public.rides
    SET current_price = p_amount,
        bids_count    = bids_count + 1,
        last_bid_at   = now()
    WHERE id = p_ride_id;

    INSERT INTO public.bids (ride_id, bidder_id, amount)
    VALUES (p_ride_id, v_bidder_id, p_amount);

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (
        v_ride.creator_id,
        'new_bid',
        'Новая ставка на вашу поездку',
        'Поступила ставка: ' || public.fmt_money(p_amount) || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'new_price', p_amount);
END;
$function$;

create or replace function public.accept_current_price(p_ride_id uuid, p_bidder_id uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
    v_bidder_id   UUID := auth.uid();
    v_title       TEXT;
    v_role        TEXT;
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

    -- В-6: соглашается с ценой только «другая сторона».
    SELECT role INTO v_role FROM public.users WHERE id = v_bidder_id;
    IF v_ride.type = 'request' AND v_role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Предлагать цену на запросы пассажиров могут только водители';
    END IF;
    IF v_ride.type = 'offer' AND v_role IS DISTINCT FROM 'passenger' THEN
        RAISE EXCEPTION 'Торговаться за места в поездке водителя могут только пассажиры';
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

    v_title := CASE
        WHEN v_ride.type = 'request' THEN 'Водитель согласился с ценой!'
        ELSE 'Пассажир согласился с ценой!'
    END;

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (
        v_ride.creator_id,
        'new_bid',
        v_title,
        'Ставка: ' || public.fmt_money(v_ride.current_price) || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'amount', v_ride.current_price);
END;
$function$;
