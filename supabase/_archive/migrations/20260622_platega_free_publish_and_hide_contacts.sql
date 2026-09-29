-- ============================================================
-- 20260622_platega_free_publish_and_hide_contacts.sql
--
-- Переход с ЮMoney на платёжную систему Platega (platega.io).
-- На время подключения Platega и прохождения модерации:
--   1) Публикация поездки временно БЕСПЛАТНА. Поездка-черновик (draft)
--      публикуется сразу через новую RPC publish_ride_free (draft → active),
--      без оплаты. Кнопки «Оплатить … 100 ₽» в интерфейсе сохранены.
--   2) Контакты пользователей телефон / WhatsApp / MAX больше НЕ отдаются
--      другим пользователям (требование модерации Platega): видны только
--      имя, ник, почта и Telegram. Гейтящие функции get_trip_view и
--      get_user_profile переписаны так, что phone/whatsapp/max всегда NULL.
--
-- Откат: вернуть прежние версии функций из 20260613_p1_contact_privacy.sql
-- и заменить вызовы publish_ride_free обратно на оплату.
-- Все объекты идемпотентны (create or replace).
-- ============================================================

begin;

-- 1) Бесплатная публикация поездки владельцем (draft → active).
create or replace function public.publish_ride_free(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride record;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'Поездка не найдена';
  end if;
  if v_ride.creator_id <> auth.uid() then
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
$$;

revoke all on function public.publish_ride_free(uuid) from public;
grant execute on function public.publish_ride_free(uuid) to authenticated;

-- 2) Публичный профиль другого пользователя: телефон/WhatsApp/MAX скрыты всегда.
create or replace function public.get_user_profile(p_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_own    boolean := v_uid is not null and v_uid = p_user_id;
  v_shared boolean := false;
  v_u      public.users;
  v_base   jsonb;
begin
  select * into v_u from public.users where id = p_user_id;
  if not found then
    return null;
  end if;

  if v_uid is not null and not v_own then
    select exists (
      select 1 from public.rides r
      where r.status = 'completed'
        and ((r.creator_id = v_uid and r.winner_id = p_user_id)
          or (r.creator_id = p_user_id and r.winner_id = v_uid))
    ) into v_shared;
  end if;

  v_base := jsonb_build_object(
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
    -- Телефон / WhatsApp / MAX скрыты для всех (требование модерации Platega).
    'phone',    null,
    'whatsapp', null,
    'max',      null,
    'telegram', case when v_uid is not null and (v_own or v_shared or v_u.show_telegram) then v_u.telegram else null end
  );

  return v_base;
end;
$$;

-- 3) get_trip_view: контакты создателя/победителя — только Telegram.
create or replace function public.get_trip_view(p_ride_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  if not found then
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
    select exists(
      select 1 from public.reviews
      where ride_id = p_ride_id and reviewer_id = v_uid
    ) into v_has_reviewed;
  end if;

  v_result := jsonb_build_object(
    'ride',
      to_jsonb(v_ride)
      || jsonb_build_object(
        'creator', (
          select
            jsonb_build_object(
              'id',            u.id,
              'full_name',     u.full_name,
              'avatar_url',    u.avatar_url,
              'rating',        u.rating,
              'trips_count',   u.trips_count,
              'show_phone',    u.show_phone,
              'show_telegram', u.show_telegram,
              'show_whatsapp', u.show_whatsapp
            )
            || case when v_see_creator then jsonb_build_object(
                 'telegram', case when u.show_telegram then u.telegram else null end
               ) else '{}'::jsonb end
          from public.users u
          where u.id = v_ride.creator_id
        ),
        'winner', (
          select
            jsonb_build_object(
              'id',         u.id,
              'full_name',  u.full_name,
              'avatar_url', u.avatar_url
            )
            || case when v_see_winner then jsonb_build_object(
                 'telegram', u.telegram
               ) else '{}'::jsonb end
          from public.users u
          where u.id = v_ride.winner_id
        )
      ),
    'bids', coalesce((
      select jsonb_agg(b.entry order by b.created_at desc)
      from (
        select
          bd.created_at,
          jsonb_build_object(
            'id',         bd.id,
            'amount',     bd.amount,
            'created_at', bd.created_at,
            'bidder', case when bu.id is null then null else jsonb_build_object(
              'id',         bu.id,
              'full_name',  bu.full_name,
              'avatar_url', bu.avatar_url
            ) end
          ) as entry
        from public.bids bd
        left join public.users bu on bu.id = bd.bidder_id
        where bd.ride_id = p_ride_id
      ) b
    ), '[]'::jsonb),
    'has_reviewed', v_has_reviewed
  );

  return v_result;
end;
$function$;

commit;
