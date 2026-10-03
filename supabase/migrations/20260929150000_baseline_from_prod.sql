-- ============================================================================
-- APSNY-TRANSFER — ТОЧКА ОТСЧЁТА СХЕМЫ БАЗЫ (baseline)
-- ============================================================================
-- Снята с боевой базы 29.09.2026 (Supabase Cloud, проект uprcnpgmmnvsoxasuhun,
-- PostgreSQL 17.6) после миграций того же дня:
--   vehicles_get_my_vehicles, vehicles_hide_license_plate (В-1),
--   users_insert_column_grants (В-3), bids_role_check (В-6),
--   functions_owner_check_hardening (К-2 / В-5).
--
-- ЗАЧЕМ (аудит 29.09.2026, пункт В-5). До этого дня база и папка миграций
-- жили разной жизнью: часть изменений вносилась через SQL-редактор и в
-- репозиторий не попадала, часть файлов из репозитория на бою не применялась,
-- а собрать базу заново из репозитория было нельзя — сборка падала, а там,
-- где проходила, получалась база с дырами, которых на бою нет. Этот файл —
-- то, что есть на бою на самом деле. Всё, что было раньше, лежит в
-- supabase/_archive/ только для истории.
--
-- ПРАВИЛО С ЭТОГО ДНЯ: любое изменение базы — только новым файлом миграции
-- в supabase/migrations/ с уникальной меткой YYYYMMDDHHMMSS_. Не через
-- SQL-редактор панели. Иначе расхождение начнётся снова.
--
-- ЧТО ВНУТРИ: таблицы, ограничения, индексы, функции, триггеры (включая
-- триггер на auth.users), RLS и политики (включая Storage), права на таблицы,
-- колонки и функции, публикация Realtime, бакет Storage, задачи pg_cron.
-- ЧЕГО НЕТ: данных, секретов Vault (переносит deploy/migrate/migrate-db.sh),
-- схем auth/storage — их создаёт сам Supabase.
--
-- ПРОВЕРКА: база, собранная из этого файла, даёт тот же «отпечаток», что и
-- бой (deploy/migrate/verify-grants.sql; ожидаемые значения —
-- supabase/tests/expected-fingerprint.txt). Сверка идёт в CI при каждом push.
-- ============================================================================

-- Расширения. В Supabase они уже установлены; на голом PostgreSQL (CI)
-- ставятся, только если доступны.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- ТАБЛИЦЫ
-- ----------------------------------------------------------------------------

CREATE TABLE public.bids (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    ride_id uuid NOT NULL,
    bidder_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.contact_messages (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    email text,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    website text,
    client_ip text
);

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    ride_id uuid,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.payments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    label text NOT NULL,
    ride_id uuid NOT NULL,
    user_id uuid,
    amount numeric(10,2) DEFAULT 100 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    operation_id text,
    raw jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    paid_at timestamp with time zone
);

CREATE TABLE public.reviews (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    ride_id uuid NOT NULL,
    reviewer_id uuid NOT NULL,
    target_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.rides (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    type text NOT NULL,
    origin text NOT NULL,
    destination text NOT NULL,
    departure_date date NOT NULL,
    departure_time time without time zone NOT NULL,
    seats integer NOT NULL,
    start_price numeric(10,2) NOT NULL,
    current_price numeric(10,2) NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    border_crossing boolean DEFAULT false NOT NULL,
    comment text,
    bid_step integer DEFAULT 50 NOT NULL,
    auction_end_time timestamp with time zone,
    winner_id uuid,
    vehicle_id uuid,
    amenities text[] DEFAULT '{}'::text[],
    cancelled_at timestamp with time zone,
    bids_count integer DEFAULT 0 NOT NULL,
    last_bid_at timestamp with time zone,
    auction_hours smallint DEFAULT 6 NOT NULL
);

CREATE TABLE public.users (
    id uuid NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    telegram text,
    whatsapp text,
    avatar_url text,
    show_phone boolean DEFAULT false NOT NULL,
    show_telegram boolean DEFAULT true NOT NULL,
    show_whatsapp boolean DEFAULT true NOT NULL,
    rating numeric(3,1) DEFAULT 0 NOT NULL,
    trips_count integer DEFAULT 0 NOT NULL,
    max text,
    show_max boolean DEFAULT true
);

CREATE TABLE public.vehicles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    driver_id uuid NOT NULL,
    make_model text NOT NULL,
    license_plate text NOT NULL,
    capacity integer NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    photo_url text,
    is_active boolean DEFAULT false NOT NULL
);

-- ----------------------------------------------------------------------------
-- ПЕРВИЧНЫЕ КЛЮЧИ, UNIQUE, CHECK
-- ----------------------------------------------------------------------------

ALTER TABLE ONLY public.bids ADD CONSTRAINT bids_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bids ADD CONSTRAINT bids_amount_range CHECK (((amount > (0)::numeric) AND (amount <= (1000000)::numeric)));
ALTER TABLE ONLY public.contact_messages ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['new_bid'::text, 'auction_won'::text, 'auction_lost'::text, 'ride_cancelled'::text, 'review_received'::text])));
ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_label_key UNIQUE (label);
ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'underpaid'::text])));
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_ride_id_reviewer_id_key UNIQUE (ride_id, reviewer_id);
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_auction_hours_range CHECK (((auction_hours >= 1) AND (auction_hours <= 72)));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_bid_step_range CHECK (((bid_step >= 10) AND (bid_step <= 5000)));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_comment_len CHECK (((comment IS NULL) OR (length(comment) <= 1000)));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_current_price_range CHECK (((current_price > (0)::numeric) AND (current_price <= (1000000)::numeric)));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_destination_len CHECK (((length(btrim(destination)) >= 1) AND (length(btrim(destination)) <= 100)));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_origin_len CHECK (((length(btrim(origin)) >= 1) AND (length(btrim(origin)) <= 100)));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_seats_range CHECK (((seats >= 1) AND (seats <= 8)));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_start_price_range CHECK (((start_price > (0)::numeric) AND (start_price <= (1000000)::numeric)));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'booked'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_type_check CHECK ((type = ANY (ARRAY['request'::text, 'offer'::text])));
ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_full_name_len CHECK (((length(btrim(full_name)) >= 1) AND (length(btrim(full_name)) <= 100)));
ALTER TABLE ONLY public.users ADD CONSTRAINT users_max_len CHECK (((max IS NULL) OR (length(max) <= 64)));
ALTER TABLE ONLY public.users ADD CONSTRAINT users_phone_len CHECK (((length(btrim(phone)) >= 1) AND (length(btrim(phone)) <= 32)));
ALTER TABLE ONLY public.users ADD CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['passenger'::text, 'driver'::text])));
ALTER TABLE ONLY public.users ADD CONSTRAINT users_telegram_len CHECK (((telegram IS NULL) OR (length(telegram) <= 64)));
ALTER TABLE ONLY public.users ADD CONSTRAINT users_whatsapp_len CHECK (((whatsapp IS NULL) OR (length(whatsapp) <= 64)));
ALTER TABLE ONLY public.vehicles ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);

