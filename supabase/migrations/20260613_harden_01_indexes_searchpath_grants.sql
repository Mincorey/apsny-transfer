-- Харднинг БД 2026-06-13, часть 1 (применено к проду uprcnpgmmnvsoxasuhun).
-- Источник: advisors security+performance (раздел 10 AUDIT_2026-06-04.md).

-- ── 10.7 Покрывающие индексы на FK ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversations_ride_id    ON public.conversations(ride_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user2_id   ON public.conversations(user2_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user1_id   ON public.conversations(user1_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_sender   ON public.direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id       ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_notifications_ride_id    ON public.notifications(ride_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id      ON public.reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_rides_vehicle_id         ON public.rides(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_driver_id       ON public.vehicles(driver_id);

-- ── 10.5 Закрепить search_path у оставшихся SECURITY DEFINER функций ──
ALTER FUNCTION public.auto_complete_expired_rides()            SET search_path = public, pg_temp;
ALTER FUNCTION public.cancel_ride(uuid)                        SET search_path = public, pg_temp;
ALTER FUNCTION public.close_expired_auctions()                 SET search_path = public, pg_temp;
ALTER FUNCTION public.complete_trip(uuid)                      SET search_path = public, pg_temp;
ALTER FUNCTION public.get_or_create_conversation(uuid, uuid)   SET search_path = public, pg_temp;
ALTER FUNCTION public.process_expired_auctions()               SET search_path = public, pg_temp;
ALTER FUNCTION public.submit_review(uuid, uuid, integer, text) SET search_path = public, pg_temp;
