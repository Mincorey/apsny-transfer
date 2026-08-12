-- 12.08.2026 — правки по итогам проверки сценария водителя.
--
-- 1) list_paid_ride_ids() — список своих поездок с проведённым платежом.
--    Нужен интерфейсу, чтобы показывать кнопку «Квитанция об оплате» только
--    там, где квитанция реально существует. Раньше кнопка рисовалась по статусу
--    поездки и при бесплатной публикации вела на «Квитанция не найдена».
--    Таблица payments закрыта RLS без политик для authenticated, поэтому читаем
--    её через security definer с явной проверкой владельца.
--
-- 2) Суммы в уведомлениях о ставках печатались как «4500.00 ₽» — прямая
--    конкатенация numeric. Приводим к формату интерфейса: «4 500 ₽».

-- 1) ───────────────────────────────────────────────────────────────────────────
create or replace function public.list_paid_ride_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select distinct p.ride_id
  from public.payments p
  join public.rides r on r.id = p.ride_id
  where p.status = 'paid'
    and r.creator_id = auth.uid();
$$;

revoke all on function public.list_paid_ride_ids() from public;
grant execute on function public.list_paid_ride_ids() to authenticated;

-- 2) ───────────────────────────────────────────────────────────────────────────
-- Форматирование суммы для текстов уведомлений: 4500.00 → «4 500».
-- Неразрывный пробел (U+00A0) как разделитель разрядов — так же, как в вёрстке.
create or replace function public.fmt_money(p_amount numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(trim(to_char(round(p_amount), 'FM999G999G999')), ',', chr(160));
$$;

grant execute on function public.fmt_money(numeric) to authenticated, anon, service_role;

-- Переписываем две функции, которые пишут сумму в текст уведомления.
-- Тело сохранено как есть, изменена только строка с суммой.

create or replace function public.place_bid(p_ride_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
        'Поступила ставка: ' || public.fmt_money(p_amount) || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'new_price', p_amount);
END;
$function$;

create or replace function public.accept_current_price(p_ride_id uuid, p_bidder_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
    -- Личность берём ТОЛЬКО из сессии. Параметр p_bidder_id оставлен для
    -- совместимости со старым фронтендом и намеренно не используется.
    v_bidder_id   UUID := auth.uid();
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

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (
        v_ride.creator_id,
        'new_bid',
        'Водитель согласился с ценой!',
        'Ставка: ' || public.fmt_money(v_ride.current_price) || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'amount', v_ride.current_price);
END;
$function$;
