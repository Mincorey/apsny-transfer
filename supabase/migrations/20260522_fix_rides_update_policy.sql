-- Migration: Remove direct UPDATE policy on rides table
--
-- Problem: UPDATE USING (auth.uid() = creator_id) allows the ride creator to
-- directly modify ANY column (winner_id, status, current_price, etc.) via the
-- REST API, bypassing all business logic enforced by RPC functions.
--
-- Example attack:
--   PATCH /rest/v1/rides?id=eq.<ride_id>
--   {"winner_id": "<creator_id>", "status": "completed"}
--   → creator awards themselves the auction, skipping bidding/notifications
--
-- Fix: Drop the direct UPDATE policy. All legitimate ride updates go through
-- SECURITY DEFINER RPC functions (place_bid, close_auction_early, complete_trip,
-- cancel_ride, accept_current_price) which bypass RLS entirely — so they are
-- completely unaffected by removing this policy.
-- No frontend code performs direct .update() on the rides table.

DROP POLICY IF EXISTS "Создатель обновляет свою поездку" ON public.rides;
