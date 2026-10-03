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
