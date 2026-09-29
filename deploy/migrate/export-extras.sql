-- ============================================================================
-- То, что НЕ попадает в дамп схемы public, но без чего сервис не работает.
-- Выполняется на СТАРОЙ базе (облако); на выходе — готовый SQL для новой.
-- Используется скриптом migrate-db.sh; вручную запускать не нужно.
--
--   • триггер на auth.users (без него у новых пользователей не будет профиля)
--   • политики Storage (без них не загрузить аватар)
--   • таблицы в публикации Realtime (без них ставки не обновляются вживую)
--   • задачи pg_cron — ровно с теми именами и расписанием, что в облаке
--   • секреты Vault (токен Telegram-бота и chat_id)
--
-- ВНИМАНИЕ: результат содержит секреты Vault в открытом виде. Скрипт
-- удаляет файл сразу после применения.
-- ============================================================================
\pset tuples_only on
\pset format unaligned
-- Пустой search_path — чтобы все имена в выводе были с указанием схемы.
set search_path = '';

select '-- триггеры на auth.users';
select format('drop trigger if exists %I on auth.users;', t.tgname) || E'\n' || pg_get_triggerdef(t.oid) || ';'
from pg_trigger t
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;

select '-- политики Storage';
select format('drop policy if exists %I on %I.%I;', policyname, schemaname, tablename)
       || E'\n' ||
       format('create policy %I on %I.%I as %s for %s to %s%s%s;',
              policyname, schemaname, tablename, permissive, cmd,
              array_to_string(roles, ', '),
              case when qual       is not null then ' using (' || qual || ')' else '' end,
              case when with_check is not null then ' with check (' || with_check || ')' else '' end)
from pg_policies where schemaname = 'storage'
order by tablename, policyname;

select '-- публикация Realtime';
select format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename)
from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;

select '-- задачи pg_cron';
select format('select cron.unschedule(%L) where exists (select 1 from cron.job where jobname = %L);', jobname, jobname)
       || E'\n' || format('select cron.schedule(%L, %L, %L);', jobname, schedule, command)
from cron.job where active order by jobid;

select '-- секреты Vault';
select format('select vault.create_secret(%L, %L, %L);', decrypted_secret, name, coalesce(description, ''))
from vault.decrypted_secrets order by name;
