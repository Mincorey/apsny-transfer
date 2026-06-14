-- Migration: Fix notifications INSERT policy
--
-- Problem: INSERT WITH CHECK (true) allows any authenticated user to create
-- notifications for any other user directly via the REST API.
--
-- Fix: WITH CHECK (false) blocks all direct inserts.
-- Notifications are only created through SECURITY DEFINER RPC functions
-- (place_bid, finish_auction, close_auction_early, cancel_ride, submit_review,
-- accept_current_price) which bypass RLS entirely — so they are unaffected.

DROP POLICY IF EXISTS "Система создаёт уведомления" ON public.notifications;

CREATE POLICY "Система создаёт уведомления" ON public.notifications
    FOR INSERT WITH CHECK (false);
