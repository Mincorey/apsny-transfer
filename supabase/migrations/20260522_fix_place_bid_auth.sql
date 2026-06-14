-- SEC-07: place_bid принимал p_bidder_id с клиента без проверки auth.uid().
-- Любой авторизованный пользователь мог сделать ставку от имени другого.
-- Решение: убрать p_bidder_id из параметров, использовать auth.uid() внутри.

-- Удаляем старую версию с 3-мя параметрами (UUID, UUID, NUMERIC)
DROP FUNCTION IF EXISTS place_bid(UUID, UUID, NUMERIC);

CREATE OR REPLACE FUNCTION place_bid(
    p_ride_id UUID,
    p_amount  NUMERIC
) RETURNS jsonb AS $$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
    v_bidder_id   UUID;
BEGIN
    v_bidder_id := auth.uid();

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

    UPDATE public.rides SET current_price = p_amount WHERE id = p_ride_id;

    INSERT INTO public.bids (ride_id, bidder_id, amount)
    VALUES (p_ride_id, v_bidder_id, p_amount);

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (
        v_ride.creator_id,
        'new_bid',
        'Новая ставка на вашу поездку',
        'Поступила ставка: ' || p_amount || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'new_price', p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
