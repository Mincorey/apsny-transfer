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
