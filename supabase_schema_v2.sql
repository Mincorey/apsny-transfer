-- ============================================================
-- APSNY-TRANSFER — Схема БД v2
-- Обновление: роль driver, таймер аукциона, рейтинги,
-- приватность, прямые сообщения, отзывы
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. ТАБЛИЦА ПОЛЬЗОВАТЕЛЕЙ
-- ============================================================
CREATE TABLE public.users (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name       TEXT NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    phone           TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('passenger', 'driver')),
    telegram        TEXT,
    whatsapp        TEXT,
    avatar_url      TEXT,
    -- Настройки приватности (что видно до совершения поездки)
    show_phone      BOOLEAN NOT NULL DEFAULT false,
    show_telegram   BOOLEAN NOT NULL DEFAULT true,
    show_whatsapp   BOOLEAN NOT NULL DEFAULT true,
    -- Агрегированные данные
    rating          NUMERIC(3,1) NOT NULL DEFAULT 0,
    trips_count     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ============================================================
-- 2. ТАБЛИЦА АВТОМОБИЛЕЙ (только для водителей)
-- ============================================================
CREATE TABLE public.vehicles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    make_model      TEXT NOT NULL,
    license_plate   TEXT NOT NULL,
    capacity        INTEGER NOT NULL CHECK (capacity >= 1 AND capacity <= 20),
    photo_url       TEXT,   -- одно фото авто
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ============================================================
-- 3. ТАБЛИЦА ПОЕЗДОК (АУКЦИОНОВ)
-- ============================================================
CREATE TABLE public.rides (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- Тип: 'request' = пассажир ищет водителя (торг на понижение для водителей)
    --      'offer'   = водитель предлагает поездку (торг на повышение для пассажиров)
    type                TEXT NOT NULL CHECK (type IN ('request', 'offer')),
    origin              TEXT NOT NULL,
    destination         TEXT NOT NULL,
    departure_date      DATE NOT NULL,
    departure_time      TIME NOT NULL,
    seats               INTEGER NOT NULL CHECK (seats >= 1),
    border_crossing     BOOLEAN NOT NULL DEFAULT false,  -- пересечение границы
    comment             TEXT,                            -- примечание к поездке
    start_price         NUMERIC(10, 2) NOT NULL,
    current_price       NUMERIC(10, 2) NOT NULL,
    bid_step            INTEGER NOT NULL DEFAULT 50,     -- минимальный шаг ставки (руб.)
    auction_end_time    TIMESTAMP WITH TIME ZONE,        -- когда заканчивается аукцион
    winner_id           UUID REFERENCES public.users(id),-- победитель аукциона
    vehicle_id          UUID REFERENCES public.vehicles(id), -- авто водителя (для offer)
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'booked', 'completed', 'cancelled')),
    amenities           TEXT[] DEFAULT '{}',                -- удобства: wifi, ac, child_seat, etc.
    cancelled_at        TIMESTAMP WITH TIME ZONE,           -- когда отменена (для фильтра в ленте)
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ============================================================
-- 4. ТАБЛИЦА СТАВОК
-- ============================================================
CREATE TABLE public.bids (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id     UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    bidder_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount      NUMERIC(10, 2) NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ============================================================
-- 5. ТАБЛИЦА ДИАЛОГОВ (прямые сообщения между пользователями)
-- ============================================================
CREATE TABLE public.conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user1_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    user2_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    ride_id         UUID REFERENCES public.rides(id) ON DELETE SET NULL, -- связь с поездкой (опц.)
    last_message    TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    UNIQUE (user1_id, user2_id)  -- один диалог между парой пользователей
);

-- ============================================================
-- 6. ТАБЛИЦА СООБЩЕНИЙ ЧАТА ПОЕЗДКИ (групповой чат)
-- ============================================================
CREATE TABLE public.messages (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id    UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    sender_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    is_read    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ============================================================
-- 7. ТАБЛИЦА ЛИЧНЫХ ДИАЛОГОВ (прямые сообщения 1-на-1)
-- ============================================================
CREATE TABLE public.direct_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ============================================================
-- 7. ТАБЛИЦА ОТЗЫВОВ И ОЦЕНОК
-- ============================================================
CREATE TABLE public.reviews (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id     UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    target_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment     TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    UNIQUE (ride_id, reviewer_id)  -- один отзыв на поездку от одного человека
);

-- ============================================================
-- 8. ТАБЛИЦА УВЕДОМЛЕНИЙ
-- ============================================================
CREATE TABLE public.notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN (
                    'new_bid',        -- новая ставка на вашу поездку
                    'auction_won',    -- вы выиграли аукцион
                    'auction_lost',   -- вы проиграли аукцион
                    'new_message',    -- новое сообщение
                    'ride_cancelled', -- поездка отменена
                    'review_received' -- получен отзыв
                )),
    title       TEXT NOT NULL,
    body        TEXT,
    ride_id     UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ============================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- USERS
