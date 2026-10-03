-- Аудит 29.09.2026, пункт В-10: согласие на обработку ПДн, сроки хранения,
-- удаление аккаунта.
--
-- 1. Согласие. С 01.09.2025 согласие оформляется отдельным документом
--    (страница /consent) и обязательной галочкой при регистрации. Факт и
--    редакцию согласия храним в профиле: consent_at, consent_version.
--    Сайт передаёт consent_version в метаданных регистрации, триггер
--    handle_new_user записывает его вместе со временем. У тех, кто
--    зарегистрировался раньше, поля пустые — это видно и честно.
--
-- 2. Сроки хранения приведены к тому, что написано в политике:
--      уведомления — прочитанные 30 дней, любые не дольше 1 года
--        (раньше непрочитанные не удалялись никогда);
--      обращения через форму — 1 год (раньше — никогда);
--      завершённые поездки со ставками и отзывами — 3 года после выезда
--        (раньше — никогда);
--      отменённые поездки — 30 дней (как и было).
--    Платежи не удаляются: ride_id у них обнуляется (пункт В-7).
--
-- 3. Удаление аккаунта. anonymize_user вызывается только сервером
--    (Edge Function delete-account) от имени service_role. Профиль не
--    удаляется физически, а обезличивается: на нём держатся чужие отзывы,
--    ставки и завершённые поездки второй стороны. Учётная запись в
--    auth.users после этого «мягко» удаляется функцией (email и телефон
--    стираются, войти больше нельзя).
--    Отметка о согласии (consent_at/consent_version) остаётся: это
--    подтверждение, что данные обрабатывались законно, пока аккаунт был.
--    Отказ, если удаление сломает сделку другому человеку:
--      • есть поездка с найденным попутчиком (booked) — свою или выигранную;
--      • пользователь лидирует в идущем аукционе.

alter table public.users
  add column if not exists consent_at      timestamptz,
  add column if not exists consent_version text;

alter table public.users
  add constraint users_consent_version_len
    check (consent_version is null or length(consent_version) <= 32);

-- Регистрация: то же, что было, плюс отметка о согласии.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_role    text;
  v_name    text;
  v_email   text;
  v_phone   text;
  v_consent text;
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

  -- Редакция согласия, которое человек отметил галочкой при регистрации.
  v_consent := left(nullif(trim(coalesce(NEW.raw_user_meta_data->>'consent_version','')), ''), 32);

  INSERT INTO public.users (id, email, full_name, phone, role, telegram, whatsapp,
                            consent_at, consent_version)
  VALUES (
    NEW.id,
    v_email,
    v_name,
    v_phone,
    v_role,
    left(nullif(trim(coalesce(NEW.raw_user_meta_data->>'telegram','')), ''), 64),
    left(nullif(trim(coalesce(NEW.raw_user_meta_data->>'whatsapp','')), ''), 64),
    CASE WHEN v_consent IS NOT NULL THEN now() END,
    v_consent
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

-- ─── Сроки хранения ─────────────────────────────────────────────────────────

create or replace function public.cleanup_old_notifications()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_deleted integer;
begin
    delete from public.notifications
    where (is_read = true and created_at < now() - interval '30 days')
       or created_at < now() - interval '1 year';
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$function$;

create or replace function public.cleanup_old_contact_messages()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_deleted integer;
begin
    delete from public.contact_messages
    where created_at < now() - interval '1 year';
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$function$;

create or replace function public.cleanup_old_completed_rides()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_deleted integer;
begin
    -- Ставки и отзывы уходят каскадом, платежи остаются (ride_id → null).
    delete from public.rides
    where status = 'completed'
      and departure_date < (now() at time zone 'Europe/Moscow')::date - interval '3 years';
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$function$;

create or replace function public.run_retention_cleanup()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    perform cleanup_old_notifications();
    perform cleanup_old_cancelled_rides();
    perform cleanup_old_contact_messages();
    perform cleanup_old_completed_rides();
end;
$function$;

revoke all on function public.cleanup_old_contact_messages() from public, anon, authenticated;
revoke all on function public.cleanup_old_completed_rides()  from public, anon, authenticated;

-- ─── Удаление аккаунта ──────────────────────────────────────────────────────

create or replace function public.anonymize_user(p_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ride      record;
  v_cancelled integer := 0;
begin
  if p_user_id is null then
    raise exception 'Не указан пользователь';
  end if;

  perform 1 from public.users where id = p_user_id for update;
  if not found then
    raise exception 'Профиль не найден';
  end if;

  if exists (select 1 from public.rides
             where status = 'booked'
               and (creator_id = p_user_id or winner_id = p_user_id)) then
    raise exception 'У вас есть поездка с найденным попутчиком. Завершите её или договоритесь с второй стороной — после этого аккаунт можно удалить';
  end if;

  if exists (
      select 1
      from public.rides r
      where r.status = 'active'
        and r.creator_id <> p_user_id
        and (select b.bidder_id from public.bids b
             where b.ride_id = r.id
             order by b.created_at desc limit 1) = p_user_id) then
    raise exception 'Вы лидируете в идущем аукционе. Удалить аккаунт можно после его окончания';
  end if;

  -- Свои активные поездки снимаем, участников аукциона предупреждаем.
  for v_ride in
    select * from public.rides
    where creator_id = p_user_id and status = 'active'
    for update
  loop
    update public.rides
       set status = 'cancelled', cancelled_at = now()
     where id = v_ride.id;

    insert into public.notifications (user_id, type, title, body, ride_id)
    select distinct b.bidder_id, 'ride_cancelled', 'Поездка отменена',
           v_ride.origin || ' → ' || v_ride.destination
             || ' на ' || to_char(v_ride.departure_date, 'DD.MM.YYYY')
             || '. Создатель удалил аккаунт, ваша ставка аннулирована.',
           v_ride.id
    from public.bids b
    where b.ride_id = v_ride.id and b.bidder_id <> p_user_id;

    v_cancelled := v_cancelled + 1;
  end loop;

  -- Черновики никому не видны — удаляем (платежи остаются, пункт В-7).
  delete from public.rides where creator_id = p_user_id and status = 'draft';

  -- Машины: на которых есть поездки — обезличиваем, остальные удаляем.
  delete from public.vehicles v
   where v.driver_id = p_user_id
     and not exists (select 1 from public.rides r where r.vehicle_id = v.id);
  update public.vehicles
     set license_plate = '—', photo_url = null, is_active = false
   where driver_id = p_user_id;

  delete from public.notifications where user_id = p_user_id;

  update public.users
     set full_name       = 'Пользователь удалён',
         email           = p_user_id::text || '@deleted.invalid',
         phone           = '—',
         telegram        = null,
         whatsapp        = null,
         max             = null,
         avatar_url      = null,
         show_phone      = false,
         show_telegram   = false,
         show_whatsapp   = false,
         show_max        = false
   where id = p_user_id;

  return jsonb_build_object('ok', true, 'cancelled_rides', v_cancelled);
end;
$function$;

revoke all on function public.anonymize_user(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_user(uuid) to service_role;
