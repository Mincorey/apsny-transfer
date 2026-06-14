-- Migration: автосоздание профиля при регистрации (аудит I1)
-- Дата: 2026-06-05
--
-- Проблема: профиль в public.users создавался кодом в браузере сразу после signUp.
-- Если включить подтверждение email, сессии ещё нет → INSERT падает по RLS →
-- аккаунт есть, а профиля нет. Решение: создавать профиль БД-триггером на
-- auth.users (AFTER INSERT, SECURITY DEFINER) — надёжно при любой настройке.
--
-- Данные берутся из raw_user_meta_data (их кладёт signUp options.data):
-- full_name, phone, role, telegram, whatsapp.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  -- роль из метаданных, с защитой от недопустимого значения (иначе CHECK уронит регистрацию)
  v_role := NEW.raw_user_meta_data->>'role';
  IF v_role IS NULL OR v_role NOT IN ('passenger', 'driver') THEN
    v_role := 'passenger';
  END IF;

  -- профиль создаём в защищённом блоке: любая ошибка вставки НЕ должна срывать
  -- создание самого аккаунта (auth.users)
  BEGIN
    INSERT INTO public.users (id, email, full_name, phone, role, telegram, whatsapp)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'phone', ''),
      v_role,
      NULLIF(NEW.raw_user_meta_data->>'telegram', ''),
      NULLIF(NEW.raw_user_meta_data->>'whatsapp', '')
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: не удалось создать профиль для %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Триггерная функция не должна быть вызываемой как RPC
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