-- ----------------------------------------------------------------------------
-- ВНЕШНИЕ КЛЮЧИ
-- ----------------------------------------------------------------------------

ALTER TABLE ONLY public.bids ADD CONSTRAINT bids_bidder_id_fkey FOREIGN KEY (bidder_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bids ADD CONSTRAINT bids_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reviews ADD CONSTRAINT reviews_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);
ALTER TABLE ONLY public.rides ADD CONSTRAINT rides_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.vehicles ADD CONSTRAINT vehicles_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- ИНДЕКСЫ
-- ----------------------------------------------------------------------------

CREATE INDEX idx_bids_bidder ON public.bids USING btree (bidder_id);
CREATE INDEX idx_bids_ride ON public.bids USING btree (ride_id);
CREATE INDEX idx_bids_ride_created ON public.bids USING btree (ride_id, created_at DESC);
CREATE INDEX idx_contact_messages_created ON public.contact_messages USING btree (created_at);
CREATE INDEX idx_contact_messages_ip_created ON public.contact_messages USING btree (client_ip, created_at);
CREATE INDEX idx_notif_user ON public.notifications USING btree (user_id, is_read);
CREATE INDEX idx_notif_user_created ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX idx_notifications_ride_id ON public.notifications USING btree (ride_id);
CREATE INDEX idx_payments_ride ON public.payments USING btree (ride_id);
CREATE INDEX idx_payments_user ON public.payments USING btree (user_id);
CREATE INDEX idx_reviews_reviewer_id ON public.reviews USING btree (reviewer_id);
CREATE INDEX idx_reviews_ride_rev ON public.reviews USING btree (ride_id, reviewer_id);
CREATE INDEX idx_reviews_target ON public.reviews USING btree (target_id);
CREATE INDEX idx_rides_auction_end ON public.rides USING btree (auction_end_time) WHERE (status = 'active'::text);
CREATE INDEX idx_rides_cancelled_at ON public.rides USING btree (cancelled_at) WHERE (status = 'cancelled'::text);
CREATE INDEX idx_rides_creator ON public.rides USING btree (creator_id);
CREATE INDEX idx_rides_feed ON public.rides USING btree (type, created_at DESC) WHERE (status = ANY (ARRAY['active'::text, 'cancelled'::text]));
CREATE INDEX idx_rides_status ON public.rides USING btree (status);
CREATE INDEX idx_rides_type ON public.rides USING btree (type);
CREATE INDEX idx_rides_vehicle_id ON public.rides USING btree (vehicle_id);
CREATE INDEX idx_rides_winner_id ON public.rides USING btree (winner_id);
CREATE INDEX idx_vehicles_driver_id ON public.vehicles USING btree (driver_id);
CREATE UNIQUE INDEX uq_payments_operation ON public.payments USING btree (operation_id) WHERE (operation_id IS NOT NULL);

