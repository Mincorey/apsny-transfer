-- get_trip_view(p_ride_id): один RPC для страницы поездки.
-- Возвращает JSON: ride (+ creator/winner с контактами только для залогиненных),
-- список ставок и флаг has_reviewed. Заодно «ленивое» закрытие истёкшего аукциона.
-- Выгружено из прода 2026-06-13 для синхронизации репозитория (был дрейф: в проде есть, в репо не было).

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
  v_has_reviewed boolean := false;
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

  IF v_auth AND v_ride.status = 'completed' AND v_uid = v_ride.winner_id THEN
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
              'id',          u.id,
              'full_name',   u.full_name,
              'avatar_url',  u.avatar_url,
              'rating',      u.rating,
              'trips_count', u.trips_count
            )
            || CASE WHEN v_auth THEN jsonb_build_object(
                 'phone',         u.phone,
                 'telegram',      u.telegram,
                 'whatsapp',      u.whatsapp,
                 'show_phone',    u.show_phone,
                 'show_telegram', u.show_telegram,
                 'show_whatsapp', u.show_whatsapp
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
            || CASE WHEN v_auth THEN jsonb_build_object(
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
