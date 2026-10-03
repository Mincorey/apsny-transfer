-- ============================================================================
-- SQL-тесты APSNY-TRANSFER: права доступа и денежно-аукционная логика.
-- ============================================================================
-- Запускается в CI после supabase-stub.sql и всех миграций на чистом
-- PostgreSQL 17. Каждая проверка при провале останавливает прогон с
-- понятным сообщением. Сценарии взяты из аудита 29.09.2026 — это те места,
-- где ошибка стоит денег, данных или приватности.
--
-- Локально:  psql -v ON_ERROR_STOP=1 -f supabase/tests/tests.sql
-- ============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

-- Помощники ------------------------------------------------------------------
-- Выполнить запрос от имени роли (и пользователя) и ждать ошибку с текстом.
create function pg_temp.must_fail(p_role text, p_uid text, p_sql text, p_pattern text, p_what text)
returns void language plpgsql as $$
declare v_err text; v_ok boolean := false;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  begin
    execute format('set local role %I', p_role);
    execute p_sql;
    v_ok := true;
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  if v_ok then
    raise exception 'ПРОВАЛ [%]: запрос прошёл, а должен был отказать: %', p_what, p_sql;
  end if;
  if v_err !~* p_pattern then
    raise exception 'ПРОВАЛ [%]: не та ошибка: «%» (ждали «%»)', p_what, v_err, p_pattern;
  end if;
  raise notice 'ок: %', p_what;
end $$;

-- Выполнить и ждать успех; вернуть результат (jsonb/text) для проверок.
create function pg_temp.must_pass(p_role text, p_uid text, p_sql text, p_what text)
returns text language plpgsql as $$
declare v_res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  begin
    execute format('set local role %I', p_role);
    execute p_sql into v_res;
  exception when others then
    reset role;
    raise exception 'ПРОВАЛ [%]: %', p_what, sqlerrm;
  end;
  reset role;
  raise notice 'ок: %', p_what;
  return v_res;
end $$;