-- ----------------------------------------------------------------------------
-- ФУНКЦИИ
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_current_price(p_ride_id uuid, p_bidder_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_ride        RECORD;
    v_last_bidder UUID;
    v_bidder_id   UUID := auth.uid();
    v_title       TEXT;
    v_role        TEXT;
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

    -- В-6: соглашается с ценой только «другая сторона».
    SELECT role INTO v_role FROM public.users WHERE id = v_bidder_id;
    IF v_ride.type = 'request' AND v_role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Предлагать цену на запросы пассажиров могут только водители';
    END IF;
    IF v_ride.type = 'offer' AND v_role IS DISTINCT FROM 'passenger' THEN
        RAISE EXCEPTION 'Торговаться за места в поездке водителя могут только пассажиры';
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

CREATE OR REPLACE FUNCTION public.auto_complete_expired_rides()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- База в UTC, departure_time вводится по местному. Раньше приведение
    -- ::timestamptz считало местное время за UTC и завершало поездки на три
    -- часа позже задуманного. Пояс указан явно, а не смещением.
    UPDATE public.rides
    SET status = 'completed'
    WHERE status = 'booked'
      AND ((departure_date + departure_time) AT TIME ZONE 'Europe/Moscow')
          + INTERVAL '24 hours' < now();
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.cleanup_old_cancelled_rides()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_deleted integer;
BEGIN
    DELETE FROM public.rides
    WHERE status = 'cancelled'
      AND COALESCE(cancelled_at, created_at) < now() - INTERVAL '30 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_deleted integer;
BEGIN
    DELETE FROM public.notifications
    WHERE is_read = true
      AND created_at < now() - INTERVAL '30 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_unpaid_drafts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  with del as (
    delete from public.rides r
    where r.status = 'draft'
      and r.created_at < now() - interval '24 hours'
      and not exists (
        select 1 from public.payments p
        where p.ride_id = r.id and p.status = 'paid'
      )
    returning r.id
  )
  select count(*) into n from del;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_auction_early(p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ride      RECORD;
  v_winner_id UUID;
  v_uid       UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Поездка не найдена';
  END IF;

  IF v_ride.status != 'active' THEN
    RAISE EXCEPTION 'Аукцион уже завершён';
  END IF;

  IF v_ride.creator_id IS DISTINCT FROM v_uid THEN
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

  INSERT INTO public.notifications (user_id, type, title, body, ride_id)
  SELECT DISTINCT b.bidder_id, 'auction_lost', 'Аукцион завершён',
         'По поездке ' || v_ride.origin || ' → ' || v_ride.destination || ' выбрали другого участника.',
         p_ride_id
  FROM public.bids b
  WHERE b.ride_id = p_ride_id
    AND b.bidder_id <> v_winner_id;

  RETURN jsonb_build_object('success', true, 'winner_id', v_winner_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_expired_auctions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ride_id UUID;
BEGIN
  FOR v_ride_id IN
    SELECT id
    FROM public.rides
    WHERE status = 'active'
      AND auction_end_time IS NOT NULL
      AND auction_end_time < NOW()
  LOOP
    PERFORM finish_auction(v_ride_id);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_trip(p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ride RECORD;
  v_uid  UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Поездка не найдена';
  END IF;

  IF v_ride.status != 'booked' THEN
    RAISE EXCEPTION 'Поездка должна быть в статусе booked для завершения';
  END IF;

  IF v_ride.creator_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Только создатель поездки может завершить её';
  END IF;

  -- trips_count увеличивает триггер trg_sync_trips_count — здесь не трогаем.
  UPDATE public.rides SET status = 'completed' WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_unpaid_draft(p_ride_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ride record;
  v_uid  uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Требуется авторизация'; end if;
  select * into v_ride from public.rides where id = p_ride_id;
  if not found then return false; end if;
  if v_ride.creator_id is distinct from v_uid then
    raise exception 'Это не ваша поездка';
  end if;
  if v_ride.status <> 'draft' then
    raise exception 'Удалить можно только неоплаченный черновик';
  end if;
  delete from public.rides
  where id = p_ride_id and creator_id = v_uid and status = 'draft';
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_contact_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ip        text;
  v_ip_count  integer;
  v_total     integer;
BEGIN
  v_ip := NULL;
  BEGIN
    v_ip := nullif(btrim(current_setting('request.headers', true)::json->>'cf-connecting-ip'), '');
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  NEW.client_ip := v_ip;

  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_ip_count
    FROM public.contact_messages
    WHERE client_ip = v_ip AND created_at > now() - interval '1 hour';
    IF v_ip_count >= 3 THEN
      RAISE EXCEPTION 'Слишком много сообщений с вашего адреса. Попробуйте позже.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT count(*) INTO v_total
  FROM public.contact_messages
  WHERE created_at > now() - interval '1 hour';
  IF v_total >= 20 THEN
    RAISE EXCEPTION 'Форма временно перегружена. Попробуйте позже.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_single_active_vehicle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_active THEN
    UPDATE public.vehicles
       SET is_active = false
     WHERE driver_id = NEW.driver_id
       AND id <> NEW.id
       AND is_active = true;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_vehicle_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cnt integer;
BEGIN
  SELECT count(*) INTO cnt FROM public.vehicles WHERE driver_id = NEW.driver_id;
  IF cnt >= 3 THEN
    RAISE EXCEPTION 'VEHICLE_LIMIT_REACHED'
      USING HINT = 'Можно добавить не более 3 автомобилей';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_auction(p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_ride   RECORD;
    v_winner UUID;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
    IF NOT FOUND OR v_ride.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'not_active');
    END IF;
    IF v_ride.auction_end_time IS NULL OR v_ride.auction_end_time > now() THEN
        RETURN jsonb_build_object('success', false, 'reason', 'auction_not_expired');
    END IF;
    SELECT bidder_id INTO v_winner
    FROM public.bids WHERE ride_id = p_ride_id ORDER BY created_at DESC LIMIT 1;
    IF v_winner IS NULL THEN
        -- Ставок не было. Отмечаем время отмены — иначе поездка не попадёт
        -- в ленту как отменённая и просто исчезнет из выдачи.
        UPDATE public.rides SET status = 'cancelled', cancelled_at = now() WHERE id = p_ride_id;
        RETURN jsonb_build_object('success', true, 'status', 'cancelled');
    END IF;
    UPDATE public.rides SET status = 'booked', winner_id = v_winner, auction_end_time = now()
    WHERE id = p_ride_id;
    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (v_winner, 'auction_won', 'Вы выиграли аукцион!',
            'Поздравляем! Поездка ' || v_ride.origin || ' → ' || v_ride.destination || ' ваша.', p_ride_id);
    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (v_ride.creator_id, 'auction_won', 'Аукцион завершён',
            'Найден ' || (CASE WHEN v_ride.type = 'request' THEN 'водитель' ELSE 'пассажир' END), p_ride_id);
    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    SELECT DISTINCT b.bidder_id, 'auction_lost', 'Аукцион завершён',
           'По поездке ' || v_ride.origin || ' → ' || v_ride.destination || ' выбрали другого участника.', p_ride_id
    FROM public.bids b WHERE b.ride_id = p_ride_id AND b.bidder_id <> v_winner;
    RETURN jsonb_build_object('success', true, 'status', 'booked', 'winner_id', v_winner);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fmt_money(p_amount numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select replace(trim(to_char(round(p_amount), 'FM999G999G999')), ',', chr(160));
$function$;

CREATE OR REPLACE FUNCTION public.force_ride_draft()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.status           := 'draft';
  new.auction_end_time := null;
  new.winner_id        := null;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_my_vehicles()
 RETURNS SETOF public.vehicles
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select v.*
  from public.vehicles v
  where v.driver_id = auth.uid()
  order by v.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.get_ride_receipt(p_ride_id uuid)
 RETURNS TABLE(ride_id uuid, origin text, destination text, departure_date date, departure_time time without time zone, amount numeric, operation_id text, label text, paid_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.id, r.origin, r.destination, r.departure_date, r.departure_time,
         p.amount, p.operation_id, p.label, p.paid_at
  from public.rides r
  join public.payments p on p.ride_id = r.id and p.status = 'paid'
  where r.id = p_ride_id and r.creator_id = auth.uid()
  order by p.paid_at desc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_trip_view(p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid          uuid := auth.uid();
  v_auth         boolean := v_uid is not null;
  v_ride         public.rides;
  v_has_reviewed boolean := false;
  v_revealed     boolean;
  v_see_creator  boolean;
  v_see_winner   boolean;
  v_result       jsonb;
begin
  select * into v_ride from public.rides where id = p_ride_id;
  if not found then return null; end if;

  -- Черновик виден только автору. Для остальных его нет.
  if v_ride.status = 'draft' and (v_uid is null or v_uid <> v_ride.creator_id) then
    return null;
  end if;

  if v_ride.status = 'active'
     and v_ride.auction_end_time is not null
     and v_ride.auction_end_time < now() then
    perform public.finish_auction(p_ride_id);
    select * into v_ride from public.rides where id = p_ride_id;
  end if;

  v_revealed    := v_ride.status in ('booked','completed');
  v_see_creator := v_auth and v_revealed and (v_uid = v_ride.winner_id or v_uid = v_ride.creator_id);
  v_see_winner  := v_auth and v_revealed and (v_uid = v_ride.creator_id);

  if v_auth and v_ride.status = 'completed' and v_uid = v_ride.winner_id then
    select exists(select 1 from public.reviews where ride_id = p_ride_id and reviewer_id = v_uid)
      into v_has_reviewed;
  end if;

  v_result := jsonb_build_object(
    'ride',
      to_jsonb(v_ride) || jsonb_build_object(
        'creator', (
          select jsonb_build_object(
              'id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url,
              'rating', u.rating, 'trips_count', u.trips_count,
              'show_phone', u.show_phone, 'show_telegram', u.show_telegram,
              'show_whatsapp', u.show_whatsapp, 'show_max', u.show_max,
              'contacts_unlocked', v_see_creator,
              'phone',    case when v_see_creator then u.phone    when v_auth and u.show_phone    then u.phone    end,
              'telegram', case when v_see_creator then u.telegram when v_auth and u.show_telegram then u.telegram end,
              'whatsapp', case when v_see_creator then u.whatsapp when v_auth and u.show_whatsapp then u.whatsapp end,
              'max',      case when v_see_creator then u.max      when v_auth and u.show_max      then u.max      end)
          from public.users u where u.id = v_ride.creator_id),
        'winner', (
          select jsonb_build_object(
              'id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url,
              'contacts_unlocked', v_see_winner,
              'phone',    case when v_see_winner then u.phone    end,
              'telegram', case when v_see_winner then u.telegram end,
              'whatsapp', case when v_see_winner then u.whatsapp end,
              'max',      case when v_see_winner then u.max      end)
          from public.users u where u.id = v_ride.winner_id)),
    'bids', coalesce((
      select jsonb_agg(b.entry order by b.created_at desc)
      from (
        select bd.created_at,
          jsonb_build_object('id', bd.id, 'amount', bd.amount, 'created_at', bd.created_at,
            'bidder', case when bu.id is null then null else jsonb_build_object(
              'id', bu.id, 'full_name', bu.full_name, 'avatar_url', bu.avatar_url) end) as entry
        from public.bids bd
        left join public.users bu on bu.id = bd.bidder_id
        where bd.ride_id = p_ride_id
        order by bd.created_at desc
        limit 20) b), '[]'::jsonb),
    'has_reviewed', v_has_reviewed);

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_profile(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_own    boolean := v_uid is not null and v_uid = p_user_id;
  v_shared boolean := false;
  v_full   boolean;
  v_u      public.users;
begin
  select * into v_u from public.users where id = p_user_id;
  if not found then return null; end if;

  if v_uid is not null and not v_own then
    select exists (
      select 1 from public.rides r
      where r.status in ('booked','completed')
        and ((r.creator_id = v_uid and r.winner_id = p_user_id)
          or (r.creator_id = p_user_id and r.winner_id = v_uid))
    ) into v_shared;
  end if;

  v_full := v_own or v_shared;

  return jsonb_build_object(
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
    'contacts_unlocked', v_full,
    'phone',    case when v_full then v_u.phone    when v_uid is not null and v_u.show_phone    then v_u.phone    end,
    'telegram', case when v_full then v_u.telegram when v_uid is not null and v_u.show_telegram then v_u.telegram end,
    'whatsapp', case when v_full then v_u.whatsapp when v_uid is not null and v_u.show_whatsapp then v_u.whatsapp end,
    'max',      case when v_full then v_u.max      when v_uid is not null and v_u.show_max      then v_u.max      end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role  text;
  v_name  text;
  v_email text;
  v_phone text;
BEGIN
  v_role := NEW.raw_user_meta_data->>'role';
  IF v_role IS NULL OR v_role NOT IN ('passenger','driver') THEN
    v_role := 'passenger';
  END IF;

  v_name := left(trim(coalesce(NEW.raw_user_meta_data->>'full_name','')), 100);
  IF v_name = '' THEN
    v_name := 'Пользователь';
  END IF;

  -- Колонка email объявлена NOT NULL, а при входе по телефону его может не быть.
  v_email := coalesce(NEW.email, NEW.id::text || '@no-email.local');

  v_phone := left(trim(coalesce(NEW.raw_user_meta_data->>'phone','')), 32);

  INSERT INTO public.users (id, email, full_name, phone, role, telegram, whatsapp)
  VALUES (
    NEW.id,
    v_email,
    v_name,
    v_phone,
    v_role,
    left(nullif(trim(coalesce(NEW.raw_user_meta_data->>'telegram','')), ''), 64),
    left(nullif(trim(coalesce(NEW.raw_user_meta_data->>'whatsapp','')), ''), 64)
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;

EXCEPTION
  -- Профиль уже создан страховкой на клиенте — это не ошибка.
  -- Остальные ошибки намеренно НЕ перехватываются.
  WHEN unique_violation THEN
    RAISE WARNING 'handle_new_user: профиль для % уже существует (%)', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_paid_ride_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct p.ride_id
  from public.payments p
  join public.rides r on r.id = p.ride_id
  where p.status = 'paid'
    and r.creator_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.notify_contact_telegram()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'vault'
AS $function$
declare
  v_token text;
  v_chat  text;
  v_text  text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_chat_id';
  if v_token is null or v_chat is null then
    return new;
  end if;

  v_text :=
    '🆕 <b>Новое сообщение с сайта</b>' || E'\n' ||
    '<i>APSNY-TRANSFER · форма обратной связи</i>' || E'\n' ||
    '━━━━━━━━━━━━━━' || E'\n' ||
    '👤 <b>Имя:</b> ' || coalesce(replace(replace(replace(new.name,    '&','&amp;'),'<','&lt;'),'>','&gt;'), '—') || E'\n' ||
    '✉️ <b>Email:</b> ' || coalesce(replace(replace(replace(new.email,  '&','&amp;'),'<','&lt;'),'>','&gt;'), '— не указан') || E'\n' ||
    '🕒 <b>Время:</b> ' || to_char(new.created_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') || ' (МСК)' || E'\n' ||
    '━━━━━━━━━━━━━━' || E'\n' ||
    '💬 <b>Сообщение:</b>' || E'\n' ||
    coalesce(replace(replace(replace(new.message, '&','&amp;'),'<','&lt;'),'>','&gt;'), '—');

  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'chat_id', v_chat,
      'text', v_text,
      'parse_mode', 'HTML',
      'disable_web_page_preview', true
    ),
    timeout_milliseconds := 20000
  );

  return new;
end;
$function$;

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
    v_role        TEXT;
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

    -- В-6: торгуется только «другая сторона».
    SELECT role INTO v_role FROM public.users WHERE id = v_bidder_id;
    IF v_ride.type = 'request' AND v_role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Предлагать цену на запросы пассажиров могут только водители';
    END IF;
    IF v_ride.type = 'offer' AND v_role IS DISTINCT FROM 'passenger' THEN
        RAISE EXCEPTION 'Торговаться за места в поездке водителя могут только пассажиры';
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

CREATE OR REPLACE FUNCTION public.publish_ride_free(p_ride_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ride record;
  v_uid  uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Требуется авторизация'; end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'Поездка не найдена';
  end if;
  if v_ride.creator_id is distinct from v_uid then
    raise exception 'Это не ваша поездка';
  end if;
  if v_ride.status = 'active' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_ride.status <> 'draft' then
    raise exception 'Поездку нельзя опубликовать (неподходящий статус)';
  end if;

  update public.rides
  set status           = 'active',
      auction_end_time = now() + (coalesce(v_ride.auction_hours, 6) || ' hours')::interval
  where id = p_ride_id;

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_ride_paid(p_label text, p_operation_id text, p_withdraw numeric, p_raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pay  record;
  v_ride record;
  v_msg  text;
begin
  select * into v_pay from public.payments where label = p_label for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_label');
  end if;

  if v_pay.status = 'paid' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_withdraw + 0.001 < v_pay.amount then
    update public.payments
    set status = 'underpaid', operation_id = p_operation_id, raw = p_raw
    where id = v_pay.id;
    perform public.tg_notify(
      '⚠️ <b>Недоплата за публикацию</b>' || E'\n' ||
      'Метка: ' || p_label || E'\n' ||
      'Заплачено: ' || p_withdraw || ' ₽ из ' || v_pay.amount || ' ₽'
    );
    return jsonb_build_object('ok', false, 'reason', 'underpaid');
  end if;

  update public.payments
  set status = 'paid', operation_id = p_operation_id, raw = p_raw, paid_at = now()
  where id = v_pay.id;

  select * into v_ride from public.rides where id = v_pay.ride_id for update;
  if found and v_ride.status = 'draft' then
    update public.rides
    set status           = 'active',
        auction_end_time = now() + (coalesce(v_ride.auction_hours, 6) || ' hours')::interval
    where id = v_ride.id;
  end if;

  -- Красиво оформленная «квитанция» админу в Telegram.
  v_msg :=
    '🧾 <b>Оплачена публикация поездки</b>' || E'\n' ||
    '<i>APSNY-TRANSFER · квитанция</i>' || E'\n' ||
    '━━━━━━━━━━━━━━' || E'\n' ||
    '💰 <b>Сумма:</b> ' || trim(to_char(v_pay.amount, 'FM999990')) || ' ₽' || E'\n' ||
    '🚗 <b>Маршрут:</b> ' ||
      coalesce(replace(replace(replace(v_ride.origin,      '&','&amp;'),'<','&lt;'),'>','&gt;'), '?') ||
      ' → ' ||
      coalesce(replace(replace(replace(v_ride.destination, '&','&amp;'),'<','&lt;'),'>','&gt;'), '?') || E'\n' ||
    '📅 <b>Отправление:</b> ' ||
      to_char(v_ride.departure_date, 'DD.MM.YYYY') || ' ' ||
      to_char(v_ride.departure_time, 'HH24:MI') || E'\n' ||
    '💳 <b>Операция:</b> ' || coalesce(p_operation_id, '—') || E'\n' ||
    '🏷 <b>Метка:</b> ' || p_label || E'\n' ||
    '🕒 <b>Оплачено:</b> ' || to_char(now() at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') || ' (МСК)' || E'\n' ||
    '━━━━━━━━━━━━━━' || E'\n' ||
    '✅ Поездка опубликована, аукцион запущен';
  perform public.tg_notify(v_msg);

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_retention_cleanup()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    PERFORM cleanup_old_notifications();
    PERFORM cleanup_old_cancelled_rides();
    -- cleanup_old_completed_messages удалена вместе с чатом (10.08.2026)
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_ride_payment(p_ride_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ride  record;
  v_label text;
  v_uid   uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Требуется авторизация'; end if;
  select * into v_ride from public.rides where id = p_ride_id;
  if not found then raise exception 'Поездка не найдена'; end if;
  if v_ride.creator_id is distinct from v_uid then raise exception 'Это не ваша поездка'; end if;
  if v_ride.status <> 'draft' then raise exception 'Поездка уже опубликована'; end if;

  -- Переиспользуем существующий незакрытый платёж, если он есть.
  select label into v_label
  from public.payments
  where ride_id = p_ride_id and status = 'pending'
  order by created_at desc
  limit 1;

  if v_label is null then
    -- gen_random_uuid() (pg_catalog) вместо uuid_generate_v4() (схема extensions):
    -- у функции search_path=public, и uuid_generate_v4 из extensions внутри не виден.
    v_label := 'apsny_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.payments(label, ride_id, user_id, amount, status)
    values (v_label, p_ride_id, v_uid, 100, 'pending');
  end if;

  return v_label;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_review(p_ride_id uuid, p_target_id uuid, p_rating integer, p_comment text DEFAULT NULL::text)
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
            'Вам оставили отзыв с оценкой ' || p_rating || chr(160) || '⭐', p_ride_id);

    RETURN jsonb_build_object('success', true, 'new_rating', v_avg);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_trips_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- winner_id может быть NULL — тогда обновится только строка создателя.
  UPDATE public.users
  SET trips_count = trips_count + 1
  WHERE id IN (NEW.creator_id, NEW.winner_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_notify(p_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'vault'
AS $function$
declare v_token text; v_chat text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_chat_id';
  if v_token is null or v_chat is null then return; end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'chat_id', v_chat,
      'text', p_text,
      'parse_mode', 'HTML',
      'disable_web_page_preview', true
    ),
    timeout_milliseconds := 20000
  );
end;
$function$;

-- ----------------------------------------------------------------------------
-- ТРИГГЕРЫ
-- ----------------------------------------------------------------------------

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER trg_enforce_contact_rate_limit BEFORE INSERT ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION public.enforce_contact_rate_limit();
CREATE TRIGGER trg_notify_contact_telegram AFTER INSERT ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION public.notify_contact_telegram();
CREATE TRIGGER trg_force_ride_draft BEFORE INSERT ON public.rides FOR EACH ROW EXECUTE FUNCTION public.force_ride_draft();
CREATE TRIGGER trg_sync_trips_count AFTER UPDATE OF status ON public.rides FOR EACH ROW WHEN (((new.status = 'completed'::text) AND (old.status IS DISTINCT FROM 'completed'::text))) EXECUTE FUNCTION public.sync_trips_count();
CREATE TRIGGER trg_single_active_vehicle AFTER INSERT OR UPDATE OF is_active ON public.vehicles FOR EACH ROW WHEN ((new.is_active = true)) EXECUTE FUNCTION public.enforce_single_active_vehicle();
CREATE TRIGGER trg_vehicle_limit BEFORE INSERT ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.enforce_vehicle_limit();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- ПОЛИТИКИ (public и storage)
-- ----------------------------------------------------------------------------

CREATE POLICY bids_insert_auth ON public.bids AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = bidder_id));
CREATE POLICY bids_select_all ON public.bids AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY contact_insert_any ON public.contact_messages AS PERMISSIVE FOR INSERT TO public WITH CHECK ((((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 100)) AND ((length(btrim(message)) >= 1) AND (length(btrim(message)) <= 2000)) AND ((email IS NULL) OR (length(email) <= 200)) AND ((website IS NULL) OR (website = ''::text))));
CREATE POLICY notif_insert_none ON public.notifications AS PERMISSIVE FOR INSERT TO public WITH CHECK (false);
CREATE POLICY notif_select_own ON public.notifications AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY notif_update_own ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY reviews_insert_auth ON public.reviews AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = reviewer_id));
CREATE POLICY reviews_select_all ON public.reviews AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY rides_insert_auth ON public.rides AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = creator_id));
CREATE POLICY rides_select_published ON public.rides AS PERMISSIVE FOR SELECT TO public USING (((status <> 'draft'::text) OR (( SELECT auth.uid() AS uid) = creator_id)));
CREATE POLICY users_insert_own ON public.users AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY users_select_all ON public.users AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY users_update_own ON public.users AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = id)) WITH CHECK ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY vehicles_delete_own ON public.vehicles AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.uid() AS uid) = driver_id));
CREATE POLICY vehicles_insert_own ON public.vehicles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = driver_id));
CREATE POLICY vehicles_select_all ON public.vehicles AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY vehicles_update_own ON public.vehicles AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.uid() AS uid) = driver_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = driver_id));
CREATE POLICY "Authenticated users can update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING ((bucket_id = 'avatars'::text));
CREATE POLICY "Authenticated users can upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'avatars'::text));
CREATE POLICY "Public can read avatars" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'avatars'::text));

