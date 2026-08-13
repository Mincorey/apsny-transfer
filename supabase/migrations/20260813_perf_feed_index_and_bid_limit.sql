-- Оптимизация по итогам нагрузочного теста 13.08.2026
-- (см. НАГРУЗОЧНЫЙ-ТЕСТ-2026-08-13.md).
--
-- Замеры сделаны на стенде с боевой схемой и объёмом «сервис проработал год»:
-- 50 000 пользователей, 60 000 поездок, 265 000 ставок, 400 000 уведомлений.

-- ---------------------------------------------------------------------------
-- 1. Индекс под запрос ленты
--
-- Лента спрашивает: активные поездки нужного типа плюс отменённые за последние
-- сутки, по убыванию даты, первые 50. Индексов idx_rides_status и idx_rides_type
-- для этого мало: планировщик поднимал ВСЕ подходящие строки (на стенде 1342),
-- для каждой лез в users за автором, сортировал и выбрасывал всё, кроме
-- пятидесяти. 5027 обращений к буферам на один опрос, 10,3 мс процессорного
-- времени.
--
-- Составной индекс отдаёт строки уже в нужном порядке, поэтому чтение
-- прекращается на пятидесятой: 219 обращений вместо 5027, 3,47 мс вместо 10,30.
--
-- Важнее разовой экономии то, что стоимость перестала зависеть от объёма базы:
-- при росте числа активных поездок с 2 000 до 20 000 запрос подорожал
-- с 3,47 до 3,51 мс, то есть не подорожал.
--
-- Частичный (WHERE status in ...): в индексе лежат только те поездки, которые
-- вообще могут попасть в ленту — это меньше 10% таблицы.
create index concurrently if not exists idx_rides_feed
  on public.rides (type, created_at desc)
  where status in ('active', 'cancelled');

-- ---------------------------------------------------------------------------
-- 2. Индекс под опрос уведомлений
--
-- Опрос спрашивает «что нового у этого пользователя после такого-то времени».
-- Существующий idx_notif_user — это (user_id, is_read), даты в нём нет, поэтому
-- поднимались все уведомления пользователя и фильтровались по дате уже после
-- чтения. Пока их по 8 на человека, это незаметно. На пользователе с 500
-- уведомлениями: 28 обращений к буферам и 0,234 мс против 3 обращений
-- и 0,060 мс с этим индексом.
--
-- Профилактика: чинить это на растущей таблице дороже, чем поставить сейчас.
create index concurrently if not exists idx_notif_user_created
  on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. get_trip_view отдаёт последние 20 ставок вместо всех
--
-- Функция собирала в ответ ВСЕ ставки поездки. На аукционе с 300 ставками это
-- 75 КБ и 7,2 мс на каждый вызов против 5 КБ и 1,4 мс с ограничением.
--
-- Дело не в разовом весе ответа, а в том, кто и когда его запрашивает.
-- Карточка поездки подписана на вставку ставок: каждая новая ставка будит
-- ВСЕХ, кто смотрит страницу, и каждый тянет полный список заново. Пятьдесят
-- зрителей и ставка раз в десять секунд — это пять запросов в секунду
-- по 75 КБ, около 4 Мбит/с с одной поездки. Ограничение убирает этот усилитель.
--
-- Полное число ставок никуда не делось: оно лежит в rides.bids_count и
-- приходит в том же ответе, поэтому счётчик в интерфейсе остаётся честным.
--
-- Остальное тело функции не изменено (сверено с боевой версией от 13.08.2026).
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
        -- Последние 20: остальное в интерфейсе всё равно не показывается,
        -- а полное число ставок приходит в ride.bids_count.
        order by bd.created_at desc
        limit 20
      ) b
    ), '[]'::jsonb),
    'has_reviewed', v_has_reviewed
  );

  return v_result;
end;
$function$;
