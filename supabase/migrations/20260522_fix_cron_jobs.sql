-- Migration: pg_cron jobs for automatic auction and trip completion
--
-- Problem 1: finish_auction() exists but nothing calls it on a timer.
--   Active rides whose auction_end_time has passed stay 'active' forever.
--   Users see an expired countdown but the auction never closes.
--
-- Problem 2: migrations/002 has a cron that auto-completes booked rides via
--   direct UPDATE, bypassing complete_trip — so trips_count is never incremented
--   for timer-based completions.
--
-- Fix:
--   process_expired_auctions()   — calls finish_auction() for each expired active ride
--   auto_complete_expired_rides() — properly completes booked rides + updates trips_count
--   pg_cron schedules for both (graceful no-op if pg_cron is not installed)


-- ─── 1. Wrapper: close expired active auctions ───────────────────────────────
CREATE OR REPLACE FUNCTION process_expired_auctions() RETURNS void AS $$
DECLARE
    v_ride_id UUID;
BEGIN
    FOR v_ride_id IN
        SELECT id
        FROM public.rides
        WHERE status = 'active'
          AND auction_end_time IS NOT NULL
          AND auction_end_time < now()
    LOOP
        PERFORM finish_auction(v_ride_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 2. Wrapper: auto-complete booked rides 24 h after departure ─────────────
-- Replaces the direct UPDATE cron from migrations/002_booked_status.sql.
-- Goes through proper logic so trips_count is incremented for both parties.
CREATE OR REPLACE FUNCTION auto_complete_expired_rides() RETURNS void AS $$
DECLARE
    v_ride RECORD;
BEGIN
    FOR v_ride IN
        SELECT *
        FROM public.rides
        WHERE status = 'booked'
          AND (departure_date + departure_time)::timestamptz + INTERVAL '24 hours' < now()
    LOOP
        UPDATE public.rides SET status = 'completed' WHERE id = v_ride.id;

        UPDATE public.users
        SET trips_count = trips_count + 1
        WHERE id IN (v_ride.creator_id, v_ride.winner_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 3. pg_cron schedules (no-op if extension not installed) ─────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'pg_cron not installed — automatic auction/trip completion is disabled. Enable pg_cron (Supabase Pro+) to activate.';
        RETURN;
    END IF;

    -- Remove old jobs from migrations/002 if they exist
    BEGIN
        PERFORM cron.unschedule('auto-complete-booked-rides');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Every minute: close auctions whose auction_end_time has passed
    PERFORM cron.schedule(
        'auto-finish-expired-auctions',
        '* * * * *',
        'SELECT process_expired_auctions()'
    );

    -- Every hour: complete booked rides 24 h after departure
    PERFORM cron.schedule(
        'auto-complete-expired-rides',
        '0 * * * *',
        'SELECT auto_complete_expired_rides()'
    );
END $$;
