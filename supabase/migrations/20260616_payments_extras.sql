-- ============================================================
-- 20260616_payments_extras.sql
-- Доработки после запуска платной публикации (ЮMoney):
--   1) автоудаление зависших неоплаченных черновиков (pg_cron);
--   2) Telegram-уведомления админу об оплатах/ошибках (pg_net + Vault);
--   3) RPC квитанции об оплате для клиента;
--   4) увеличенный таймаут pg_net (Telegram медленно отвечает → дефолтных 5с мало).
-- Все объекты идемпотентны (create or replace), безопасно применять повторно.
-- ============================================================

-- 1) Автоудаление неоплаченных черновиков старше 24 часов ─────────────────────
create or replace function public.cleanup_unpaid_drafts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  with del as (
    delete from public.rides r
    where r.status = 'draft'
      and r.created_at < now() - interval '24 hours'
      and not exists (
        select 1 from public.payments p
        where p.ride_id = r.id and p.status = 'paid'
      )
    returning r.id
  )
  select count(*) into n from del;
  return n;
end;
$$;
revoke all on function public.cleanup_unpaid_drafts() from public;

-- Ежечасный запуск (минута :07). Требует расширения pg_cron.
do $$
begin
  perform cron.unschedule('cleanup-unpaid-drafts');
exception when others then null;
end $$;
select cron.schedule('cleanup-unpaid-drafts', '7 * * * *', $$ select public.cleanup_unpaid_drafts(); $$);

-- 2) Универсальное уведомление админу в Telegram ──────────────────────────────
-- Секреты telegram_bot_token / telegram_chat_id хранятся в Supabase Vault.
-- timeout_milliseconds=20000: api.telegram.org из инфраструктуры БД отвечает
-- медленно, дефолтные 5с pg_net приводили к таймауту на TLS-рукопожатии.
create or replace function public.tg_notify(p_text text)
returns void
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare v_token text; v_chat text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_chat_id';
  if v_token is null or v_chat is null then return; end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'chat_id', v_chat,
      'text', p_text,
      'parse_mode', 'HTML',
      'disable_web_page_preview', true
    ),
    timeout_milliseconds := 20000
  );
end;
$$;
revoke all on function public.tg_notify(text) from public;
grant execute on function public.tg_notify(text) to service_role;

-- publish_ride_paid + уведомления об успехе/недоплате ─────────────────────────
create or replace function public.publish_ride_paid(
  p_label        text,
  p_operation_id text,
  p_withdraw     numeric,
  p_raw          jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay  record;
  v_ride record;
  v_msg  text;
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
    update public.rides
    set status           = 'active',
        auction_end_time = now() + (coalesce(v_ride.auction_hours, 6) || ' hours')::interval
    where id = v_ride.id;
  end if;

  v_msg :=
    '✅ <b>Оплата публикации — 100 ₽</b>' || E'\n' ||
    '🚗 ' ||
      coalesce(replace(replace(replace(v_ride.origin,      '&','&amp;'),'<','&lt;'),'>','&gt;'), '?') ||
      ' → ' ||
      coalesce(replace(replace(replace(v_ride.destination, '&','&amp;'),'<','&lt;'),'>','&gt;'), '?') || E'\n' ||
    '💳 Операция: ' || coalesce(p_operation_id, '—') || E'\n' ||
    '🕒 ' || to_char(now() at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') || ' (МСК)';
  perform public.tg_notify(v_msg);

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.publish_ride_paid(text, text, numeric, jsonb) from public;
grant execute on function public.publish_ride_paid(text, text, numeric, jsonb) to service_role;

-- 3) Квитанция об оплате для владельца поездки ────────────────────────────────
create or replace function public.get_ride_receipt(p_ride_id uuid)
returns table(
  ride_id uuid, origin text, destination text,
  departure_date date, departure_time time,
  amount numeric, operation_id text, label text, paid_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.origin, r.destination, r.departure_date, r.departure_time,
         p.amount, p.operation_id, p.label, p.paid_at
  from public.rides r
  join public.payments p on p.ride_id = r.id and p.status = 'paid'
  where r.id = p_ride_id and r.creator_id = auth.uid()
  order by p.paid_at desc
  limit 1;
$$;
revoke all on function public.get_ride_receipt(uuid) from public;
grant execute on function public.get_ride_receipt(uuid) to authenticated;
