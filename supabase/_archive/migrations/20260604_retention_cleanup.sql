-- Migration: Retention cleanup — защита 500 МБ БД на Free-тарифе
-- Дата: 2026-06-04 (раздел 3.3 плана оптимизации)
--
-- Таблицы notifications / bids / messages растут без ограничений. Эта миграция
-- заводит функции периодической очистки и расписание pg_cron. Если pg_cron
-- недоступен (например, проект на паузе), блок расписания — no-op; функции
-- можно вызывать из Supabase Edge Function по расписанию (run_retention_cleanup()).
--
-- Политика хранения:
--   1) прочитанные notifications старше 30 дней — удаляются (непрочитанные не трогаем);
--   2) отменённые (cancelled) поездки старше 30 дней — удаляются; связанные bids,
--      messages, reviews уходят каскадом по внешним ключам ON DELETE CASCADE;
--   3) messages завершённых (completed) поездок старше 1 месяца — удаляются
--      (история группового чата по давно завершённым поездкам).

-- ─── 1. Прочитанные уведомления старше 30 дней ──────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_old_notifications() RETURNS integer AS $$
DECLARE v_deleted integer;
BEGIN
    DELETE FROM public.notifications
    WHERE is_read = true
      AND created_at < now() - INTERVAL '30 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 2. Отменённые поездки старше 30 дней (bids/messages/reviews — каскадом) ──
CREATE OR REPLACE FUNCTION cleanup_old_cancelled_rides() RETURNS integer AS $$
DECLARE v_deleted integer;
BEGIN
    DELETE FROM public.rides
    WHERE status = 'cancelled'
      AND COALESCE(cancelled_at, created_at) < now() - INTERVAL '30 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 3. Сообщения завершённых поездок старше 1 месяца ───────────────────────
CREATE OR REPLACE FUNCTION cleanup_old_completed_messages() RETURNS integer AS $$
DECLARE v_deleted integer;
BEGIN
    DELETE FROM public.messages m
    USING public.rides r
    WHERE m.ride_id = r.id
      AND r.status = 'completed'
      AND m.created_at < now() - INTERVAL '1 month';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 4. Объединяющая функция (вызывается по расписанию) ──────────────────────
CREATE OR REPLACE FUNCTION run_retention_cleanup() RETURNS void AS $$
BEGIN
    PERFORM cleanup_old_notifications();
    PERFORM cleanup_old_cancelled_rides();
    PERFORM cleanup_old_completed_messages();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 5. Расписание pg_cron: ежедневно в 03:00 UTC (no-op если pg_cron нет) ────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'pg_cron не установлен — retention-очистка отключена. Включите pg_cron (Dashboard → Database → Extensions) или вызывайте run_retention_cleanup() из Edge Function по расписанию.';
        RETURN;
    END IF;

    BEGIN
        PERFORM cron.unschedule('retention-cleanup');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    PERFORM cron.schedule(
        'retention-cleanup',
        '0 3 * * *',
        'SELECT run_retention_cleanup()'
    );
END $$;
