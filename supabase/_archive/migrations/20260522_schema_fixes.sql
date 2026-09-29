-- Migration 003: Document missing fields and table
--
-- Three objects were added directly via Supabase Dashboard without migration files:
--   1. rides.amenities  TEXT[]        -- удобства поездки (WiFi, кондиционер, и т.д.)
--   2. rides.cancelled_at TIMESTAMPTZ -- когда поездка была отменена (для фильтра Feed)
--   3. messages            TABLE       -- групповой чат поездки
--
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- so this migration is safe to run on any DB state.

-- ─── 1. rides.amenities ─────────────────────────────────────────────────────
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS amenities TEXT[] DEFAULT '{}';

-- ─── 2. rides.cancelled_at ──────────────────────────────────────────────────
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- ─── 3. Update cancel_ride to populate cancelled_at ─────────────────────────
-- (previously only set status = 'cancelled', leaving cancelled_at NULL,
--  which broke Feed.tsx filter: status.eq.cancelled,cancelled_at.gte.<yesterday>)
CREATE OR REPLACE FUNCTION cancel_ride(p_ride_id UUID) RETURNS jsonb AS $$
DECLARE
    v_ride RECORD;
BEGIN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Поездка не найдена';
    END IF;

    IF v_ride.status != 'active' THEN
        RAISE EXCEPTION 'Можно отменить только активные поездки';
    END IF;

    UPDATE public.rides
    SET status = 'cancelled', cancelled_at = now()
    WHERE id = p_ride_id;

    INSERT INTO public.notifications (user_id, type, title, body, ride_id)
    SELECT DISTINCT bidder_id, 'ride_cancelled', 'Поездка отменена', NULL, p_ride_id
    FROM public.bids
    WHERE ride_id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 4. messages table (ride group chat) ────────────────────────────────────
-- Chat.tsx uses this table for per-ride group messaging.
-- direct_messages is a separate table for 1-on-1 conversations.
CREATE TABLE IF NOT EXISTS public.messages (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id    UUID        NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    sender_id  UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content    TEXT        NOT NULL,
    is_read    BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- ─── 5. RLS for messages ────────────────────────────────────────────────────
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- SELECT: creator, winner, or anyone who placed a bid on this ride
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'messages' AND policyname = 'Участники поездки видят сообщения'
  ) THEN
    CREATE POLICY "Участники поездки видят сообщения" ON public.messages
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.rides r
          WHERE r.id = ride_id
            AND (r.creator_id = auth.uid() OR r.winner_id = auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM public.bids b
          WHERE b.ride_id = messages.ride_id AND b.bidder_id = auth.uid()
        )
      );
  END IF;
END $$;

-- INSERT: only the authenticated sender
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'messages' AND policyname = 'Авторизованные отправляют сообщения в чат'
  ) THEN
    CREATE POLICY "Авторизованные отправляют сообщения в чат" ON public.messages
      FOR INSERT WITH CHECK (auth.uid() = sender_id);
  END IF;
END $$;

-- UPDATE: mark messages as read (same access as SELECT)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'messages' AND policyname = 'Участники обновляют статус прочтения сообщений'
  ) THEN
    CREATE POLICY "Участники обновляют статус прочтения сообщений" ON public.messages
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM public.rides r
          WHERE r.id = ride_id
            AND (r.creator_id = auth.uid() OR r.winner_id = auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM public.bids b
          WHERE b.ride_id = messages.ride_id AND b.bidder_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ─── 6. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_ride_id   ON public.messages(ride_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread     ON public.messages(ride_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_rides_winner_id     ON public.rides(winner_id);
CREATE INDEX IF NOT EXISTS idx_rides_cancelled_at  ON public.rides(cancelled_at) WHERE status = 'cancelled';
CREATE INDEX IF NOT EXISTS idx_rides_type_status   ON public.rides(type, status);
