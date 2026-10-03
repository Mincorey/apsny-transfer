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
