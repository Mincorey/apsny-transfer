-- Migration: Денормализация счётчика ставок (раздел 3.1 плана оптимизации)
-- Дата: 2026-06-04
--
-- Добавляет rides.bids_count и rides.last_bid_at, поддерживаемые внутри
-- place_bid / accept_current_price. Позволяет показывать активность поездки
-- («N ставок», «последняя ставка …») в ленте без JOIN на bids и без COUNT.
-- Backfill заполняет значения для уже существующих поездок.
--
-- Версии функций взяты актуальные:
--   place_bid           — из 20260522_fix_place_bid_auth.sql (2 параметра, auth.uid())
--   accept_current_price — из supabase_schema_v2.sql (p_ride_id, p_bidder_id)
-- Сигнатуры НЕ меняются (фронт вызывает их как есть).

-- ─── 1. Новые колонки ───────────────────────────────────────────────────────
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS bids_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS last_bid_at TIMESTAMPTZ;

-- ─── 2. Backfill из существующих ставок ─────────────────────────────────────
UPDATE public.rides r
SET bids_count  = COALESCE(c.cnt, 0),
    last_bid_at = c.maxat
FROM (
    SELECT ride_id, count(*) AS cnt, max(created_at) AS maxat
    FROM public.bids
    GROUP BY ride_id
) c
WHERE c.ride_id = r.id;

-- ─── 3. place_bid: + bids_count / last_bid_at ───────────────────────────────
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

    -- Денормализация: цена + счётчик ставок + время последней ставки одним UPDATE
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
        'Поступила ставка: ' || p_amount || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'new_price', p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 4. accept_current_price: + bids_count / last_bid_at ─────────────────────
CREATE OR REPLACE FUNCTION accept_current_price(
    p_ride_id   UUID,
    p_bidder_id UUID
) RETURNS jsonb AS $$
DECLARE
    v_ride RECORD;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.status != 'active' THEN
        RAISE EXCEPTION 'Аукцион уже завершён';
    END IF;

    IF v_ride.creator_id = p_bidder_id THEN
        RAISE EXCEPTION 'Нельзя делать ставку на свою поездку';
    END IF;

    INSERT INTO public.bids (ride_id, bidder_id, amount)
    VALUES (p_ride_id, p_bidder_id, v_ride.current_price);

    -- Денормализация: счётчик ставок + время последней ставки
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
