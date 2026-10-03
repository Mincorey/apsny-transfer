-- ============================================================================
-- Применение миграций от 03.10.2026 на боевой базе (Supabase SQL Editor)
-- ============================================================================
-- Это просто 7 файлов из supabase/migrations/2026100310*.sql подряд —
-- для одной вставки в SQL Editor. Источник правды — сами файлы.
--
-- Порядок:
--   1. Supabase Dashboard → проект uprcnpgmmnvsoxasuhun → SQL Editor.
--   2. Вставить весь этот файл → Run. Всё выполняется одной транзакцией:
--      если что-то упадёт, не применится ничего.
--   3. Выполнить deploy/migrate/verify-grants.sql. Строка ИТОГО должна быть
--      fd8ce236a5b3 (как в supabase/tests/expected-fingerprint.txt).
--   4. Задеплоить функцию delete-account (см. MOVING_CHECKLIST / ниже в CHANGELOG).
--   5. Authentication → URL Configuration → Redirect URLs: добавить
--      https://<ваш домен>/reset-password
-- ============================================================================

begin;

-- >>>>>>>>>>>>>>>> 20261003100000_storage_avatars_owner_only.sql

-- Аудит 29.09.2026, пункт В-13: любой вошедший мог перезаписать чужой
-- аватар и фото машины.
--
-- Было (политики Storage на бакете avatars):
--   INSERT  to authenticated  WITH CHECK (bucket_id = 'avatars')
--   UPDATE  to authenticated  USING      (bucket_id = 'avatars')
-- — ни слова о владельце. Файлы лежат по пути <id пользователя>/..., id
-- публичны, и одного запроса upload(..., { upsert: true }) хватало, чтобы
-- подменить чужую картинку. Сам бакет был без ограничений размера и типа.
--
-- Стало:
--   • писать, менять и удалять можно только в своей папке
--     (первая часть пути = auth.uid());
--   • появилась политика DELETE — раньше её не было, и удаление старого фото
--     из Profile.tsx молча не срабатывало, файлы копились;
--   • бакет принимает только JPEG / PNG / WebP до 5 МБ — проверяет сервер,
--     а не только браузер.
-- Чтение (Public can read avatars) не меняется: аватары публичные.

drop policy if exists "Authenticated users can upload" on storage.objects;
drop policy if exists "Authenticated users can update" on storage.objects;

create policy avatars_insert_own on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_update_own on storage.objects
  as permissive for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_delete_own on storage.objects
  as permissive for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

update storage.buckets
set file_size_limit    = 5242880,  -- 5 МБ
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'avatars';

-- >>>>>>>>>>>>>>>> 20261003100100_cron_history_cleanup.sql

-- Аудит 29.09.2026, пункт С-21: журнал запусков pg_cron занимал 79 % базы.
--
-- cron.job_run_details получает строку на каждый запуск каждой задачи.
-- Закрытие аукционов идёт раз в минуту — это 1 440 строк в сутки, и их
-- никто не удалял: на 29.09 было 319 537 строк и 50 МБ из 63 МБ базы.
-- Данных сервиса на этом фоне — килобайты; бэкапы в основном состояли бы
-- из журнала.
--
-- Неделя истории — с запасом для разбора любого сбоя.

select cron.unschedule('cleanup-cron-history')
where exists (select 1 from cron.job where jobname = 'cleanup-cron-history');

