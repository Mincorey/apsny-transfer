-- Migration: Недостающие индексы (раздел 3.2 плана оптимизации)
-- Дата: 2026-06-04
--
-- На shared-CPU Free-тарифа отсутствие индекса = seq scan = просадка под нагрузкой.
-- Все индексы IF NOT EXISTS — миграция идемпотентна и безопасна при любом состоянии БД
-- (часть индексов могла быть создана ранее в 20260522_schema_fixes.sql).

-- Лента: WHERE type=? AND status='active' (частый запрос Feed.tsx)
CREATE INDEX IF NOT EXISTS idx_rides_type_status   ON public.rides(type, status);

-- MyTrips.tsx: WHERE winner_id = uid
CREATE INDEX IF NOT EXISTS idx_rides_winner_id     ON public.rides(winner_id);

-- fetchBids / выбор победителя: ORDER BY created_at DESC по ride_id
CREATE INDEX IF NOT EXISTS idx_bids_ride_created   ON public.bids(ride_id, created_at DESC);

-- useUnreadCount / Chat: подсчёт непрочитанных по ride_id
CREATE INDEX IF NOT EXISTS idx_messages_ride_read  ON public.messages(ride_id, is_read);

-- TripDetail: проверка существующего отзыва (ride_id, reviewer_id)
CREATE INDEX IF NOT EXISTS idx_reviews_ride_rev    ON public.reviews(ride_id, reviewer_id);

-- Уведомления: выборка непрочитанных пользователя по времени
CREATE INDEX IF NOT EXISTS idx_notif_user_unread   ON public.notifications(user_id, is_read, created_at DESC);
