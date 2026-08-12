-- 12.08.2026 — мелочь в тексте уведомления об отзыве.
--
-- Было «Вам оставили отзыв с оценкой 5⭐» — звезда прилипала к цифре.
-- Ставим неразрывный пробел: перенос строки между числом и значком
-- в узкой карточке уведомления выглядел бы ещё хуже обычного пробела.
--
-- Остальное тело функции не тронуто.

create or replace function public.submit_review(p_ride_id uuid, p_target_id uuid, p_rating integer, p_comment text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
            'Вам оставили отзыв с оценкой ' || p_rating || chr(160) || '⭐', p_ride_id);

    RETURN jsonb_build_object('success', true, 'new_rating', v_avg);
END;
$function$;
