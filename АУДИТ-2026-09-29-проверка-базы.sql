-- ============================================================================
-- АУДИТ 29.09.2026 — проверка боевой базы APSNY-TRANSFER
-- ============================================================================
-- ТОЛЬКО ЧТЕНИЕ. Ни один запрос ниже ничего не меняет.
--
-- 29.09.2026 ВЫПОЛНЕНО через коннектор Supabase — результаты в аудите,
-- раздел 0.1 и Приложение В. Файл оставлен для повторной сверки: после
-- каждой миграции и ОБЯЗАТЕЛЬНО после переезда (пункт К-3) — результаты
-- на новом сервере должны совпасть с облаком.
--
-- Как запускать: Supabase Dashboard → проект uprcnpgmmnvsoxasuhun →
-- SQL Editor → вставить блок → Run. Запускать по одному блоку (1, 2, 3 ...),
-- результат каждого скопировать и прислать — по нему закрываются пункты
-- аудита, помеченные «нужна проверка на боевой базе».
--
-- Зачем. Аудит делался по коду репозитория: база собиралась из миграций
-- на локальном PostgreSQL. Доступа к боевой базе не было, а она местами
-- отличается от репозитория (см. пункт В-5 аудита). Эти запросы показывают,
-- как обстоят дела на самом деле.
-- ============================================================================


-- ─── 1. К-2: кто может вызывать функции ─────────────────────────────────────
-- Смотреть на колонку anon. Для close_auction_early, complete_trip,
-- auto_complete_expired_rides, run_retention_cleanup, cleanup_old_* там
-- должно быть false. true = пункт К-2 подтверждён на бою.
select p.proname                                            as функция,
       has_function_privilege('anon',          p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       p.prosecdef                                          as security_definer,
       coalesce(array_to_string(p.proconfig, ', '), '—')    as search_path
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by 1;


-- ─── 2. К-2 и В-5: тексты функций отличаются от репозитория? ─────────────────
select p.proname as функция,
       pg_get_functiondef(p.oid) ~* 'auth\.uid\(\)\s+is\s+null|v_uid\s+is\s+null'
                                   as есть_проверка_входа,
       pg_get_functiondef(p.oid) ~* 'trips_count\s*=\s*trips_count\s*\+\s*1'
                                   as сама_считает_поездки,
       pg_get_functiondef(p.oid) ~* 'draft'
                                   as знает_про_черновики
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('close_auction_early','complete_trip','get_trip_view',
                    'place_bid','cancel_ride','submit_review','finish_auction')
order by 1;


-- ─── 3. В-5: функции, которых нет в репозитории ─────────────────────────────
-- Полный текст — чтобы положить его в миграцию. Прислать целиком.
select pg_get_functiondef(p.oid)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('close_expired_auctions');


-- ─── 4. В-1, В-3, С-1: права на колонки ─────────────────────────────────────
select table_name as таблица, grantee as роль, privilege_type as право,
       string_agg(column_name, ', ' order by column_name) as колонки
from information_schema.column_privileges
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in ('users', 'vehicles', 'rides', 'bids')
group by 1, 2, 3
order by 1, 2, 3;


-- ─── 5. Все политики RLS ────────────────────────────────────────────────────
select schemaname as схема, tablename as таблица, policyname as политика,
       cmd as действие, roles as роли, qual as условие, with_check as проверка
from pg_policies
where schemaname in ('public', 'storage')
order by 1, 2, 3;


-- ─── 6. С-11: Storage — бакеты и их ограничения ─────────────────────────────
select id as бакет, public as публичный,
       file_size_limit as лимит_байт, allowed_mime_types as разрешённые_типы
from storage.buckets;


-- ─── 7. В-7: что происходит с платежами при удалении поездки ────────────────
select conname as связь, pg_get_constraintdef(oid) as определение
from pg_constraint
where conrelid = 'public.payments'::regclass and contype = 'f';


-- ─── 8. pg_cron: задачи и последние запуски ─────────────────────────────────
select jobid, jobname, schedule, command, active from cron.job order by jobid;

select j.jobname, d.status, count(*) as запусков, max(d.start_time) as последний
from cron.job_run_details d join cron.job j using (jobid)
where d.start_time > now() - interval '1 day'
group by 1, 2 order by 1, 2;


-- ─── 9. Целостность: счётчик поездок совпадает с фактом? ────────────────────
select count(*) filter (where u.trips_count <> f.cnt) as расхождений,
       count(*)                                        as пользователей
from public.users u
join lateral (
  select count(*) as cnt from public.rides r
  where r.status = 'completed' and (r.creator_id = u.id or r.winner_id = u.id)
) f on true;


-- ─── 10. Что за данные сейчас живут в базе (для оценки 152-ФЗ) ──────────────
select (select count(*) from public.users)            as пользователей,
       (select count(*) from public.rides)            as поездок,
       (select count(*) from public.payments)         as платежей,
       (select count(*) from public.contact_messages) as обращений,
       (select min(created_at) from public.contact_messages) as самое_старое_обращение;


-- ─── 11. Расширения и их версии (для переезда) ──────────────────────────────
select extname, extversion, extnamespace::regnamespace as схема
from pg_extension order by 1;

-- Что загружается при старте PostgreSQL (для пункта В-4)
show shared_preload_libraries;
