-- Четыре правки по итогам аудита 13.08.2026: пункты 12, 13, 14 и 16.

-- ---------------------------------------------------------------------------
-- 1. Пункт 12: аукцион без ставок не проставлял cancelled_at
--
-- finish_auction при нулевых ставках ставила status = 'cancelled' и на этом
-- останавливалась. Лента показывает отменённые поездки сутки по условию
-- cancelled_at >= вчера — записи без этой отметки в ленту не попадали вовсе,
-- то есть поездка исчезала молча, вместо того чтобы сутки повисеть отменённой.
-- cancel_ride (отмена руками) отметку ставит, расхождение было только здесь.
-- ---------------------------------------------------------------------------
create or replace function public.finish_auction(p_ride_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
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
        UPDATE public.rides SET status = 'cancelled', cancelled_at = now()
        WHERE id = p_ride_id;
        RETURN jsonb_build_object('success', true, 'status', 'cancelled');
    END IF;

    UPDATE public.rides
    SET status = 'booked', winner_id = v_winner, auction_end_time = now()
    WHERE id = p_ride_id;

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (v_winner, 'auction_won', 'Вы выиграли аукцион!',
            'Поздравляем! Поездка ' || v_ride.origin || ' → ' || v_ride.destination || ' ваша.',
            p_ride_id);

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    VALUES (v_ride.creator_id, 'auction_won', 'Аукцион завершён',
            'Найден ' || (CASE WHEN v_ride.type = 'request' THEN 'водитель' ELSE 'пассажир' END),
            p_ride_id);

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    SELECT DISTINCT b.bidder_id, 'auction_lost', 'Аукцион завершён',
           'По поездке ' || v_ride.origin || ' → ' || v_ride.destination || ' выбрали другого участника.',
           p_ride_id
    FROM public.bids b
    WHERE b.ride_id = p_ride_id AND b.bidder_id <> v_winner;

    RETURN jsonb_build_object('success', true, 'status', 'booked', 'winner_id', v_winner);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Пункт 13: часовой пояс при автозавершении поездок
--
-- База живёт в UTC, а departure_time человек вводит по местному времени.
-- Выражение (departure_date + departure_time)::timestamptz приводило время
-- к часовому поясу сессии, то есть считало 10:00 по Сухуму за 10:00 UTC —
-- на три часа позже задуманного. Поездка висела «состоявшейся» лишний вечер.
--
-- Сочи и Абхазия живут в UTC+3, то есть по московскому времени; указываем
-- пояс явно, а не смещением, чтобы правка пережила возможный перевод часов.
-- ---------------------------------------------------------------------------
create or replace function public.auto_complete_expired_rides()
 returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
BEGIN
    -- trips_count увеличивает триггер trg_sync_trips_count.
    UPDATE public.rides
    SET status = 'completed'
    WHERE status = 'booked'
      AND ((departure_date + departure_time) AT TIME ZONE 'Europe/Moscow')
          + INTERVAL '24 hours' < now();
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Пункт 14: чужие черновики читались по REST
--
-- Политика rides_select_all разрешала SELECT всем и на всё: USING (true).
-- Неопубликованный черновик другого человека спокойно читался запросом
-- /rest/v1/rides?id=eq.<чужой>, а страница /payment?ride=<чужой> показывала
-- работающую на вид форму публикации. Сама RPC чужого не пустила бы, но
-- показывать черновик постороннему незачем в принципе.
--
-- Черновик виден только автору. Всё остальное — как было: лента, карточки
-- поездок и профили открыты всем, на этом стоит весь публичный доступ.
-- ---------------------------------------------------------------------------
drop policy if exists rides_select_all on public.rides;

create policy rides_select_published on public.rides
  for select
  using (status <> 'draft' or (select auth.uid()) = creator_id);

-- ---------------------------------------------------------------------------
-- 4. Пункт 16: мёртвая политика
--
-- rides_update_own описывает, кому можно менять поездку, но у роли
-- authenticated нет ни одного UPDATE-гранта на колонки rides — и это
-- правильно, все изменения идут через RPC с проверками внутри. Политика
-- не может сработать никогда; в базе она только вводит в заблуждение при
-- чтении прав.
-- ---------------------------------------------------------------------------
drop policy if exists rides_update_own on public.rides;

-- ---------------------------------------------------------------------------
-- 5. Черновик закрыт и на странице поездки
--
-- Одной политики мало: get_trip_view объявлена SECURITY DEFINER и политики
-- RLS обходит по определению — иначе она не смогла бы отдавать контакты
-- победителю. Значит, адрес /trips/<чужой черновик> открывался бы и после
-- правки политики. Проверку добавляем внутрь функции: постороннему черновик
-- не существует, автору — виден как обычно.
--
-- Остальное тело не менялось, включая ограничение выдачи ставок двадцатью
-- последними (миграция 20260813_perf_feed_index_and_bid_limit.sql).
-- ---------------------------------------------------------------------------
create or replace function public.get_trip_view(p_ride_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
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
