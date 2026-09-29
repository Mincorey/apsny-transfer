-- Migration 002: Add 'booked' status to the ride lifecycle
--
-- New lifecycle:  active → booked → completed
--   booked    = auction closed, trip is scheduled (winner selected)
--   completed = trip physically happened (driver pressed button or auto after 24 h)
--
-- Apply in Supabase SQL editor: Dashboard → SQL Editor → New query → paste → Run

-- ─── 1. Extend the status check constraint ───────────────────────────────────
ALTER TABLE public.rides
  DROP CONSTRAINT IF EXISTS rides_status_check;

ALTER TABLE public.rides
  ADD CONSTRAINT rides_status_check
  CHECK (status IN ('active', 'booked', 'completed', 'cancelled'));

-- ─── 2. Replace close_auction_early: active → booked (was completed) ─────────
CREATE OR REPLACE FUNCTION close_auction_early(p_ride_id UUID)
RETURNS jsonb AS $$
DECLARE
  v_ride      RECORD;
  v_winner_id UUID;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF v_ride.status != 'active' THEN
    RAISE EXCEPTION 'Auction is not active';
  END IF;

  IF v_ride.creator_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the ride creator can close the auction';
  END IF;

  -- Winner = the bidder with the most recent (= best) bid.
  -- place_bid enforces direction, so last bid is always the best bid.
  SELECT bidder_id INTO v_winner_id
  FROM public.bids
  WHERE ride_id = p_ride_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_winner_id IS NULL THEN
    RAISE EXCEPTION 'Cannot close auction: no bids have been placed yet';
  END IF;

  UPDATE public.rides
  SET
    status           = 'booked',
    winner_id        = v_winner_id,
    auction_end_time = now()
  WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true, 'winner_id', v_winner_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 3. Create complete_trip: booked → completed (driver action) ─────────────
CREATE OR REPLACE FUNCTION complete_trip(p_ride_id UUID)
RETURNS jsonb AS $$
DECLARE
  v_ride RECORD;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF v_ride.status != 'booked' THEN
    RAISE EXCEPTION 'Ride must be in booked status to complete';
  END IF;

  IF v_ride.creator_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the ride creator can mark the trip as completed';
  END IF;

  UPDATE public.rides
  SET status = 'completed'
  WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 4. Auto-complete booked rides 24 h after departure (pg_cron) ────────────
-- Requires pg_cron extension (enabled by default on Supabase paid plans).
-- Runs every hour; completes rides where (departure_date + departure_time) + 24 h < now().
--
-- If pg_cron is not available, skip this block and handle auto-completion
-- via a Supabase Edge Function on a schedule instead.

SELECT cron.schedule(
  'auto-complete-booked-rides',   -- job name (unique)
  '0 * * * *',                    -- every hour at :00
  $$
    UPDATE public.rides
    SET status = 'completed'
    WHERE status = 'booked'
      AND (departure_date + departure_time)::timestamp + INTERVAL '24 hours' < now();
  $$
);