CREATE POLICY "Все могут просматривать профили" ON public.users
    FOR SELECT USING (true);
CREATE POLICY "Пользователь создаёт свой профиль" ON public.users
    FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Пользователь обновляет свой профиль" ON public.users
    FOR UPDATE USING (auth.uid() = id);
-- Column-level protection: anon role cannot read sensitive contact fields.
-- Basic profile info (full_name, avatar_url, rating, trips_count) remains public.
REVOKE SELECT (phone, telegram, whatsapp, max, email) ON public.users FROM anon;

-- VEHICLES
CREATE POLICY "Все могут просматривать авто" ON public.vehicles
    FOR SELECT USING (true);
CREATE POLICY "Водитель управляет своими авто" ON public.vehicles
    FOR ALL USING (auth.uid() = driver_id);

-- RIDES
CREATE POLICY "Все могут просматривать поездки" ON public.rides
    FOR SELECT USING (true);
CREATE POLICY "Авторизованные создают поездки" ON public.rides
    FOR INSERT WITH CHECK (auth.uid() = creator_id);
-- UPDATE policy removed: all ride updates go through SECURITY DEFINER RPCs
-- (place_bid, close_auction_early, complete_trip, cancel_ride, accept_current_price)
-- which bypass RLS. Direct REST API updates are intentionally blocked.

-- BIDS
CREATE POLICY "Все могут просматривать ставки" ON public.bids
    FOR SELECT USING (true);
CREATE POLICY "Авторизованные делают ставки" ON public.bids
    FOR INSERT WITH CHECK (auth.uid() = bidder_id);

-- MESSAGES (ride group chat)
CREATE POLICY "Участники поездки видят сообщения" ON public.messages
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND (r.creator_id = auth.uid() OR r.winner_id = auth.uid()))
        OR EXISTS (SELECT 1 FROM public.bids b WHERE b.ride_id = messages.ride_id AND b.bidder_id = auth.uid())
    );
CREATE POLICY "Авторизованные отправляют сообщения в чат" ON public.messages
    FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Участники обновляют статус прочтения сообщений" ON public.messages
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND (r.creator_id = auth.uid() OR r.winner_id = auth.uid()))
        OR EXISTS (SELECT 1 FROM public.bids b WHERE b.ride_id = messages.ride_id AND b.bidder_id = auth.uid())
    );

-- CONVERSATIONS
CREATE POLICY "Участник видит свои диалоги" ON public.conversations
    FOR SELECT USING (auth.uid() = user1_id OR auth.uid() = user2_id);
CREATE POLICY "Участник создаёт диалоги" ON public.conversations
    FOR INSERT WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);
CREATE POLICY "Участник обновляет диалог" ON public.conversations
    FOR UPDATE USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- DIRECT_MESSAGES
CREATE POLICY "Участник видит сообщения в диалоге" ON public.direct_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
              AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
        )
    );
CREATE POLICY "Участник отправляет сообщения" ON public.direct_messages
    FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Участник обновляет статус прочтения" ON public.direct_messages
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
              AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
        )
    );

-- REVIEWS
CREATE POLICY "Все могут просматривать отзывы" ON public.reviews
    FOR SELECT USING (true);
CREATE POLICY "Авторизованные оставляют отзывы" ON public.reviews
    FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- NOTIFICATIONS
CREATE POLICY "Пользователь видит свои уведомления" ON public.notifications
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Система создаёт уведомления" ON public.notifications
    FOR INSERT WITH CHECK (false); -- Только через SECURITY DEFINER функции (они обходят RLS)

-- ============================================================
-- 10. RPC ФУНКЦИИ
-- ============================================================

