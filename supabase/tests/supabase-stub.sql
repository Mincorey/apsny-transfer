-- ============================================================================
-- Минимальная имитация окружения Supabase для проверки схемы в CI.
-- ============================================================================
-- Создаёт то, что в настоящем Supabase уже есть до первой миграции: роли
-- anon / authenticated / service_role, схемы auth, storage, cron, net, vault,
-- функцию auth.uid() (берёт id из request.jwt.claim.sub — как PostgREST),
-- публикацию supabase_realtime и — ВАЖНО — права «по умолчанию», которые
-- Supabase раздаёт anon/authenticated на всё новое в схеме public. Без них
-- проверка была бы мягче реальности.
--
-- Только для тестов. На настоящей базе не запускать.
-- ============================================================================
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
create role supabase_admin superuser;
create schema extensions;
create extension "uuid-ossp" schema extensions;
alter database postgres set search_path = "$user", public, extensions;
set search_path = "$user", public, extensions;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now(), email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true),'')::text $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
create schema cron;
create table cron.job (jobid bigserial primary key, schedule text, command text, jobname text unique, active boolean default true);
create table cron.job_run_details (runid bigserial, jobid bigint, status text, start_time timestamptz, end_time timestamptz, return_message text);
create function cron.schedule(job_name text, sched text, cmd text) returns bigint language plpgsql as $$ declare i bigint; begin insert into cron.job(jobname,schedule,command) values(job_name,sched,cmd) on conflict on constraint job_jobname_key do update set schedule=excluded.schedule, command=excluded.command returning jobid into i; return i; end $$;
create function cron.unschedule(job_name text) returns boolean language plpgsql as $$ begin delete from cron.job j where j.jobname=job_name; return found; end $$;
create schema net;
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default null) returns uuid language sql as $$ insert into vault.secrets(name,secret,description) values(new_name,new_secret,new_description) returning id $$;
create publication supabase_realtime;
-- Supabase по умолчанию раздаёт права на public
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
