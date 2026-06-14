-- Migration: Fix 4 bugs (items 1.4.3 – 1.4.6 in AUDIT.md)
--
-- Bug 1: cancel_ride did not set cancelled_at — Feed.tsx filters by
--        cancelled_at.gte(yesterday), so cancelled rides disappeared from feed.
--        Fix: re-deploy with cancelled_at = now() guaranteed.
--
-- Bug 2: submit_review allowed creator to review winner (DB more permissive
--        than UI). UI only supports winner → creator reviews.
--        Fix: require caller = winner_id AND p_target_id = creator_id.
--
-- Bug 3: complete_trip (booked → completed) never incremented trips_count.
--        After the lifecycle fix, finish_auction only goes to 'booked', so
--        complete_trip is the only path to 'completed' and must own the counter.
--        Fix: UPDATE users SET trips_count = trips_count + 1 for both parties.
--
-- Bug 4: place_bid had no consecutive-bid guard — same user could flood bids.
--        Fix: reject if the last bid on the ride is from the same bidder.


-- ─── 1. cancel_ride: ensure cancelled_at is always set ───────────────────────
CREATE OR REPLACE FUNCTION cancel_ride(p_ride_id UUID) RETURNS jsonb AS $$
DECLARE
    v_ride RECORD;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 2. submit_review: restrict to winner → creator only ─────────────────────
CREATE OR REPLACE FUNCTION submit_review(
    p_ride_id   UUID,
    p_target_id UUID,
    p_rating    INTEGER,
    p_comment   TEXT DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_reviewer UUID := auth.uid();
    v_ride     RECORD;
    v_avg      NUMERIC;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.status != 'completed' THEN
        RAISE EXCEPTION 'Поездка ещё не завершена';
    END IF;

    IF v_ride.winner_id != v_reviewer THEN
        RAISE EXCEPTION 'Только победитель аукциона может оставлять отзывы';
    END IF;

    IF p_target_id != v_ride.creator_id THEN
        RAISE EXCEPTION 'Отзыв можно оставить только создателю поездки';
    END IF;

    INSERT INTO public.reviews (ride_id, reviewer_id, target_id, rating, comment)
    VALUES (p_ride_id, v_reviewer, p_target_id, p_rating, p_comment);

    SELECT ROUND(AVG(rating)::NUMERIC, 1) INTO v_avg
    FROM public.reviews WHERE target_id = p_target_id;

    UPDATE public.users SET rating = v_avg WHERE id = p_target_id;

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (p_target_id, 'review_received', 'Новый отзыв',
            'Вам оставили отзыв с оценкой ' || p_rating || '⭐', p_ride_id);

    RETURN jsonb_build_object('success', true, 'new_rating', v_avg);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 3. complete_trip: add trips_count increment for both participants ────────
CREATE OR REPLACE FUNCTION complete_trip(p_ride_id UUID) RETURNS jsonb AS $$
DECLARE
    v_ride RECORD;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.status != 'booked' THEN
        RAISE EXCEPTION 'Поездка должна быть в статусе booked для завершения';
    END IF;

    IF v_ride.creator_id != auth.uid() THEN
        RAISE EXCEPTION 'Только создатель поездки может завершить её';
    END IF;

    UPDATE public.rides SET status = 'completed' WHERE id = p_ride_id;

    UPDATE public.users
    SET trips_count = trips_count + 1
    WHERE id IN (v_ride.creator_id, v_ride.winner_id);

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 4. place_bid: prevent consecutive bids from the same user ───────────────
CREATE OR REPLACE FUNCTION place_bid(
    p_ride_id   UUID,
    p_bidder_id UUID,
    p_amount    NUMERIC
) RETURNS jsonb AS $$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
BEGIN
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

    IF v_ride.creator_id = p_bidder_id THEN
        RAISE EXCEPTION 'Нельзя делать ставку на свою поездку';
    END IF;

    SELECT bidder_id INTO v_last_bidder
    FROM public.bids
    WHERE ride_id = p_ride_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_bidder = p_bidder_id THEN
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
    VALUES (p_ride_id, p_bidder_id, p_amount);

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