-- ----------------------------------------------------------------------------
-- ПРАВА НА ТАБЛИЦЫ И КОЛОНКИ
-- ----------------------------------------------------------------------------

REVOKE ALL ON TABLE public.bids FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.contact_messages FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.payments FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.reviews FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.rides FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vehicles FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE ON TABLE public.bids TO service_role;
GRANT DELETE ON TABLE public.contact_messages TO service_role;
GRANT DELETE ON TABLE public.notifications TO service_role;
GRANT DELETE ON TABLE public.payments TO service_role;
GRANT DELETE ON TABLE public.reviews TO service_role;
GRANT DELETE ON TABLE public.rides TO service_role;
GRANT DELETE ON TABLE public.users TO service_role;
GRANT DELETE ON TABLE public.vehicles TO authenticated;
GRANT DELETE ON TABLE public.vehicles TO service_role;
GRANT INSERT ON TABLE public.bids TO service_role;
GRANT INSERT ON TABLE public.contact_messages TO anon;
GRANT INSERT ON TABLE public.contact_messages TO authenticated;
GRANT INSERT ON TABLE public.contact_messages TO service_role;
GRANT INSERT ON TABLE public.notifications TO service_role;
GRANT INSERT ON TABLE public.payments TO service_role;
GRANT INSERT ON TABLE public.reviews TO service_role;
GRANT INSERT ON TABLE public.rides TO authenticated;
GRANT INSERT ON TABLE public.rides TO service_role;
GRANT INSERT ON TABLE public.users TO service_role;
GRANT INSERT ON TABLE public.vehicles TO authenticated;
GRANT INSERT ON TABLE public.vehicles TO service_role;
GRANT MAINTAIN ON TABLE public.bids TO anon;
GRANT MAINTAIN ON TABLE public.bids TO authenticated;
GRANT MAINTAIN ON TABLE public.bids TO service_role;
GRANT MAINTAIN ON TABLE public.contact_messages TO service_role;
GRANT MAINTAIN ON TABLE public.notifications TO anon;
GRANT MAINTAIN ON TABLE public.notifications TO authenticated;
GRANT MAINTAIN ON TABLE public.notifications TO service_role;
GRANT MAINTAIN ON TABLE public.payments TO service_role;
GRANT MAINTAIN ON TABLE public.reviews TO anon;
GRANT MAINTAIN ON TABLE public.reviews TO authenticated;
GRANT MAINTAIN ON TABLE public.reviews TO service_role;
GRANT MAINTAIN ON TABLE public.rides TO anon;
GRANT MAINTAIN ON TABLE public.rides TO authenticated;
GRANT MAINTAIN ON TABLE public.rides TO service_role;
GRANT MAINTAIN ON TABLE public.users TO anon;
GRANT MAINTAIN ON TABLE public.users TO authenticated;
GRANT MAINTAIN ON TABLE public.users TO service_role;
GRANT MAINTAIN ON TABLE public.vehicles TO authenticated;
GRANT MAINTAIN ON TABLE public.vehicles TO service_role;
GRANT REFERENCES ON TABLE public.bids TO service_role;
GRANT REFERENCES ON TABLE public.contact_messages TO service_role;
GRANT REFERENCES ON TABLE public.notifications TO service_role;
GRANT REFERENCES ON TABLE public.payments TO service_role;
GRANT REFERENCES ON TABLE public.reviews TO service_role;
GRANT REFERENCES ON TABLE public.rides TO service_role;
GRANT REFERENCES ON TABLE public.users TO service_role;
GRANT REFERENCES ON TABLE public.vehicles TO service_role;
GRANT SELECT ON TABLE public.bids TO anon;
GRANT SELECT ON TABLE public.bids TO authenticated;
GRANT SELECT ON TABLE public.bids TO service_role;
GRANT SELECT ON TABLE public.contact_messages TO service_role;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT SELECT ON TABLE public.notifications TO service_role;
GRANT SELECT ON TABLE public.payments TO service_role;
GRANT SELECT ON TABLE public.reviews TO anon;
GRANT SELECT ON TABLE public.reviews TO authenticated;
GRANT SELECT ON TABLE public.reviews TO service_role;
GRANT SELECT ON TABLE public.rides TO anon;
GRANT SELECT ON TABLE public.rides TO authenticated;
GRANT SELECT ON TABLE public.rides TO service_role;
GRANT SELECT ON TABLE public.users TO service_role;
GRANT SELECT ON TABLE public.vehicles TO service_role;
GRANT TRIGGER ON TABLE public.bids TO service_role;
GRANT TRIGGER ON TABLE public.contact_messages TO service_role;
GRANT TRIGGER ON TABLE public.notifications TO service_role;
GRANT TRIGGER ON TABLE public.payments TO service_role;
GRANT TRIGGER ON TABLE public.reviews TO service_role;
GRANT TRIGGER ON TABLE public.rides TO service_role;
GRANT TRIGGER ON TABLE public.users TO service_role;
GRANT TRIGGER ON TABLE public.vehicles TO service_role;
GRANT TRUNCATE ON TABLE public.bids TO service_role;
GRANT TRUNCATE ON TABLE public.contact_messages TO service_role;
GRANT TRUNCATE ON TABLE public.notifications TO service_role;
GRANT TRUNCATE ON TABLE public.payments TO service_role;
GRANT TRUNCATE ON TABLE public.reviews TO service_role;
GRANT TRUNCATE ON TABLE public.rides TO service_role;
GRANT TRUNCATE ON TABLE public.users TO service_role;
GRANT TRUNCATE ON TABLE public.vehicles TO service_role;
GRANT UPDATE ON TABLE public.bids TO service_role;
GRANT UPDATE ON TABLE public.contact_messages TO service_role;
GRANT UPDATE ON TABLE public.notifications TO service_role;
GRANT UPDATE ON TABLE public.payments TO service_role;
GRANT UPDATE ON TABLE public.reviews TO service_role;
GRANT UPDATE ON TABLE public.rides TO service_role;
GRANT UPDATE ON TABLE public.users TO service_role;
GRANT UPDATE ON TABLE public.vehicles TO authenticated;
GRANT UPDATE ON TABLE public.vehicles TO service_role;
GRANT INSERT (email) ON TABLE public.users TO authenticated;
GRANT INSERT (full_name) ON TABLE public.users TO authenticated;
GRANT INSERT (id) ON TABLE public.users TO authenticated;
GRANT INSERT (max) ON TABLE public.users TO authenticated;
GRANT INSERT (phone) ON TABLE public.users TO authenticated;
GRANT INSERT (role) ON TABLE public.users TO authenticated;
GRANT INSERT (telegram) ON TABLE public.users TO authenticated;
GRANT INSERT (whatsapp) ON TABLE public.users TO authenticated;
GRANT SELECT (avatar_url) ON TABLE public.users TO anon;
GRANT SELECT (avatar_url) ON TABLE public.users TO authenticated;
GRANT SELECT (capacity) ON TABLE public.vehicles TO anon;
GRANT SELECT (capacity) ON TABLE public.vehicles TO authenticated;
GRANT SELECT (created_at) ON TABLE public.users TO anon;
GRANT SELECT (created_at) ON TABLE public.users TO authenticated;
GRANT SELECT (created_at) ON TABLE public.vehicles TO anon;
GRANT SELECT (created_at) ON TABLE public.vehicles TO authenticated;
GRANT SELECT (driver_id) ON TABLE public.vehicles TO anon;
GRANT SELECT (driver_id) ON TABLE public.vehicles TO authenticated;
GRANT SELECT (full_name) ON TABLE public.users TO anon;
GRANT SELECT (full_name) ON TABLE public.users TO authenticated;
GRANT SELECT (id) ON TABLE public.users TO anon;
GRANT SELECT (id) ON TABLE public.users TO authenticated;
GRANT SELECT (id) ON TABLE public.vehicles TO anon;
GRANT SELECT (id) ON TABLE public.vehicles TO authenticated;
GRANT SELECT (is_active) ON TABLE public.vehicles TO anon;
GRANT SELECT (is_active) ON TABLE public.vehicles TO authenticated;
GRANT SELECT (make_model) ON TABLE public.vehicles TO anon;
GRANT SELECT (make_model) ON TABLE public.vehicles TO authenticated;
GRANT SELECT (photo_url) ON TABLE public.vehicles TO anon;
GRANT SELECT (photo_url) ON TABLE public.vehicles TO authenticated;
GRANT SELECT (rating) ON TABLE public.users TO anon;
GRANT SELECT (rating) ON TABLE public.users TO authenticated;
GRANT SELECT (role) ON TABLE public.users TO anon;
GRANT SELECT (role) ON TABLE public.users TO authenticated;
GRANT SELECT (show_max) ON TABLE public.users TO anon;
GRANT SELECT (show_max) ON TABLE public.users TO authenticated;
GRANT SELECT (show_phone) ON TABLE public.users TO anon;
GRANT SELECT (show_phone) ON TABLE public.users TO authenticated;
GRANT SELECT (show_telegram) ON TABLE public.users TO anon;
GRANT SELECT (show_telegram) ON TABLE public.users TO authenticated;
GRANT SELECT (show_whatsapp) ON TABLE public.users TO anon;
GRANT SELECT (show_whatsapp) ON TABLE public.users TO authenticated;
GRANT SELECT (trips_count) ON TABLE public.users TO anon;
GRANT SELECT (trips_count) ON TABLE public.users TO authenticated;
GRANT UPDATE (avatar_url) ON TABLE public.users TO authenticated;
GRANT UPDATE (full_name) ON TABLE public.users TO authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;
GRANT UPDATE (max) ON TABLE public.users TO authenticated;
GRANT UPDATE (phone) ON TABLE public.users TO authenticated;
GRANT UPDATE (show_max) ON TABLE public.users TO authenticated;
GRANT UPDATE (show_phone) ON TABLE public.users TO authenticated;
GRANT UPDATE (show_telegram) ON TABLE public.users TO authenticated;
GRANT UPDATE (show_whatsapp) ON TABLE public.users TO authenticated;
GRANT UPDATE (telegram) ON TABLE public.users TO authenticated;
GRANT UPDATE (whatsapp) ON TABLE public.users TO authenticated;