create function pg_temp.check(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'ПРОВАЛ [%]', p_what; end if;
  raise notice 'ок: %', p_what;
end $$;

-- Без общей транзакции намеренно: у каждой ставки должно быть своё время
-- (now() внутри одной транзакции одинаковое, и «последняя ставка» стала бы
-- неразличима). База в CI одноразовая.

-- Данные ---------------------------------------------------------------------
-- Профили создаёт триггер на auth.users — заодно проверяем, что он работает.
insert into auth.users (id, email, raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001', 'p1@test', '{"full_name":"Пассажир 1","phone":"+79990000001","role":"passenger"}'),
 ('10000000-0000-0000-0000-000000000002', 'p2@test', '{"full_name":"Пассажир 2","phone":"+79990000002","role":"passenger"}'),
 ('10000000-0000-0000-0000-000000000003', 'd1@test', '{"full_name":"Водитель 1","phone":"+79990000003","role":"driver"}'),
 ('10000000-0000-0000-0000-000000000004', 'd2@test', '{"full_name":"Водитель 2","phone":"+79990000004","role":"driver"}');
select pg_temp.check((select count(*) from public.users where id::text like '10000000%') = 4,
  'регистрация создаёт профиль (триггер on_auth_user_created)');

\set P1 '10000000-0000-0000-0000-000000000001'
\set P2 '10000000-0000-0000-0000-000000000002'
\set D1 '10000000-0000-0000-0000-000000000003'
\set D2 '10000000-0000-0000-0000-000000000004'

-- Приватность ------------------------------------------------------------------
select pg_temp.must_fail('anon', null, 'select phone from public.users', 'permission denied', 'аноним не читает телефоны');
select pg_temp.must_fail('authenticated', :'P1', 'select phone from public.users', 'permission denied', 'пользователь не читает чужие телефоны напрямую');
select pg_temp.must_fail('anon', null, 'select email from public.users', 'permission denied', 'аноним не читает email');

-- В-1: госномера
insert into public.vehicles (id, driver_id, make_model, license_plate, capacity, is_active)
values ('20000000-0000-0000-0000-000000000001', :'D1', 'Kia Rio', 'А123ВС 01', 4, true);
select pg_temp.must_fail('anon', null, 'select license_plate from public.vehicles', 'permission denied', 'В-1: аноним не читает госномер');
select pg_temp.must_fail('authenticated', :'D2', 'select license_plate from public.vehicles', 'permission denied', 'В-1: чужой водитель не читает госномер');
select pg_temp.check(pg_temp.must_pass('authenticated', :'D1', 'select license_plate from public.get_my_vehicles() limit 1', 'В-1: владелец видит свой номер') = 'А123ВС 01', 'В-1: номер правильный');
select pg_temp.check(pg_temp.must_pass('authenticated', :'D2', 'select count(*) from public.get_my_vehicles()', 'В-1: get_my_vehicles чужого') = '0', 'В-1: чужие машины не отдаются');
select pg_temp.must_fail('anon', null, 'select * from public.get_my_vehicles()', 'permission denied', 'В-1: аноним не вызывает get_my_vehicles');

-- В-3: профиль с накруткой
-- Учётная запись без профиля (как если бы триггер не успел).
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values ('10000000-0000-0000-0000-000000000009', 'x@test');
alter table auth.users enable trigger on_auth_user_created;
select pg_temp.must_fail('authenticated', '10000000-0000-0000-0000-000000000009',
  $q$insert into public.users (id, email, full_name, phone, role, rating, trips_count) values ('10000000-0000-0000-0000-000000000009','x@test','X','+7','driver',5,200)$q$,
  'permission denied', 'В-3: нельзя создать профиль с рейтингом и поездками');
select pg_temp.must_pass('authenticated', '10000000-0000-0000-0000-000000000009',
  $q$insert into public.users (id, email, full_name, phone, role) values ('10000000-0000-0000-0000-000000000009','x@test','X','+7','driver') returning 1$q$,
  'В-3: запасной путь создания профиля работает');
select pg_temp.must_fail('authenticated', :'P1', $q$update public.users set rating = 5 where id = '10000000-0000-0000-0000-000000000001'$q$,
  'permission denied', 'нельзя поменять себе рейтинг');

-- Поездки ------------------------------------------------------------------------
-- С-1 (частично): статус при создании всегда draft.
select pg_temp.check(pg_temp.must_pass('authenticated', :'P1',
  $q$insert into public.rides (id, creator_id, type, origin, destination, departure_date, departure_time, seats, start_price, current_price, bid_step, auction_hours, status)
     values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'request', 'Сочи', 'Сухум', current_date + 2, '10:00', 1, 5000, 5000, 100, 6, 'active') returning status$q$,
  'создание поездки') = 'draft', 'поездка создаётся черновиком, даже если передать active');
select pg_temp.check(pg_temp.must_pass('anon', null, $q$select count(*) from public.rides where id = '30000000-0000-0000-0000-000000000001'$q$, 'чтение черновика анонимом') = '0', 'черновик не виден анониму');
select pg_temp.check(pg_temp.must_pass('anon', null, $q$select public.get_trip_view('30000000-0000-0000-0000-000000000001')::text$q$, 'get_trip_view черновика') is null, 'get_trip_view не отдаёт чужой черновик');
select pg_temp.must_fail('authenticated', :'P2', $q$select public.publish_ride_free('30000000-0000-0000-0000-000000000001')$q$, 'не ваша', 'чужой черновик не опубликовать');
select pg_temp.must_pass('authenticated', :'P1', $q$select public.publish_ride_free('30000000-0000-0000-0000-000000000001')::text$q$, 'владелец публикует черновик');
select pg_temp.must_fail('authenticated', :'P1', $q$select public.publish_ride_paid('x','x',100,'{}')$q$, 'permission denied', 'пользователь не вызывает publish_ride_paid');
select pg_temp.must_fail('anon', null, $q$select public.finish_auction('30000000-0000-0000-0000-000000000001')$q$, 'permission denied', 'аноним не вызывает finish_auction');

-- Ставки (запрос пассажира P1: торгуются водители, цена вниз) -----------------
select pg_temp.must_fail('authenticated', :'P2', $q$select public.place_bid('30000000-0000-0000-0000-000000000001', 4800)$q$, 'только водители', 'В-6: пассажир не ставит на запрос пассажира');
select pg_temp.must_fail('authenticated', :'D1', $q$select public.place_bid('30000000-0000-0000-0000-000000000001', -100)$q$, 'больше нуля', 'ставка ниже нуля отклоняется');
select pg_temp.must_fail('authenticated', :'D1', $q$select public.place_bid('30000000-0000-0000-0000-000000000001', 4950)$q$, 'Шаг ставки', 'шаг меньше bid_step отклоняется');
select pg_temp.must_fail('authenticated', :'P1', $q$select public.place_bid('30000000-0000-0000-0000-000000000001', 4800)$q$, 'свою поездку', 'нельзя ставить на свою поездку');
select pg_temp.must_pass('authenticated', :'D1', $q$select public.place_bid('30000000-0000-0000-0000-000000000001', 4800)::text$q$, 'водитель 1 ставит 4800');
select pg_temp.must_fail('authenticated', :'D1', $q$select public.place_bid('30000000-0000-0000-0000-000000000001', 4600)$q$, 'последнюю ставку', 'нельзя перебить самого себя');
select pg_temp.must_pass('authenticated', :'D2', $q$select public.place_bid('30000000-0000-0000-0000-000000000001', 4700)::text$q$, 'водитель 2 перебивает 4700');
select pg_temp.check((select current_price from public.rides where id = '30000000-0000-0000-0000-000000000001') = 4700
                 and (select bids_count  from public.rides where id = '30000000-0000-0000-0000-000000000001') = 2, 'цена и счётчик ставок обновились');

-- Закрытие аукциона и завершение поездки ----------------------------------------
select pg_temp.must_fail('anon', null, $q$select public.close_auction_early('30000000-0000-0000-0000-000000000001')$q$, 'permission denied|авторизация', 'аноним не закрывает аукцион');
select pg_temp.must_fail('authenticated', :'D1', $q$select public.close_auction_early('30000000-0000-0000-0000-000000000001')$q$, 'создатель', 'чужой не закрывает аукцион');
select pg_temp.must_pass('authenticated', :'P1', $q$select public.close_auction_early('30000000-0000-0000-0000-000000000001')::text$q$, 'создатель закрывает аукцион');
select pg_temp.check((select winner_id::text from public.rides where id = '30000000-0000-0000-0000-000000000001') = :'D2', 'победитель — последний ставивший');

-- Контакты открываются только сторонам сделки
select pg_temp.check(pg_temp.must_pass('authenticated', :'P1', $q$select public.get_trip_view('30000000-0000-0000-0000-000000000001')->'ride'->'winner'->>'phone'$q$, 'контакты победителя создателю') = '+79990000004', 'создатель видит телефон победителя');
select pg_temp.check(pg_temp.must_pass('authenticated', :'D1', $q$select public.get_trip_view('30000000-0000-0000-0000-000000000001')->'ride'->'winner'->>'phone'$q$, 'контакты победителя проигравшему') is null, 'проигравший не видит телефон победителя');

select pg_temp.must_fail('anon', null, $q$select public.complete_trip('30000000-0000-0000-0000-000000000001')$q$, 'permission denied|авторизация', 'аноним не завершает поездку');
select pg_temp.must_pass('authenticated', :'P1', $q$select public.complete_trip('30000000-0000-0000-0000-000000000001')::text$q$, 'создатель завершает поездку');
select pg_temp.check((select trips_count from public.users where id = :'P1') = 1
                 and (select trips_count from public.users where id = :'D2') = 1, 'счётчик поездок вырос ровно на 1 (без двойного счёта)');

-- Отзывы: только пассажир о водителе
select pg_temp.must_fail('authenticated', :'D2', $q$select public.submit_review('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 5, 'x')$q$, 'только пассажир', 'водитель не оценивает пассажира');
select pg_temp.must_pass('authenticated', :'P1', $q$select public.submit_review('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 4, 'ок')::text$q$, 'пассажир оценивает водителя');
select pg_temp.check((select rating from public.users where id = :'D2') = 4.0, 'рейтинг водителя пересчитан');

-- Предложение водителя: торгуются пассажиры, цена вверх -------------------------
select pg_temp.must_pass('authenticated', :'D1',
  $q$insert into public.rides (id, creator_id, type, origin, destination, departure_date, departure_time, seats, start_price, current_price, bid_step, auction_hours)
     values ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'offer', 'Сочи', 'Гагра', current_date + 2, '10:00', 3, 3000, 3000, 100, 6) returning 1$q$, 'водитель создаёт предложение');
select pg_temp.must_pass('authenticated', :'D1', $q$select public.publish_ride_free('30000000-0000-0000-0000-000000000002')::text$q$, 'водитель публикует');
select pg_temp.must_fail('authenticated', :'D2', $q$select public.accept_current_price('30000000-0000-0000-0000-000000000002')$q$, 'только пассажиры', 'В-6: водитель не торгуется за места у водителя');
select pg_temp.must_pass('authenticated', :'P1', $q$select public.accept_current_price('30000000-0000-0000-0000-000000000002')::text$q$, 'пассажир соглашается с ценой');
select pg_temp.must_fail('authenticated', :'P2', $q$select public.place_bid('30000000-0000-0000-0000-000000000002', 3050)$q$, 'Шаг ставки', 'шаг ставки вверх соблюдается');
select pg_temp.must_pass('authenticated', :'P2', $q$select public.place_bid('30000000-0000-0000-0000-000000000002', 3100)::text$q$, 'второй пассажир перебивает');

-- Служебное -------------------------------------------------------------------------
select pg_temp.must_fail('anon', null, 'select public.run_retention_cleanup()', 'permission denied', 'аноним не запускает чистку');
select pg_temp.must_fail('authenticated', :'P1', 'select public.tg_notify(''x'')', 'permission denied', 'пользователь не шлёт в Telegram');
select pg_temp.must_fail('authenticated', :'P1', $q$insert into public.notifications (user_id, type, title) values ('10000000-0000-0000-0000-000000000001','new_bid','x')$q$, 'permission denied|row-level', 'уведомления не создаются клиентом');


-- ============================================================================
-- Миграции 03.10.2026
-- ============================================================================

-- В-13: Storage — только своя папка ----------------------------------------
select pg_temp.must_fail('authenticated', :'D1',
  $q$insert into storage.objects (bucket_id, name) values ('avatars', '10000000-0000-0000-0000-000000000004/avatar.jpg')$q$,
  'row-level', 'В-13: нельзя положить файл в чужую папку');
select pg_temp.must_pass('authenticated', :'D1',
  $q$insert into storage.objects (bucket_id, name) values ('avatars', '10000000-0000-0000-0000-000000000003/avatar.jpg') returning 1$q$,
  'В-13: в свою папку можно');
select pg_temp.check(pg_temp.must_pass('authenticated', :'D2',
  $q$with d as (delete from storage.objects where name like '10000000-0000-0000-0000-000000000003/%' returning 1) select count(*) from d$q$,
  'В-13: попытка удалить чужой файл') = '0', 'В-13: чужой файл не удаляется');
select pg_temp.check((select file_size_limit = 5242880 and 'image/webp' = any(allowed_mime_types) from storage.buckets where id = 'avatars'),
  'В-13: у бакета есть лимит размера и типов');

-- С-21: чистка журнала pg_cron
select pg_temp.check(exists (select 1 from cron.job where jobname = 'cleanup-cron-history'), 'С-21: задача чистки журнала cron есть');

-- С-1: служебные поля при создании поездки ----------------------------------
select pg_temp.must_pass('authenticated', :'P2',
  $q$insert into public.rides (id, creator_id, type, origin, destination, departure_date, departure_time, seats, start_price, current_price, bid_step, auction_hours, bids_count, created_at, last_bid_at)
     values ('30000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', 'request', 'Адлер', 'Гагра', current_date + 2, '10:00', 1, 5000, 100, 100, 6, 500, '2000-01-01', now()) returning 1$q$,
  'С-1: создание поездки с подделанными полями');
select pg_temp.check((select bids_count = 0 and current_price = 5000 and created_at > now() - interval '1 hour' and last_bid_at is null
                      from public.rides where id = '30000000-0000-0000-0000-000000000010'),
  'С-1: счётчик, цена, даты выставлены базой');
select pg_temp.must_fail('authenticated', :'P2',
  $q$insert into public.rides (creator_id, type, origin, destination, departure_date, departure_time, seats, start_price, current_price, bid_step, auction_hours)
     values ('10000000-0000-0000-0000-000000000002', 'request', 'Адлер', 'Гагра', current_date - 1, '10:00', 1, 5000, 5000, 100, 6)$q$,
  'уже прошло', 'С-1: нельзя создать поездку в прошлом');
select pg_temp.must_fail('authenticated', :'D2',
  $q$insert into public.rides (creator_id, type, origin, destination, departure_date, departure_time, seats, start_price, current_price, bid_step, auction_hours, vehicle_id)
     values ('10000000-0000-0000-0000-000000000004', 'offer', 'Адлер', 'Гагра', current_date + 2, '10:00', 1, 5000, 5000, 100, 6, '20000000-0000-0000-0000-000000000001')$q$,
  'не принадлежит', 'С-1: нельзя указать чужую машину');

-- С-12: длины и адреса
select pg_temp.must_fail('authenticated', :'D2',
  $q$insert into public.vehicles (driver_id, make_model, license_plate, capacity) values ('10000000-0000-0000-0000-000000000004', repeat('x', 61), 'А1', 4)$q$,
  'vehicles_make_model_len', 'С-12: марка длиннее 60 символов отклоняется');
select pg_temp.must_fail('authenticated', :'D2',
  $q$insert into public.vehicles (driver_id, make_model, license_plate, capacity) values ('10000000-0000-0000-0000-000000000004', 'Lada', repeat('9', 16), 4)$q$,
  'vehicles_license_plate_len', 'С-12: номер длиннее 15 символов отклоняется');
select pg_temp.must_fail('authenticated', :'P1',
  $q$update public.users set avatar_url = 'https://evil.example/x.jpg' where id = '10000000-0000-0000-0000-000000000001'$q$,
  'users_avatar_url_own_storage', 'С-12: аватар только из своего хранилища');
select pg_temp.must_pass('authenticated', :'P1',
  $q$update public.users set avatar_url = 'https://x.supabase.co/storage/v1/object/public/avatars/10000000-0000-0000-0000-000000000001/avatar.jpg' where id = '10000000-0000-0000-0000-000000000001' returning 1$q$,
  'С-12: свой аватар сохраняется');

-- С-2: аукцион заканчивается не позже чем за час до выезда --------------------
select pg_temp.must_pass('authenticated', :'P2', format(
  $q$insert into public.rides (id, creator_id, type, origin, destination, departure_date, departure_time, seats, start_price, current_price, bid_step, auction_hours)
     values ('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000002', 'request', 'Сочи', 'Пицунда', %L, %L, 1, 5000, 5000, 100, 72) returning 1$q$,
  ((now() + interval '5 hours') at time zone 'Europe/Moscow')::date,
  date_trunc('minute', ((now() + interval '5 hours') at time zone 'Europe/Moscow'))::time), 'С-2: поездка через 5 часов, аукцион 72 часа');
select pg_temp.must_pass('authenticated', :'P2', $q$select public.publish_ride_free('30000000-0000-0000-0000-000000000011')::text$q$, 'С-2: публикация');
select pg_temp.check((select auction_end_time = ((departure_date + departure_time) at time zone 'Europe/Moscow') - interval '1 hour'
                      from public.rides where id = '30000000-0000-0000-0000-000000000011'),
  'С-2: конец аукциона — за час до выезда, а не через 72 часа');
select pg_temp.must_pass('authenticated', :'P2', format(
  $q$insert into public.rides (id, creator_id, type, origin, destination, departure_date, departure_time, seats, start_price, current_price, bid_step, auction_hours)
     values ('30000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000002', 'request', 'Сочи', 'Пицунда', %L, %L, 1, 5000, 5000, 100, 6) returning 1$q$,
  ((now() + interval '40 minutes') at time zone 'Europe/Moscow')::date,
  date_trunc('minute', ((now() + interval '40 minutes') at time zone 'Europe/Moscow'))::time), 'С-2: поездка через 40 минут');
select pg_temp.must_fail('authenticated', :'P2', $q$select public.publish_ride_free('30000000-0000-0000-0000-000000000012')$q$,
  'слишком мало времени', 'С-2: поздно публиковать — отказ');

-- В-7 и С-2: оплата после того, как публиковать поздно; платёж переживает поездку
select pg_temp.must_pass('authenticated', :'P2', $q$select public.start_ride_payment('30000000-0000-0000-0000-000000000012')$q$, 'В-7: счёт на оплату');
select pg_temp.check((select ride_route = 'Сочи → Пицунда' and ride_departure is not null from public.payments
                      where ride_id = '30000000-0000-0000-0000-000000000012'), 'В-7: в платёж скопированы маршрут и время');
select pg_temp.check((select public.publish_ride_paid(label, 'op-1', 100, '{}') ->> 'published' from public.payments
                      where ride_id = '30000000-0000-0000-0000-000000000012') = 'false',
  'С-2: оплата пришла поздно — платёж принят, поездка не опубликована (сигнал на возврат)');
select pg_temp.check((select status from public.rides where id = '30000000-0000-0000-0000-000000000012') = 'draft', 'С-2: поездка осталась черновиком');
delete from public.rides where id = '30000000-0000-0000-0000-000000000012';
select pg_temp.check((select count(*) from public.payments where operation_id = 'op-1' and ride_id is null and status = 'paid') = 1,
  'В-7: после удаления поездки оплаченный платёж остался');

-- В-7: черновик с недавним неоплаченным счётом не чистится
select pg_temp.must_pass('authenticated', :'P2',
  $q$insert into public.rides (id, creator_id, type, origin, destination, departure_date, departure_time, seats, start_price, current_price, bid_step, auction_hours)
     values ('30000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000002', 'request', 'Сочи', 'Гудаута', current_date + 3, '10:00', 1, 5000, 5000, 100, 6) returning 1$q$, 'В-7: черновик');
select pg_temp.must_pass('authenticated', :'P2', $q$select public.start_ride_payment('30000000-0000-0000-0000-000000000013')$q$, 'В-7: счёт по черновику');
update public.rides set created_at = now() - interval '2 days' where id = '30000000-0000-0000-0000-000000000013';
do $$ begin perform public.cleanup_unpaid_drafts(); end $$;
select pg_temp.check(exists (select 1 from public.rides where id = '30000000-0000-0000-0000-000000000013'), 'В-7: черновик со свежим счётом не удалён');
update public.payments set created_at = now() - interval '4 days' where ride_id = '30000000-0000-0000-0000-000000000013';
do $$ begin perform public.cleanup_unpaid_drafts(); end $$;
select pg_temp.check(not exists (select 1 from public.rides where id = '30000000-0000-0000-0000-000000000013'), 'В-7: черновик со старым счётом удалён');

-- С-22: ставки в одной транзакции — последняя действительно последняя ---------
select pg_temp.must_pass('authenticated', :'P2', $q$select public.publish_ride_free('30000000-0000-0000-0000-000000000010')::text$q$, 'С-22: публикация');
begin;
select pg_temp.must_pass('authenticated', :'D1', $q$select public.place_bid('30000000-0000-0000-0000-000000000010', 4800)::text$q$, 'С-22: ставка 1');
select pg_temp.must_pass('authenticated', :'D2', $q$select public.place_bid('30000000-0000-0000-0000-000000000010', 4700)::text$q$, 'С-22: ставка 2 в той же транзакции');
select pg_temp.check((select bidder_id::text from public.bids where ride_id = '30000000-0000-0000-0000-000000000010' order by created_at desc limit 1) = :'D2',
  'С-22: последней считается вторая ставка');
commit;

-- В-10: согласие при регистрации ---------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000005', 'p5@test', '{"full_name":"Пассажир 5","phone":"+79990000005","role":"passenger","consent_version":"2026-10-03"}');
select pg_temp.check((select consent_at is not null and consent_version = '2026-10-03' from public.users where id = '10000000-0000-0000-0000-000000000005'),
  'В-10: факт и редакция согласия сохранены');

-- В-10: сроки хранения
insert into public.notifications (user_id, type, title, created_at)
values ('10000000-0000-0000-0000-000000000005', 'new_bid', 'старое', now() - interval '2 years');
alter table public.contact_messages disable trigger user;
insert into public.contact_messages (name, message, created_at) values ('Старое', 'x', now() - interval '2 years'), ('Новое', 'y', now());
alter table public.contact_messages enable trigger user;
do $$ begin perform public.run_retention_cleanup(); end $$;
select pg_temp.check(not exists (select 1 from public.notifications where title = 'старое'), 'В-10: непрочитанные уведомления старше года удаляются');
select pg_temp.check((select string_agg(name, ',') from public.contact_messages) = 'Новое', 'В-10: обращения старше года удаляются, свежие остаются');
select pg_temp.check(exists (select 1 from public.rides where id = '30000000-0000-0000-0000-000000000001'), 'В-10: свежая завершённая поездка не тронута');

-- В-10: удаление аккаунта
select pg_temp.must_fail('authenticated', :'P1', $q$select public.anonymize_user('10000000-0000-0000-0000-000000000001')$q$, 'permission denied', 'В-10: пользователь не вызывает anonymize_user напрямую');
select pg_temp.must_fail('anon', null, $q$select public.anonymize_user('10000000-0000-0000-0000-000000000001')$q$, 'permission denied', 'В-10: аноним не вызывает anonymize_user');
select pg_temp.must_fail('service_role', null, $q$select public.anonymize_user('10000000-0000-0000-0000-000000000004')$q$, 'лидируете', 'В-10: лидер аукциона не удаляется до его конца');
-- P2 лидирует в предложении водителя (…002) — пусть P1 перебьёт, иначе удалить нельзя.
select pg_temp.must_fail('service_role', null, $q$select public.anonymize_user('10000000-0000-0000-0000-000000000002')$q$, 'лидируете', 'В-10: P2 пока лидирует');
select pg_temp.must_pass('authenticated', :'P1', $q$select public.place_bid('30000000-0000-0000-0000-000000000002', 3200)::text$q$, 'P1 перебивает P2');
-- P2: активный запрос с ставками (…010, …011) — снимаются, участники получают уведомление
select pg_temp.check((pg_temp.must_pass('service_role', null, $q$select public.anonymize_user('10000000-0000-0000-0000-000000000002')::text$q$, 'В-10: удаление аккаунта P2'))::jsonb ->> 'cancelled_rides' = '2',
  'В-10: активные поездки удалённого сняты');
select pg_temp.check((select full_name = 'Пользователь удалён' and phone = '—' and telegram is null and avatar_url is null
                      from public.users where id = '10000000-0000-0000-0000-000000000002'), 'В-10: профиль обезличен');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '10000000-0000-0000-0000-000000000004'
                      and type = 'ride_cancelled' and ride_id = '30000000-0000-0000-0000-000000000010'), 'В-10: участники аукциона предупреждены');
select pg_temp.check(exists (select 1 from public.payments where operation_id = 'op-1'), 'В-10: платежи удалённого сохранены');

\echo 'ВСЕ SQL-ТЕСТЫ ПРОЙДЕНЫ'
