-- Аудит 29.09.2026, пункты К-2 и В-5 — укрепление проверки владельца.
--
-- В пяти функциях проверка «это ваша поездка» записана как
--     IF v_ride.creator_id != auth.uid() THEN RAISE ...
-- Для анонима auth.uid() = NULL, сравнение с NULL даёт «неизвестно», и IF
-- молча пропускает. Сейчас на бою это не дыра: у anon нет права вызывать
-- эти функции. Но защита держится на одном отозванном праве — стоит его
-- потерять (например, при переносе базы, см. К-3), и аноним сможет
-- закрыть чужой аукцион или завершить чужую поездку. Проверено на стенде.
--
-- Здесь — вторая линия: явная проверка входа и сравнение через
-- IS DISTINCT FROM, которое с NULL работает правильно. Логика функций
-- не меняется — тексты боевые на 29.09.2026. Права не трогаем:
-- CREATE OR REPLACE сохраняет существующие.

create or replace function public.close_auction_early(p_ride_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

create or replace function public.complete_trip(p_ride_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

create or replace function public.delete_unpaid_draft(p_ride_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

create or replace function public.publish_ride_free(p_ride_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

create or replace function public.start_ride_payment(p_ride_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
