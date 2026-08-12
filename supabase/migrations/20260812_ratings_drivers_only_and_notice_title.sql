-- 12.08.2026 — вторая порция правок по итогам проверки.
--
-- 1) Заголовок уведомления о принятии цены зависел не от того, кто её принял.
--    Пассажир принимал цену на предложении водителя — водителю приходило
--    «Водитель согласился с ценой!». Заголовок был зашит в функцию строкой.
--    Теперь он выбирается по типу поездки: в запросе пассажира цену принимает
--    водитель, в предложении водителя — пассажир.
--
-- 2) Рейтинги в сервисе остаются только у водителей. Оценку ставит пассажир
--    после поездки, обратной оценки нет — сама функция submit_review это уже
--    запрещает. Но в базе остались две записи из старой версии, где водитель
--    оценил пассажира, и у пассажира от них держался рейтинг 5.0. Чистим:
--    удаляем отзывы о пассажирах и обнуляем поле рейтинга у всех пассажиров.

-- 1) ───────────────────────────────────────────────────────────────────────────
create or replace function public.accept_current_price(p_ride_id uuid, p_bidder_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
    v_bidder_id   UUID := auth.uid();
    v_title       TEXT;
BEGIN
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

    INSERT INTO public.bids (ride_id, bidder_id, amount)
    VALUES (p_ride_id, v_bidder_id, v_ride.current_price);

    UPDATE public.rides
    SET bids_count  = bids_count + 1,
        last_bid_at = now()
    WHERE id = p_ride_id;

    -- Запрос публикует пассажир, откликается водитель; предложение публикует
    -- водитель, откликается пассажир.
    v_title := CASE
        WHEN v_ride.type = 'request' THEN 'Водитель согласился с ценой!'
        ELSE 'Пассажир согласился с ценой!'
    END;

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (
        v_ride.creator_id,
        'new_bid',
        v_title,
        'Ставка: ' || public.fmt_money(v_ride.current_price) || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'amount', v_ride.current_price);
END;
$function$;

-- 2) ───────────────────────────────────────────────────────────────────────────
delete from public.reviews r
using public.users u
where u.id = r.target_id
  and u.role <> 'driver';

update public.users
set rating = 0
where role <> 'driver'
  and rating <> 0;