select cron.schedule(
  'cleanup-cron-history',
  '30 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);

-- Разовая чистка накопленного. Место освободится для новых строк сразу;
-- чтобы вернуть его файловой системе, можно позже выполнить
-- VACUUM FULL cron.job_run_details (вне транзакции, в SQL Editor).
delete from cron.job_run_details where end_time < now() - interval '7 days';

-- >>>>>>>>>>>>>>>> 20261003100200_rides_create_guard_and_lengths.sql

-- Аудит 29.09.2026, пункты С-1 и С-12.
--
-- С-1. У авторизованного пользователя право INSERT на все колонки rides
-- (так задумано: поездку создаёт сам пользователь). Триггер force_ride_draft
-- сбрасывал только status, auction_end_time и winner_id. Проходили:
--   • bids_count = 500, current_price ≠ start_price, last_bid_at, cancelled_at;
--   • created_at = 2000-01-01;
--   • дата выезда в прошлом (форма не даёт, база давала);
--   • ЧУЖОЙ автомобиль в vehicle_id — на карточке поездки была бы чужая машина.
-- Теперь триггер сам выставляет все служебные поля и проверяет дату и машину.
--
-- С-12. Без ограничения длины были марка и номер машины, отзыв, адреса фото.
-- Проверено на стенде: марка и номер принимали по 100 000 символов.
-- Адреса аватара и фото машины — только своё хранилище или пусто (раньше в
-- профиль можно было записать любой внешний адрес).

create or replace function public.force_ride_draft()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Статус и аукцион — только через публикацию.
  new.status           := 'draft';
  new.auction_end_time := null;
  new.winner_id        := null;
  -- Служебные поля — не из запроса клиента.
  new.current_price    := new.start_price;
  new.bids_count       := 0;
  new.last_bid_at      := null;
  new.cancelled_at     := null;
  new.created_at       := now();

  -- Время выезда — по Москве, как во всех остальных функциях проекта.
  if ((new.departure_date + new.departure_time) at time zone 'Europe/Moscow') <= now() then
    raise exception 'Время выезда уже прошло';
  end if;

  if new.vehicle_id is not null and not exists (
       select 1 from public.vehicles v
       where v.id = new.vehicle_id and v.driver_id = new.creator_id) then
    raise exception 'Автомобиль не принадлежит автору поездки';
  end if;

  return new;
end;
$function$;

-- Функция триггерная: вызывать её через API незачем.
revoke all on function public.force_ride_draft() from public, anon, authenticated;

-- С-12: длины и адреса.
-- Сначала приводим к правилам то, что уже лежит в базе, иначе ограничение
-- не добавится. На бою 29.09 таких строк не было, это страховка.
update public.vehicles set make_model = left(btrim(make_model), 60)
 where length(btrim(make_model)) > 60;
update public.vehicles set make_model = '—' where length(btrim(make_model)) = 0;
update public.vehicles set license_plate = left(btrim(license_plate), 15)
 where length(btrim(license_plate)) > 15;
update public.vehicles set license_plate = '—' where length(btrim(license_plate)) = 0;
update public.vehicles set photo_url = null
 where photo_url !~ '^https://[^/]+/storage/v1/object/public/avatars/';
update public.reviews set comment = left(comment, 1000) where length(comment) > 1000;
update public.users set avatar_url = null
 where avatar_url !~ '^https://[^/]+/storage/v1/object/public/avatars/';

alter table public.vehicles
  add constraint vehicles_make_model_len
    check (length(btrim(make_model)) between 1 and 60),
  add constraint vehicles_license_plate_len
    check (length(btrim(license_plate)) between 1 and 15),
  add constraint vehicles_photo_url_own_storage
    check (photo_url is null or photo_url ~ '^https://[^/]+/storage/v1/object/public/avatars/');

alter table public.reviews
  add constraint reviews_comment_len
    check (comment is null or length(comment) <= 1000);

alter table public.users
  add constraint users_avatar_url_own_storage
    check (avatar_url is null or avatar_url ~ '^https://[^/]+/storage/v1/object/public/avatars/');

-- >>>>>>>>>>>>>>>> 20261003100300_auction_ends_before_departure.sql

-- Аудит 29.09.2026, пункт С-2: аукцион мог закончиться после выезда.
--
-- publish_ride_free / publish_ride_paid ставили конец аукциона как
-- now() + auction_hours (до 72 часов) и не смотрели на время выезда:
-- поездка завтра в 10:00 с аукционом на 72 часа «торговалась» бы ещё двое
-- суток после отъезда. Черновик можно было опубликовать и через неделю —
-- когда выезд уже прошёл.
--
-- Правило: аукцион заканчивается не позже чем за ЧАС до выезда (чтобы
-- стороны успели созвониться), а если до этого момента осталось меньше
-- 15 минут — публиковать поздно.
--
-- publish_ride_paid вызывается вебхуком уже ПОСЛЕ оплаты: отказать там
-- нельзя, деньги получены. Если опубликовать поздно — платёж помечается
-- оплаченным, поездка остаётся черновиком, администратору уходит сообщение
-- «нужен возврат».

create or replace function public.ride_auction_end(p_departure_date date, p_departure_time time, p_hours integer)
 returns timestamptz
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $$
  select least(
    now() + make_interval(hours => coalesce(p_hours, 6)),
    ((p_departure_date + p_departure_time) at time zone 'Europe/Moscow') - interval '1 hour'
  );
$$;

revoke all on function public.ride_auction_end(date, time, integer) from public, anon, authenticated;

create or replace function public.publish_ride_free(p_ride_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ride record;
  v_uid  uuid := auth.uid();
  v_end  timestamptz;
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

  v_end := public.ride_auction_end(v_ride.departure_date, v_ride.departure_time, v_ride.auction_hours);
  if v_end < now() + interval '15 minutes' then
    raise exception 'До выезда слишком мало времени: аукцион заканчивается за час до выезда. Измените дату или время поездки';
  end if;

  update public.rides
  set status = 'active', auction_end_time = v_end
  where id = p_ride_id;

  return jsonb_build_object('ok', true, 'auction_end_time', v_end);
end;
$function$;

create or replace function public.publish_ride_paid(p_label text, p_operation_id text, p_withdraw numeric, p_raw jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pay  record;
  v_ride record;
  v_msg  text;
  v_end  timestamptz;
  v_published boolean := false;
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
    v_end := public.ride_auction_end(v_ride.departure_date, v_ride.departure_time, v_ride.auction_hours);
    if v_end >= now() + interval '15 minutes' then
      update public.rides
      set status = 'active', auction_end_time = v_end
      where id = v_ride.id;
      v_published := true;
    end if;
  end if;

  if not v_published then
    -- Деньги получены, а публиковать нечего или поздно — нужен возврат.
    perform public.tg_notify(
      '❗️ <b>Оплата есть, публикации нет — нужен возврат</b>' || E'\n' ||
      'Метка: ' || p_label || E'\n' ||
      'Операция: ' || coalesce(p_operation_id, '—') || E'\n' ||
      'Сумма: ' || v_pay.amount || ' ₽' || E'\n' ||
      case
        when v_ride.id is null then 'Причина: черновик поездки уже удалён'
        when v_ride.status <> 'draft' then 'Причина: поездка в статусе ' || v_ride.status
        else 'Причина: до выезда меньше часа с четвертью'
      end
    );
    return jsonb_build_object('ok', true, 'published', false);
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

  return jsonb_build_object('ok', true, 'published', true);
end;
$function$;

-- >>>>>>>>>>>>>>>> 20261003100400_bids_exact_time.sql

-- Аудит 29.09.2026, пункт С-22: «последняя ставка» по времени начала транзакции.
--
-- Победитель аукциона и запрет «перебить самого себя» определяются как
-- ORDER BY created_at DESC по таблице bids, а created_at заполнялся now() —
-- временем НАЧАЛА транзакции. Две ставки в одну долю секунды: транзакция B
-- начинается чуть раньше A, ждёт блокировку строки поездки, которую взяла A,
-- и вставляет свою ставку уже по новой цене, но с более ранним временем.
-- «Последней» оказывалась ставка A — победителем назначили бы не того.
--
-- clock_timestamp() — реальное время вставки. place_bid и
-- accept_current_price вставляют ставку после SELECT ... FOR UPDATE по
-- поездке, то есть строго по очереди, — значит и время строго растёт.
-- Функции переписывать не нужно: они не передают created_at, работает
-- значение по умолчанию.

alter table public.bids
  alter column created_at set default clock_timestamp();

-- >>>>>>>>>>>>>>>> 20261003100500_payments_survive_ride_delete.sql

-- Аудит 29.09.2026, пункт В-7: платёжные записи удалялись вместе с поездкой.
--
-- payments.ride_id → rides ON DELETE CASCADE, а поездки удаляются
-- автоматически (отменённые — через 30 дней, неоплаченные черновики — через
-- сутки). Оплатил, опубликовал, отменил — через месяц записи о платеже нет.
-- А она нужна: доход самозанятого, возвраты, споры.
--
-- Теперь:
--   1) удаление поездки оставляет платёж, ride_id просто обнуляется;
--   2) в платёж при создании копируются маршрут и время выезда — запись
--      понятна и без поездки;
--   3) черновик с неоплаченным счётом моложе 3 суток не удаляется: банк
--      может прислать уведомление об оплате с задержкой.

