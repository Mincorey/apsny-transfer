-- ============================================================
-- 20260615_yoomoney_payments.sql
-- Платная публикация поездки (100 ₽) через ЮMoney QuickPay.
-- Поездка создаётся как 'draft' (скрыта), публикуется ТОЛЬКО после
-- подтверждённой оплаты — сервером (Edge Function), не из браузера.
-- ============================================================

begin;

-- 1) Разрешаем новый статус 'draft' (черновик до оплаты).
alter table public.rides drop constraint if exists rides_status_check;
alter table public.rides add constraint rides_status_check
  check (status in ('draft', 'active', 'booked', 'completed', 'cancelled'));

-- 2) Длительность аукциона в часах — чтобы стартовать таймер в МОМЕНТ
--    публикации (а не создания черновика).
alter table public.rides
  add column if not exists auction_hours smallint not null default 6;

-- 3) Любая новая поездка ПРИНУДИТЕЛЬНО создаётся как 'draft'.
--    Это закрывает дыру: клиент не может вставить status='active' и обойти оплату.
create or replace function public.force_ride_draft()
returns trigger
language plpgsql
as $$
begin
  new.status           := 'draft';
  new.auction_end_time := null;
  new.winner_id        := null;
  return new;
end;
$$;

drop trigger if exists trg_force_ride_draft on public.rides;
create trigger trg_force_ride_draft
  before insert on public.rides
  for each row execute function public.force_ride_draft();

-- 4) Таблица платежей.
create table if not exists public.payments (
  id           uuid primary key default uuid_generate_v4(),
  label        text not null unique,                 -- метка для сверки платежа
  ride_id      uuid not null references public.rides(id) on delete cascade,
  user_id      uuid references public.users(id) on delete set null,
  amount       numeric(10, 2) not null default 100,
  status       text not null default 'pending'
                  check (status in ('pending', 'paid', 'underpaid')),
  operation_id text,                                 -- id операции ЮMoney (идемпотентность)
  raw          jsonb,
  created_at   timestamptz not null default timezone('utc', now()),
  paid_at      timestamptz
);
create index if not exists idx_payments_ride on public.payments(ride_id);
create unique index if not exists uq_payments_operation
  on public.payments(operation_id) where operation_id is not null;

alter table public.payments enable row level security;
-- Политик для anon/authenticated НЕ создаём: таблицу читает/пишет только сервер
-- (service_role обходит RLS). Клиент работает с платежами только через RPC ниже.

-- 5) Клиент инициирует оплату своей draft-поездки и получает label.
create or replace function public.start_ride_payment(p_ride_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride  record;
  v_label text;
begin
  select * into v_ride from public.rides where id = p_ride_id;
  if not found then raise exception 'Поездка не найдена'; end if;
  if v_ride.creator_id <> auth.uid() then raise exception 'Это не ваша поездка'; end if;
  if v_ride.status <> 'draft' then raise exception 'Поездка уже опубликована'; end if;

  -- Переиспользуем существующий незакрытый платёж, если он есть.
  select label into v_label
  from public.payments
  where ride_id = p_ride_id and status = 'pending'
  order by created_at desc
  limit 1;

  if v_label is null then
    v_label := 'apsny_' || replace(uuid_generate_v4()::text, '-', '');
    insert into public.payments(label, ride_id, user_id, amount, status)
    values (v_label, p_ride_id, auth.uid(), 100, 'pending');
  end if;

  return v_label;
end;
$$;

revoke all on function public.start_ride_payment(uuid) from public;
grant execute on function public.start_ride_payment(uuid) to authenticated;

-- 6) Сервер (Edge Function) подтверждает оплату и публикует поездку.
--    Доступно ТОЛЬКО service_role — обычный пользователь это не вызовет.
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
begin
  select * into v_pay from public.payments where label = p_label for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_label');
  end if;

  -- Идемпотентность: повторное уведомление не публикует второй раз.
  if v_pay.status = 'paid' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- Недоплата (клиент заплатил меньше 100 ₽).
  if p_withdraw + 0.001 < v_pay.amount then
    update public.payments
    set status = 'underpaid', operation_id = p_operation_id, raw = p_raw
    where id = v_pay.id;
    return jsonb_build_object('ok', false, 'reason', 'underpaid');
  end if;

  update public.payments
  set status = 'paid', operation_id = p_operation_id, raw = p_raw, paid_at = now()
  where id = v_pay.id;

  -- Публикуем поездку и запускаем таймер аукциона ОТ МОМЕНТА ОПЛАТЫ.
  select * into v_ride from public.rides where id = v_pay.ride_id for update;
  if found and v_ride.status = 'draft' then
    update public.rides
    set status           = 'active',
        auction_end_time = now() + (coalesce(v_ride.auction_hours, 6) || ' hours')::interval
    where id = v_ride.id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.publish_ride_paid(text, text, numeric, jsonb) from public;
grant execute on function public.publish_ride_paid(text, text, numeric, jsonb) to service_role;

commit;
