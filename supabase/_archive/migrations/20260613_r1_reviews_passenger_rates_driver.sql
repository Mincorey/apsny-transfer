-- R1: отзыв всегда «пассажир → водитель», независимо от типа поездки
-- (применено к проду uprcnpgmmnvsoxasuhun 2026-06-13).
-- offer: водитель = creator, пассажир = winner. request: наоборот.
-- Рейтинг есть только у водителей; пассажиров не оценивают.

CREATE OR REPLACE FUNCTION public.submit_review(
  p_ride_id uuid, p_target_id uuid, p_rating integer, p_comment text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_reviewer  UUID := auth.uid();
    v_ride      RECORD;
    v_driver    UUID;
    v_passenger UUID;
    v_avg       NUMERIC;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;
    IF v_ride.status <> 'completed' THEN
        RAISE EXCEPTION 'Поездка ещё не завершена';
    END IF;

    IF v_ride.type = 'offer' THEN
        v_driver    := v_ride.creator_id;
        v_passenger := v_ride.winner_id;
    ELSE
        v_driver    := v_ride.winner_id;
        v_passenger := v_ride.creator_id;
    END IF;

    IF v_passenger IS NULL OR v_reviewer <> v_passenger THEN
        RAISE EXCEPTION 'Оценить водителя может только пассажир этой поездки';
    END IF;
    IF p_rating < 1 OR p_rating > 5 THEN
        RAISE EXCEPTION 'Оценка должна быть от 1 до 5';
    END IF;
    IF p_target_id <> v_driver THEN
        RAISE EXCEPTION 'Оценить можно только водителя поездки';
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
$function$;

-- get_trip_view: has_reviewed считаем по пассажиру (он автор отзыва).
-- (Полное тело функции с гейтингом контактов P1 — см. 20260613_p1_contact_privacy.sql;
--  здесь меняется только вычисление пассажира и has_reviewed.)
CREATE OR REPLACE FUNCTION public.get_trip_view(p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_auth         boolean := v_uid IS NOT NULL;
  v_ride         public.rides;
  v_passenger    uuid;
  v_has_reviewed boolean := false;
  v_revealed     boolean;
  v_see_creator  boolean;
  v_see_winner   boolean;
  v_result       jsonb;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_ride.status = 'active'
     AND v_ride.auction_end_time IS NOT NULL
     AND v_ride.auction_end_time < now() THEN
    PERFORM public.finish_auction(p_ride_id);
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  END IF;

  v_revealed    := v_ride.status IN ('booked','completed');
  v_see_creator := v_auth AND v_revealed AND (v_uid = v_ride.winner_id OR v_uid = v_ride.creator_id);
  v_see_winner  := v_auth AND v_revealed AND (v_uid = v_ride.creator_id);
  v_passenger   := CASE WHEN v_ride.type = 'offer' THEN v_ride.winner_id ELSE v_ride.creator_id END;

  IF v_auth AND v_ride.status = 'completed' AND v_uid = v_passenger THEN
    SELECT EXISTS(
      SELECT 1 FROM public.reviews
      WHERE ride_id = p_ride_id AND reviewer_id = v_uid
    ) INTO v_has_reviewed;
  END IF;

  v_result := jsonb_build_object(
    'ride',
      to_jsonb(v_ride)
      || jsonb_build_object(
        'creator', (
          SELECT
            jsonb_build_object(
              'id',            u.id,
              'full_name',     u.full_name,
              'avatar_url',    u.avatar_url,
              'rating',        u.rating,
              'trips_count',   u.trips_count,
              'show_phone',    u.show_phone,
              'show_telegram', u.show_telegram,
              'show_whatsapp', u.show_whatsapp
            )
            || CASE WHEN v_see_creator THEN jsonb_build_object(
                 'phone',    CASE WHEN u.show_phone    THEN u.phone    ELSE NULL END,
                 'telegram', CASE WHEN u.show_telegram THEN u.telegram ELSE NULL END,
                 'whatsapp', CASE WHEN u.show_whatsapp THEN u.whatsapp ELSE NULL END
               ) ELSE '{}'::jsonb END
          FROM public.users u
          WHERE u.id = v_ride.creator_id
        ),
        'winner', (
          SELECT
            jsonb_build_object(
              'id',         u.id,
              'full_name',  u.full_name,
              'avatar_url', u.avatar_url
            )
            || CASE WHEN v_see_winner THEN jsonb_build_object(
                 'phone',    u.phone,
                 'telegram', u.telegram,
                 'whatsapp', u.whatsapp
               ) ELSE '{}'::jsonb END
          FROM public.users u
          WHERE u.id = v_ride.winner_id
        )
      ),
    'bids', COALESCE((
      SELECT jsonb_agg(b.entry ORDER BY b.created_at DESC)
      FROM (
        SELECT
          bd.created_at,
          jsonb_build_object(
            'id',         bd.id,
            'amount',     bd.amount,
            'created_at', bd.created_at,
            'bidder', CASE WHEN bu.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id',         bu.id,
              'full_name',  bu.full_name,
              'avatar_url', bu.avatar_url
            ) END
          ) AS entry
        FROM public.bids bd
        LEFT JOIN public.users bu ON bu.id = bd.bidder_id
        WHERE bd.ride_id = p_ride_id
      ) b
    ), '[]'::jsonb),
    'has_reviewed', v_has_reviewed
  );

  RETURN v_result;
END;
$function$;
