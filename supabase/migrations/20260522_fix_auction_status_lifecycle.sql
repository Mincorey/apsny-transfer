-- Migration: Fix auction status lifecycle (active → booked → completed)
--
-- Problem 1: close_auction_early in supabase_schema_v2.sql sets status = 'completed',
-- while migrations/002_booked_status.sql correctly sets status = 'booked'.
-- If 002 was not applied, TripDetail's isBooked check fails and the
-- "Завершить поездку" button never appears.
--
-- Problem 2: finish_auction (timer-based auction end, called by pg_cron) also sets
-- status = 'completed' directly — migration 002 missed updating it.
-- Timer-ended auctions skip the 'booked' stage entirely.
--
-- Problem 3: complete_trip does not exist in v2.sql, so TripDetail.tsx calling
-- supabase.rpc('complete_trip') returns an RPC error if 002 was not applied.
--
-- Fix:
--   close_auction_early  → active → booked (+ creator check + auction_end_time)
--   finish_auction       → active → booked (timer path now consistent with manual)
--   complete_trip        → booked → completed (driver action, idempotent)

-- ─── 1. close_auction_early: active → booked ─────────────────────────────────
CREATE OR REPLACE FUNCTION close_auction_early(p_ride_id UUID)
RETURNS jsonb AS $$
DECLARE
  v_ride      RECORD;
  v_winner_id UUID;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Поездка не найдена';
  END IF;

  IF v_ride.status != 'active' THEN
    RAISE EXCEPTION 'Аукцион уже завершён';
  END IF;

  IF v_ride.creator_id != auth.uid() THEN
    RAISE EXCEPTION 'Только создатель поездки может закрыть аукцион';
  END IF;

  SELECT bidder_id INTO v_winner_id
  FROM public.bids
  WHERE ride_id = p_ride_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_winner_id IS NULL THEN
    RAISE EXCEPTION 'Нет ставок для завершения аукциона';
  END IF;

  UPDATE public.rides
  SET status           = 'booked',
      winner_id        = v_winner_id,
      auction_end_time = now()
  WHERE id = p_ride_id;

  INSERT INTO public.notifications (user_id, type, title, body, ride_id)
  VALUES (v_winner_id, 'auction_won', 'Вы выиграли аукцион!',
          'Поздравляем! Поездка ' || v_ride.origin || ' → ' || v_ride.destination || ' ваша.',
          p_ride_id);

  RETURN jsonb_build_object('success', true, 'winner_id', v_winner_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 2. finish_auction: active → booked (timer-based path) ───────────────────
CREATE OR REPLACE FUNCTION finish_auction(p_ride_id UUID) RETURNS jsonb AS $$
DECLARE
    v_ride   RECORD;
    v_winner UUID;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND OR v_ride.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'not_active');
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

    RETURN jsonb_build_object('success', true, 'status', 'booked', 'winner_id', v_winner);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 3. complete_trip: booked → completed (driver presses button) ─────────────
CREATE OR REPLACE FUNCTION complete_trip(p_ride_id UUID)
RETURNS jsonb AS $$
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

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
