-- ============================================================================
-- СВЕРКА ПРАВ ДОСТУПА: облако ↔ новый сервер          (только чтение)
-- ============================================================================
-- Запустить ОДИН И ТОТ ЖЕ файл на старой базе (облако Supabase) и на новой
-- (свой сервер) после восстановления. Результат — несколько строк вида
--     раздел | число_записей | отпечаток
-- Отпечатки всех разделов должны совпасть. Если какой-то не совпал —
-- переезд НЕ завершён: права, политики или функции перенеслись не так.
-- Подробности по несовпавшему разделу даёт второй запрос внизу файла.
--
-- Как запустить на своём сервере:
--   docker exec -i supabase-db psql -U postgres -d postgres < verify-grants.sql
-- В облаке: SQL Editor → вставить → Run.
-- ============================================================================

with
fn as (   -- кто может вызывать функции схемы public
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
         || ' anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' auth=' || has_function_privilege('authenticated', p.oid, 'execute')
         || ' definer=' || p.prosecdef
         || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '-') as line
  from pg_proc p where p.pronamespace = 'public'::regnamespace
),
fn_body as ( -- тексты функций (без пробелов, переводов строк и комментариев)
  select p.proname || ':' || md5(regexp_replace(regexp_replace(
           replace(pg_get_functiondef(p.oid), E'\r', ''), '--[^\n]*', '', 'g'), '\s+', '', 'g')) as line
  from pg_proc p where p.pronamespace = 'public'::regnamespace
),
tbl as (  -- права на таблицы целиком
  select table_name || ' ' || grantee || ' ' || privilege_type as line
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
),
col as (  -- права на отдельные колонки (здесь живёт приватность телефонов)
  select table_name || '.' || column_name || ' ' || grantee || ' ' || privilege_type as line
  from information_schema.column_privileges
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
),
rls as (  -- включён ли RLS
  select c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity as line
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
),
pol as (  -- политики RLS, включая Storage
  select schemaname || '.' || tablename || ' ' || policyname || ' ' || cmd || ' '
         || roles::text || ' '
         -- скобки убираем: после выгрузки и загрузки PostgreSQL может
         -- расставить их в условии иначе, хотя смысл тот же
         || regexp_replace(coalesce(qual, '-'), '[()]', '', 'g') || ' '
         || regexp_replace(coalesce(with_check, '-'), '[()]', '', 'g') as line
  from pg_policies where schemaname in ('public', 'storage')
),
trg as (  -- триггеры
  select tgrelid::regclass::text || ' ' || tgname || ' ' || tgfoid::regproc::text || ' ' || tgenabled::text as line
  from pg_trigger
  where not tgisinternal
    and (tgrelid::regclass::text !~ '^(storage|realtime|cron|net|vault|supabase_functions|auth)\.'
         or tgrelid = 'auth.users'::regclass)
),
con as (  -- ограничения (CHECK, UNIQUE, внешние ключи)
  select conrelid::regclass::text || ' ' || conname || ' '
         || regexp_replace(pg_get_constraintdef(oid), '[()]', '', 'g') as line
  from pg_constraint where connamespace = 'public'::regnamespace and contype in ('c', 'u', 'f')
),
bkt as (  -- бакеты Storage
  select id || ' public=' || public || ' size=' || coalesce(file_size_limit::text, '-')
         || ' mime=' || coalesce(array_to_string(allowed_mime_types, ','), '-') as line
  from storage.buckets
),
sections as (
            select 'функции: права'   as раздел, array_agg(line order by line collate "C") a from fn
  union all select 'функции: тексты',          array_agg(line order by line collate "C") from fn_body
  union all select 'таблицы: права',           array_agg(line order by line collate "C") from tbl
  union all select 'колонки: права',           array_agg(line order by line collate "C") from col
  union all select 'RLS включён',              array_agg(line order by line collate "C") from rls
  union all select 'политики',                 array_agg(line order by line collate "C") from pol
  union all select 'триггеры',                 array_agg(line order by line collate "C") from trg
  union all select 'ограничения',              array_agg(line order by line collate "C") from con
  union all select 'бакеты Storage',           array_agg(line order by line collate "C") from bkt
)
select раздел,
       coalesce(array_length(a, 1), 0)              as записей,
       left(md5(coalesce(array_to_string(a, E'\n'), '')), 12) as отпечаток
from sections
union all
select 'ИТОГО', null,
       left(md5(string_agg(coalesce(array_to_string(a, E'\n'), ''), '|' order by раздел collate "C")), 12)
from sections;

-- ----------------------------------------------------------------------------
-- Если раздел не совпал: раскомментируйте нужную строку, выполните на обеих
-- базах и сравните списки (например, в любом онлайн-сравнении текстов).
-- ----------------------------------------------------------------------------
-- select line from (select table_name||'.'||column_name||' '||grantee||' '||privilege_type line from information_schema.column_privileges where table_schema='public' and grantee in ('anon','authenticated')) x order by 1;
-- select p.proname, has_function_privilege('anon',p.oid,'execute') anon, has_function_privilege('authenticated',p.oid,'execute') auth from pg_proc p where p.pronamespace='public'::regnamespace order by 1;
-- select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1,2,3;