alter table public.payments
  add column if not exists ride_route     text,
  add column if not exists ride_departure timestamptz;

alter table public.payments alter column ride_id drop not null;

alter table public.payments drop constraint payments_ride_id_fkey;
alter table public.payments
  add constraint payments_ride_id_fkey foreign key (ride_id)
  references public.rides(id) on delete set null;

-- Снимок поездки — триггером, чтобы не трогать функции оплаты.
create or replace function public.payments_fill_ride_snapshot()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.ride_id is not null and (new.ride_route is null or new.ride_departure is null) then
    select r.origin || ' → ' || r.destination,
           (r.departure_date + r.departure_time) at time zone 'Europe/Moscow'
      into new.ride_route, new.ride_departure
      from public.rides r
     where r.id = new.ride_id;
  end if;
  return new;
end;
$function$;

revoke all on function public.payments_fill_ride_snapshot() from public, anon, authenticated;

create trigger trg_payments_ride_snapshot
  before insert on public.payments
  for each row execute function public.payments_fill_ride_snapshot();

-- Заполнить для уже существующих платежей (на бою 29.09 их ноль).
update public.payments p
   set ride_route     = r.origin || ' → ' || r.destination,
       ride_departure = (r.departure_date + r.departure_time) at time zone 'Europe/Moscow'
  from public.rides r
 where r.id = p.ride_id and p.ride_route is null;

