-- 20260813_bid_bounds_and_ride_limits.sql
--
-- Закрывает два пункта аудита от 13.08.2026.
--
-- 1. place_bid проверяла только относительные величины: «ниже текущей цены»
--    и «шаг не меньше bid_step». Абсолютной нижней границы не было ни в
--    функции, ни в виде ограничения таблицы. Для поездки типа request
--    (запрос пассажира — водители сбивают цену вниз) это значило, что вызов
--    RPC с p_amount = -100000 проходит ОБЕ проверки: минус ста тысяч меньше
--    текущей цены, и разница с ней больше любого шага. Ставка ложилась в
--    bids, current_price поездки становился отрицательным, а создателю
--    уходило уведомление «Поступила ставка: −100 000 ₽».
--    Интерфейс такого не позволяет, но RPC вызывается по REST обычным
--    пользовательским токеном — форма тут не защита.
--
-- 2. Вставка в rides идёт напрямую (у authenticated есть INSERT на колонки,
--    политика проверяет только creator_id = auth.uid()). Ограничений на
--    числа не было вообще: 0 мест, отрицательная цена, bid_step = 0 (тогда
--    проверка шага в place_bid вырождается) и auction_hours до 32767 —
--    publish_ride_free подставляет это значение в now() + N hours как есть,
--    то есть аукцион на 3,7 года.
--
-- Границы согласованы с формой создания поездки (src/pages/CreateTrip.tsx):
--   места      1..8      — ровно столько даёт счётчик в форме
--   шаг ставки 10..5000  — нижняя граница уже стояла в поле ручного ввода
--   аукцион    1..72 ч   — пресеты формы 1/3/6/12/24 плюс запас на трое суток
--   цена       > 0 и до 1 000 000 ₽ — не бизнес-лимит, а страховка от мусора
--                и опечаток; реальные поездки идут по 4–7 тысяч.
--
-- Существующие данные проверены до применения: цены 4000–7050, места 1–4,
-- шаг 50–100, длительность 1–24 — всё внутри новых границ, ни одна строка
-- не отвергается.

begin;

-- ─── 1. Ограничения таблицы rides ───────────────────────────────────────
-- Последний рубеж: даже если мимо функций кто-то вставит строку напрямую,
-- база не примет бессмысленные значения.

alter table public.rides drop constraint if exists rides_seats_range;
alter table public.rides add  constraint rides_seats_range
  check (seats between 1 and 8);

alter table public.rides drop constraint if exists rides_bid_step_range;
alter table public.rides add  constraint rides_bid_step_range
  check (bid_step between 10 and 5000);

alter table public.rides drop constraint if exists rides_auction_hours_range;
alter table public.rides add  constraint rides_auction_hours_range
  check (auction_hours between 1 and 72);

alter table public.rides drop constraint if exists rides_start_price_range;
alter table public.rides add  constraint rides_start_price_range
  check (start_price > 0 and start_price <= 1000000);

alter table public.rides drop constraint if exists rides_current_price_range;
alter table public.rides add  constraint rides_current_price_range
  check (current_price > 0 and current_price <= 1000000);

-- ─── 2. Ограничение таблицы bids ────────────────────────────────────────

alter table public.bids drop constraint if exists bids_amount_range;
alter table public.bids add  constraint bids_amount_range
  check (amount > 0 and amount <= 1000000);

-- ─── 3. place_bid с абсолютными границами ───────────────────────────────
-- Проверка стоит ПЕРЕД относительными: иначе на ставку -100000 человек
-- получил бы невразумительное «шаг ставки должен быть не менее 100 рублей»
-- вместо прямого объяснения. Ограничения таблиц выше сработали бы и без
-- этой проверки, но выдали бы код 23514 и текст на английском — в
-- интерфейсе это показалось бы пользователю как есть.
-- Всё остальное тело функции сохранено без изменений.

CREATE OR REPLACE FUNCTION public.place_bid(p_ride_id uuid, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
    v_bidder_id   UUID;
BEGIN
    v_bidder_id := auth.uid();

    IF v_bidder_id IS NULL THEN
        RAISE EXCEPTION 'Требуется авторизация';
    END IF;

    -- Абсолютные границы ставки. Без них проверки ниже пропускают любое
    -- отрицательное число: оно меньше текущей цены, и разница с ней
    -- больше шага.
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Ставка должна быть больше нуля';
    END IF;

    IF p_amount > 1000000 THEN
        RAISE EXCEPTION 'Ставка не может превышать 1 000 000 рублей';
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

commit;