-- Сделать ставку (защита от гонки)
CREATE OR REPLACE FUNCTION place_bid(
    p_ride_id   UUID,
    p_bidder_id UUID,
    p_amount    NUMERIC
) RETURNS jsonb AS $$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
BEGIN
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

    IF v_ride.creator_id = p_bidder_id THEN
        RAISE EXCEPTION 'Нельзя делать ставку на свою поездку';
    END IF;

    SELECT bidder_id INTO v_last_bidder
    FROM public.bids
    WHERE ride_id = p_ride_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_bidder = p_bidder_id THEN
        RAISE EXCEPTION 'Вы уже сделали последнюю ставку, дождитесь другого участника';
    END IF;

    -- Проверка шага ставки
    IF v_ride.type = 'request' THEN
        -- Пассажир создал запрос → водители снижают цену
        IF p_amount >= v_ride.current_price THEN
            RAISE EXCEPTION 'Ставка должна быть ниже текущей цены';
        END IF;
        IF (v_ride.current_price - p_amount) < v_ride.bid_step THEN
            RAISE EXCEPTION 'Шаг ставки должен быть не менее % рублей', v_ride.bid_step;
        END IF;
    ELSE
        -- Водитель создал предложение → пассажиры повышают цену
        IF p_amount <= v_ride.current_price THEN
            RAISE EXCEPTION 'Ставка должна быть выше текущей цены';
        END IF;
        IF (p_amount - v_ride.current_price) < v_ride.bid_step THEN
            RAISE EXCEPTION 'Шаг ставки должен быть не менее % рублей', v_ride.bid_step;
        END IF;
    END IF;

    -- Обновить текущую цену
    UPDATE public.rides SET current_price = p_amount WHERE id = p_ride_id;

    -- Записать ставку
    INSERT INTO public.bids (ride_id, bidder_id, amount)
    VALUES (p_ride_id, p_bidder_id, p_amount);

    -- Уведомить создателя поездки
    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (
        v_ride.creator_id,
        'new_bid',
        'Новая ставка на вашу поездку',
        'Поступила ставка: ' || p_amount || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'new_price', p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Завершить аукцион (вызывается Edge Function по таймеру)
CREATE OR REPLACE FUNCTION finish_auction(p_ride_id UUID) RETURNS jsonb AS $$
DECLARE
    v_ride   RECORD;
    v_winner UUID;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND OR v_ride.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'not_active');
    END IF;

    -- Найти победителя (последняя/лучшая ставка)
    SELECT bidder_id INTO v_winner
    FROM public.bids
    WHERE ride_id = p_ride_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_winner IS NULL THEN
        -- Ставок не было — отменить поездку
        UPDATE public.rides SET status = 'cancelled' WHERE id = p_ride_id;
        RETURN jsonb_build_object('success', true, 'status', 'cancelled');
    END IF;

    -- Перевести в booked (не completed — водитель сам нажмёт «Завершить»)
    UPDATE public.rides
    SET status = 'booked', winner_id = v_winner, auction_end_time = now()
    WHERE id = p_ride_id;

    -- Уведомить победителя
    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (v_winner, 'auction_won', 'Вы выиграли аукцион!',
            'Поздравляем! Поездка ' || v_ride.origin || ' → ' || v_ride.destination || ' ваша.',
            p_ride_id);

    -- Уведомить создателя поездки
    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (v_ride.creator_id, 'auction_won', 'Аукцион завершён',
            'Найден ' || (CASE WHEN v_ride.type = 'request' THEN 'водитель' ELSE 'пассажир' END),
            p_ride_id);

    RETURN jsonb_build_object('success', true, 'status', 'booked', 'winner_id', v_winner);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Оставить отзыв и обновить рейтинг