-- Квитанция: из платежа, а не из поездки, — и только плательщику.
create or replace function public.get_ride_receipt(p_ride_id uuid)
 returns table(ride_id uuid, origin text, destination text, departure_date date, departure_time time without time zone, amount numeric, operation_id text, label text, paid_at timestamp with time zone)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select p.ride_id,
         coalesce(r.origin, split_part(p.ride_route, ' → ', 1)),
         coalesce(r.destination, split_part(p.ride_route, ' → ', 2)),
         coalesce(r.departure_date, (p.ride_departure at time zone 'Europe/Moscow')::date),
         coalesce(r.departure_time, (p.ride_departure at time zone 'Europe/Moscow')::time),
         p.amount, p.operation_id, p.label, p.paid_at
  from public.payments p
  left join public.rides r on r.id = p.ride_id
  where p.ride_id = p_ride_id
    and p.status = 'paid'
    and p.user_id = auth.uid()
  order by p.paid_at desc
  limit 1;
$function$;

-- Черновики: не удалять, пока по ним может прийти оплата.
create or replace function public.cleanup_unpaid_drafts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  with del as (
    delete from public.rides r
    where r.status = 'draft'
      and r.created_at < now() - interval '24 hours'
      and not exists (
        select 1 from public.payments p
        where p.ride_id = r.id
          and (p.status = 'paid'
               or (p.status = 'pending' and p.created_at > now() - interval '3 days'))
      )
    returning r.id
  )
  select count(*) into n from del;
  return n;
end;
$function$;

-- >>>>>>>>>>>>>>>> 20261003100600_privacy_consent_retention_delete.sql

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

commit;