-- ----------------------------------------------------------------------------
-- ПРАВА НА ФУНКЦИИ
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.accept_current_price(p_ride_id uuid, p_bidder_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.auto_complete_expired_rides() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_ride(p_ride_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleanup_old_cancelled_rides() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleanup_old_notifications() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleanup_unpaid_drafts() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_auction_early(p_ride_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_expired_auctions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_trip(p_ride_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_unpaid_draft(p_ride_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_contact_rate_limit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_single_active_vehicle() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_vehicle_limit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finish_auction(p_ride_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fmt_money(p_amount numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.force_ride_draft() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_vehicles() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_ride_receipt(p_ride_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_trip_view(p_ride_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_user_profile(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_paid_ride_ids() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_contact_telegram() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.place_bid(p_ride_id uuid, p_amount numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_ride_free(p_ride_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_ride_paid(p_label text, p_operation_id text, p_withdraw numeric, p_raw jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.run_retention_cleanup() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_ride_payment(p_ride_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_review(p_ride_id uuid, p_target_id uuid, p_rating integer, p_comment text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_trips_count() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_notify(p_text text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_current_price(p_ride_id uuid, p_bidder_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_current_price(p_ride_id uuid, p_bidder_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_complete_expired_rides() TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_ride(p_ride_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride(p_ride_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_cancelled_rides() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_unpaid_drafts() TO service_role;
GRANT EXECUTE ON FUNCTION public.close_auction_early(p_ride_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_auction_early(p_ride_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_expired_auctions() TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_trip(p_ride_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_trip(p_ride_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_unpaid_draft(p_ride_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unpaid_draft(p_ride_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_contact_rate_limit() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_single_active_vehicle() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_vehicle_limit() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_auction(p_ride_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fmt_money(p_amount numeric) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.fmt_money(p_amount numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.fmt_money(p_amount numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fmt_money(p_amount numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.force_ride_draft() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_vehicles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_vehicles() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ride_receipt(p_ride_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ride_receipt(p_ride_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_trip_view(p_ride_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_trip_view(p_ride_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trip_view(p_ride_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_profile(p_user_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_profile(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_profile(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.list_paid_ride_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_paid_ride_ids() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_contact_telegram() TO service_role;
GRANT EXECUTE ON FUNCTION public.place_bid(p_ride_id uuid, p_amount numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bid(p_ride_id uuid, p_amount numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_ride_free(p_ride_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_ride_free(p_ride_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_ride_paid(p_label text, p_operation_id text, p_withdraw numeric, p_raw jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_retention_cleanup() TO service_role;
GRANT EXECUTE ON FUNCTION public.start_ride_payment(p_ride_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_ride_payment(p_ride_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_review(p_ride_id uuid, p_target_id uuid, p_rating integer, p_comment text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review(p_ride_id uuid, p_target_id uuid, p_rating integer, p_comment text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_trips_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_notify(p_text text) TO service_role;

-- ----------------------------------------------------------------------------
-- REALTIME
-- ----------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE public.bids;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;

-- ----------------------------------------------------------------------------
-- STORAGE: БАКЕТ
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('avatars', 'avatars', true, NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- PG_CRON: ЗАДАЧИ
-- ----------------------------------------------------------------------------

SELECT cron.unschedule('auto-close-expired-auctions') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-expired-auctions');
SELECT cron.schedule('auto-close-expired-auctions', '* * * * *', 'SELECT close_expired_auctions()');
SELECT cron.unschedule('auto-complete-expired-rides') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-complete-expired-rides');
SELECT cron.schedule('auto-complete-expired-rides', '0 * * * *', 'SELECT auto_complete_expired_rides()');
SELECT cron.unschedule('retention-cleanup') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention-cleanup');
SELECT cron.schedule('retention-cleanup', '0 3 * * *', 'SELECT run_retention_cleanup()');
SELECT cron.unschedule('cleanup-unpaid-drafts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-unpaid-drafts');
SELECT cron.schedule('cleanup-unpaid-drafts', '7 * * * *', ' select public.cleanup_unpaid_drafts(); ');
