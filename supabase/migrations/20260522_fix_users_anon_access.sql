-- Migration: Protect user contact fields from anonymous access
--
-- Problem: SELECT USING (true) on the users table allows unauthenticated callers
-- to query phone, telegram, whatsapp, max, email for all users via the REST API,
-- bypassing the show_* privacy settings entirely.
--
-- Fix: Column-level REVOKE blocks the anon role from reading sensitive columns.
-- Basic profile info (full_name, avatar_url, rating, trips_count) stays public
-- so the TripDetail public page can still display creator info anonymously.
-- Authenticated users retain full access; show_* flags continue to be enforced
-- at the application layer.

REVOKE SELECT (phone, telegram, whatsapp, max, email) ON public.users FROM anon;
