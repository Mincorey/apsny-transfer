-- P1: приватность контактов (применено к проду uprcnpgmmnvsoxasuhun 2026-06-13).
-- Контакты (email, phone, telegram, whatsapp, max) больше нельзя читать с клиента
-- напрямую — только через гейтящие SECURITY DEFINER функции, которые серверно
-- проверяют флаги show_* и факт отношения (создатель/победитель/совместная
-- завершённая поездка).
--
-- ВАЖНО: колоночный REVOKE НЕ действует, пока на таблице есть табличный GRANT
-- SELECT. Поэтому отзываем табличный SELECT целиком и выдаём заново только на
-- не-PII колонки (см. конец файла).

-- 1) Собственный профиль целиком (для редактирования в Profile).
CREATE OR REPLACE FUNCTION public.get_my_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT to_jsonb(u) INTO v_row FROM public.users u WHERE u.id = v_uid;
  RETURN v_row;
END;
$$;

-- 2) Публичный профиль другого пользователя: публичные поля всегда,
--    контакты — только own / совместная завершённая поездка / show_*-флаг
--    (и только для залогиненного).
CREATE OR REPLACE FUNCTION public.get_user_profile(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_own    boolean := v_uid IS NOT NULL AND v_uid = p_user_id;
  v_shared boolean := false;
  v_u      public.users;
  v_base   jsonb;
BEGIN
  SELECT * INTO v_u FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_uid IS NOT NULL AND NOT v_own THEN
    SELECT EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.status = 'completed'
        AND ((r.creator_id = v_uid AND r.winner_id = p_user_id)
          OR (r.creator_id = p_user_id AND r.winner_id = v_uid))
    ) INTO v_shared;
  END IF;

  v_base := jsonb_build_object(
    'id',            v_u.id,
    'full_name',     v_u.full_name,
    'role',          v_u.role,
    'avatar_url',    v_u.avatar_url,
    'rating',        v_u.rating,
    'trips_count',   v_u.trips_count,
    'created_at',    v_u.created_at,
    'show_phone',    v_u.show_phone,
    'show_telegram', v_u.show_telegram,
    'show_whatsapp', v_u.show_whatsapp,
    'show_max',      v_u.show_max,
    'phone',    CASE WHEN v_uid IS NOT NULL AND (v_own OR v_shared OR v_u.show_phone)    THEN v_u.phone    ELSE NULL END,
    'telegram', CASE WHEN v_uid IS NOT NULL AND (v_own OR v_shared OR v_u.show_telegram) THEN v_u.telegram ELSE NULL END,
    'whatsapp', CASE WHEN v_uid IS NOT NULL AND (v_own OR v_shared OR v_u.show_whatsapp) THEN v_u.whatsapp ELSE NULL END,
    'max',      CASE WHEN v_uid IS NOT NULL AND (v_own OR v_shared OR v_u.show_max)      THEN v_u.max      ELSE NULL END
  );

  RETURN v_base;
END;
$$;

-- 3) get_trip_view: гейтим контакты внутри.
--    creator-контакты — создателю/победителю после booked/completed (каждое поле
--    с учётом своего show_*); winner-контакты — только создателю после booked/completed.
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

-- 4) Гранты на функции.
REVOKE EXECUTE ON FUNCTION public.get_my_profile()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_profile(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_profile()       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_user_profile(uuid) TO anon, authenticated;

-- 5) Закрыть прямое чтение PII: отозвать табличный SELECT и выдать только не-PII колонки.
REVOKE SELECT ON public.users FROM anon, authenticated;
GRANT SELECT (
  id, full_name, role, avatar_url, rating, trips_count, created_at,
  show_phone, show_telegram, show_whatsapp, show_max
) ON public.users TO anon, authenticated;