CREATE OR REPLACE FUNCTION submit_review(
    p_ride_id   UUID,
    p_target_id UUID,
    p_rating    INTEGER,
    p_comment   TEXT DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_reviewer UUID := auth.uid();
    v_ride     RECORD;
    v_avg      NUMERIC;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.status != 'completed' THEN
        RAISE EXCEPTION 'Поездка ещё не завершена';
    END IF;

    -- Только победитель может оставлять отзыв, и только о создателе
    IF v_ride.winner_id != v_reviewer THEN
        RAISE EXCEPTION 'Только победитель аукциона может оставлять отзывы';
    END IF;

    IF p_target_id != v_ride.creator_id THEN
        RAISE EXCEPTION 'Отзыв можно оставить только создателю поездки';
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Создать или найти диалог между двумя пользователями
CREATE OR REPLACE FUNCTION get_or_create_conversation(
    p_other_user_id UUID,
    p_ride_id       UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_me    UUID := auth.uid();
    v_u1    UUID;
    v_u2    UUID;
    v_conv  UUID;
BEGIN
    -- Нормализовать порядок (меньший UUID = user1)
    IF v_me < p_other_user_id THEN
        v_u1 := v_me; v_u2 := p_other_user_id;
    ELSE
        v_u1 := p_other_user_id; v_u2 := v_me;
    END IF;

    SELECT id INTO v_conv FROM public.conversations
    WHERE user1_id = v_u1 AND user2_id = v_u2;

    IF v_conv IS NULL THEN
        INSERT INTO public.conversations (user1_id, user2_id, ride_id)
        VALUES (v_u1, v_u2, p_ride_id)
        RETURNING id INTO v_conv;
    END IF;

    RETURN v_conv;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Принять текущую цену (открыть аукцион для первой ставки)
CREATE OR REPLACE FUNCTION accept_current_price(
    p_ride_id   UUID,
    p_bidder_id UUID
) RETURNS jsonb AS $$
DECLARE
    v_ride RECORD;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.status != 'active' THEN
        RAISE EXCEPTION 'Аукцион уже завершён';
    END IF;

    IF v_ride.creator_id = p_bidder_id THEN
        RAISE EXCEPTION 'Нельзя делать ставку на свою поездку';
    END IF;

    -- Записать первую ставку (принятие текущей цены)
    INSERT INTO public.bids (ride_id, bidder_id, amount)
    VALUES (p_ride_id, p_bidder_id, v_ride.current_price);

    -- Уведомить создателя
    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (
        v_ride.creator_id,
        'new_bid',
        'Водитель согласился с ценой!',
        'Ставка: ' || v_ride.current_price || ' ₽',
        p_ride_id
    );

    RETURN jsonb_build_object('success', true, 'amount', v_ride.current_price);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Закрыть аукцион раньше (выбрать текущую лучшую ставку победителем)
-- Переводит поездку active → booked; водитель завершает поездку через complete_trip.
CREATE OR REPLACE FUNCTION close_auction_early(p_ride_id UUID) RETURNS jsonb AS $$
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
    VALUES (v_winner_id, 'auction_won', 'Вы выиграли аукцион!', NULL, p_ride_id);

    RETURN jsonb_build_object('success', true, 'winner_id', v_winner_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Завершить поездку (действие водителя после фактической поездки)
-- Переводит поездку booked → completed; пассажир может оставить отзыв.
CREATE OR REPLACE FUNCTION complete_trip(p_ride_id UUID) RETURNS jsonb AS $$
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

    UPDATE public.users
    SET trips_count = trips_count + 1
    WHERE id IN (v_ride.creator_id, v_ride.winner_id);

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Отменить поездку
CREATE OR REPLACE FUNCTION cancel_ride(p_ride_id UUID) RETURNS jsonb AS $$
DECLARE
    v_ride RECORD;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.status != 'active' THEN
        RAISE EXCEPTION 'Можно отменить только активные поездки';
    END IF;

    -- Отменить поездку
    UPDATE public.rides SET status = 'cancelled', cancelled_at = now() WHERE id = p_ride_id;

    -- Уведомить всех участников (ставщиков)
    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    SELECT DISTINCT bidder_id, 'ride_cancelled', 'Поездка отменена', NULL, p_ride_id
    FROM public.bids
    WHERE ride_id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 11. ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_rides_status      ON public.rides(status);
CREATE INDEX idx_rides_type        ON public.rides(type);
CREATE INDEX idx_rides_creator     ON public.rides(creator_id);
CREATE INDEX idx_rides_auction_end ON public.rides(auction_end_time) WHERE status = 'active';
CREATE INDEX idx_bids_ride         ON public.bids(ride_id);
CREATE INDEX idx_bids_bidder       ON public.bids(bidder_id);
CREATE INDEX idx_messages_conv     ON public.direct_messages(conversation_id);
CREATE INDEX idx_reviews_target    ON public.reviews(target_id);
CREATE INDEX idx_notif_user        ON public.notifications(user_id, is_read);
