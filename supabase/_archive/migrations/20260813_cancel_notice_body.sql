-- Уведомление об отмене поездки приходило без текста.
--
-- В cancel_ride поле body жёстко ставилось в NULL: участник видел голый
-- заголовок «Поездка отменена» и не понимал, какая именно из его поездок
-- отменилась. Все остальные уведомления в проекте поясняют себя маршрутом
-- или суммой — это единственное было немым.
--
-- Формат маршрута берём тот же, что в auction_won: «Пицунда → Адлер».

CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_ride RECORD;
    v_uid  uuid := auth.uid();
BEGIN
    -- Без этой проверки сравнение creator_id <> NULL даёт NULL,
    -- и проверка владельца ниже молча пропустит вызов.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация';
    END IF;

    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.creator_id <> v_uid THEN
        RAISE EXCEPTION 'Отменить поездку может только её создатель';
    END IF;

    IF v_ride.status != 'active' THEN
        RAISE EXCEPTION 'Можно отменить только активные поездки';
    END IF;

    UPDATE public.rides
    SET status = 'cancelled', cancelled_at = now()
    WHERE id = p_ride_id;

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    SELECT DISTINCT
           bidder_id,
           'ride_cancelled',
           'Поездка отменена',
           v_ride.origin || ' → ' || v_ride.destination
             || ' на ' || to_char(v_ride.departure_date, 'DD.MM.YYYY')
             || '. Создатель снял объявление, ваша ставка аннулирована.',
           p_ride_id
    FROM public.bids
    WHERE ride_id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END;
$function$;
