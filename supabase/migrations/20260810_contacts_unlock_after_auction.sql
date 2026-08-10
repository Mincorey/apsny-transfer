-- ============================================================
-- 20260810_contacts_unlock_after_auction.sql
--
-- Возврат контактов взамен удалённого внутреннего чата.
--
-- ЗАЧЕМ
-- -----
-- Миграция 20260810_remove_internal_chat.sql убрала внутреннюю переписку.
-- Единственным каналом связи остался Telegram, а телефон, WhatsApp и MAX были
-- скрыты от всех с июня — это было требование модерации Platega
-- (20260622_platega_free_publish_and_hide_contacts.sql). Проект переходит на
-- ЮMoney, поэтому требование больше не действует.
--
-- Проблема была не теоретическая: на момент правки у двух из шести
-- пользователей Telegram не заполнен вообще — связаться с ними после
-- завершения аукциона было невозможно никак, сделка сорвалась бы.
--
-- ПРИНЯТАЯ СХЕМА
-- --------------
-- 1. ДО завершения аукциона — показываем только то, что пользователь сам
--    разрешил переключателями show_phone / show_telegram / show_whatsapp /
--    show_max, и только авторизованным. Анонимам не показываем ничего.
-- 2. ПОСЛЕ завершения аукциона (статус booked или completed) второй стороне
--    сделки открываются ВСЕ заполненные контакты, независимо от переключателей.
--    Создатель видит контакты победителя, победитель — контакты создателя.
--    Посторонние не видят ничего даже после завершения.
--
-- Смысл переключателей после этой миграции — управление ПУБЛИЧНЫМ профилем,
-- а не отношениями внутри состоявшейся сделки. Подписи в интерфейсе профиля
-- изменены соответственно, чтобы не вводить людей в заблуждение.
--
-- Телефон при этом гарантированно есть у каждого: колонка users.phone уже
-- объявлена NOT NULL, а поле в форме регистрации помечено required. Отдельно
-- делать телефон обязательным не потребовалось — он уже обязателен.
--
-- ЧТО ИЗМЕНЕНО
-- ------------
--   get_user_profile — вернула phone, whatsapp и max (раньше всегда NULL);
--                      добавлено поле contacts_unlocked для интерфейса;
--                      признак «была совместная сделка» расширен со статуса
--                      completed до (booked, completed) — контакты нужны
--                      сразу после победы, а не после завершения поездки.
--   get_trip_view    — то же самое для создателя и победителя поездки.
--
-- БЕЗОПАСНОСТЬ
-- ------------
-- Прямые гранты на колонки phone, telegram, whatsapp, max и email ролям anon
-- и authenticated по-прежнему НЕ выданы — читать их напрямую через REST нельзя.
-- Контакты отдаются исключительно этими двумя SECURITY DEFINER функциями,
-- которые сами решают, кому что показать.
--
-- ЮРИДИЧЕСКИЙ МОМЕНТ
-- ------------------
-- Телефон — персональные данные. Передача его второй стороне сделки должна
-- быть описана в политике конфиденциальности и в оферте. Это делается вместе
-- с пунктом 2.2 аудита (замена Platega на ЮMoney в юридических документах).
--
-- ПРОВЕРЕНО НА БОЕВОЙ БАЗЕ (в транзакции с откатом)
-- -------------------------------------------------
--   победитель → завершённая поездка: телефон, telegram, whatsapp, max создателя видны
--   создатель  → завершённая поездка: контакты победителя видны
--   посторонний → та же поездка: всё скрыто
--   участник   → идущий аукцион: виден только telegram (он разрешён), телефон скрыт
--   аноним     → идущий аукцион: скрыто всё
--
-- Миграция идемпотентна: create or replace.
-- ============================================================

begin;

-- 1) Публичный профиль пользователя.
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
  v_full   boolean;
  v_u      public.users;
begin
  select * into v_u from public.users where id = p_user_id;
  if not found then return null; end if;

  -- Была ли между нами состоявшаяся сделка (booked или completed).
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
    -- Признак для интерфейса: контакты открыты полностью, т.к. была сделка.
    'contacts_unlocked', v_full,
    'phone',    case when v_full then v_u.phone    when v_uid is not null and v_u.show_phone    then v_u.phone    end,
    'telegram', case when v_full then v_u.telegram when v_uid is not null and v_u.show_telegram then v_u.telegram end,
    'whatsapp', case when v_full then v_u.whatsapp when v_uid is not null and v_u.show_whatsapp then v_u.whatsapp end,
    'max',      case when v_full then v_u.max      when v_uid is not null and v_u.show_max      then v_u.max      end
  );
end;
$$;

-- 2) Страница поездки.
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
  if not found then return null; end if;

  -- Истёкший аукцион закрывается при открытии страницы.
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
      select 1 from public.reviews where ride_id = p_ride_id and reviewer_id = v_uid
    ) into v_has_reviewed;
  end if;

  v_result := jsonb_build_object(
    'ride',
      to_jsonb(v_ride)
      || jsonb_build_object(
        'creator', (
          select jsonb_build_object(
              'id',            u.id,
              'full_name',     u.full_name,
              'avatar_url',    u.avatar_url,
              'rating',        u.rating,
              'trips_count',   u.trips_count,
              'show_phone',    u.show_phone,
              'show_telegram', u.show_telegram,
              'show_whatsapp', u.show_whatsapp,
              'show_max',      u.show_max,
              'contacts_unlocked', v_see_creator,
              'phone',    case when v_see_creator then u.phone    when v_auth and u.show_phone    then u.phone    end,
              'telegram', case when v_see_creator then u.telegram when v_auth and u.show_telegram then u.telegram end,
              'whatsapp', case when v_see_creator then u.whatsapp when v_auth and u.show_whatsapp then u.whatsapp end,
              'max',      case when v_see_creator then u.max      when v_auth and u.show_max      then u.max      end
            )
          from public.users u where u.id = v_ride.creator_id
        ),
        'winner', (
          select jsonb_build_object(
              'id',         u.id,
              'full_name',  u.full_name,
              'avatar_url', u.avatar_url,
              'contacts_unlocked', v_see_winner,
              -- Контакты победителя видит только создатель поездки.
              'phone',    case when v_see_winner then u.phone    end,
              'telegram', case when v_see_winner then u.telegram end,
              'whatsapp', case when v_see_winner then u.whatsapp end,
              'max',      case when v_see_winner then u.max      end
            )
          from public.users u where u.id = v_ride.winner_id
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
