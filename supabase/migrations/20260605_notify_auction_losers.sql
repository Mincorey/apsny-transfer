-- Migration: уведомление проигравших в аукционе (аудит I6)
-- Дата: 2026-06-05
--
-- Тип notifications.auction_lost был объявлен и стилизован в UI, но ни одна
-- функция его не создавала. Теперь finish_auction (таймер/ленивое закрытие) и
-- close_auction_early (ручное закрытие создателем) рассылают auction_lost всем
-- ставщикам, кроме победителя (DISTINCT — повторные ставки одного не дублируются).
-- Заодно проставлен search_path (снимает предупреждение function_search_path_mutable).

CREATE OR REPLACE FUNCTION public.finish_auction(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

    -- Уведомить проигравших ставщиков (все, кроме победителя)
    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    SELECT DISTINCT b.bidder_id, 'auction_lost', 'Аукцион завершён',
           'По поездке ' || v_ride.origin || ' → ' || v_ride.destination || ' выбрали другого участника.',
           p_ride_id
    FROM public.bids b
    WHERE b.ride_id = p_ride_id
      AND b.bidder_id <> v_winner;

    RETURN jsonb_build_object('success', true, 'status', 'booked', 'winner_id', v_winner);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_auction_early(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- Уведомить проигравших ставщиков (все, кроме победителя)
  INSERT INTO public.notifications (user_id, type, title, body, ride_id)
  SELECT DISTINCT b.bidder_id, 'auction_lost', 'Аукцион завершён',
         'По поездке ' || v_ride.origin || ' → ' || v_ride.destination || ' выбрали другого участника.',
         p_ride_id
  FROM public.bids b
  WHERE b.ride_id = p_ride_id
    AND b.bidder_id <> v_winner_id;

  RETURN jsonb_build_object('success', true, 'winner_id', v_winner_id);
END;
$$;
