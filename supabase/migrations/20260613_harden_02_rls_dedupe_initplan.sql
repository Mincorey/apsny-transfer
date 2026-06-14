-- Харднинг БД 2026-06-13, часть 2 (применено к проду uprcnpgmmnvsoxasuhun).
-- Сброс и пересоздание всех RLS-политик public:
--  • дедупликация (10.8), оптимизация initplan (10.6: (select auth.uid())),
--  • notifications: запрет клиентского INSERT (10.3) — пишут только SECURITY DEFINER функции,
--  • messages: доступ только участникам поездки (закрыта дыра «любой залогиненный
--    читает/правит чужие сообщения» — широкие «английские» политики удалены).

-- users
DROP POLICY IF EXISTS users_select_all ON public.users;
DROP POLICY IF EXISTS users_insert_own ON public.users;
DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_select_all ON public.users FOR SELECT USING (true);
CREATE POLICY users_insert_own ON public.users FOR INSERT WITH CHECK ((select auth.uid()) = id);
CREATE POLICY users_update_own ON public.users FOR UPDATE USING ((select auth.uid()) = id);

-- vehicles (ALL → раздельные команды, чтобы убрать дубль SELECT)
DROP POLICY IF EXISTS vehicles_all_own    ON public.vehicles;
DROP POLICY IF EXISTS vehicles_select_all ON public.vehicles;
CREATE POLICY vehicles_select_all ON public.vehicles FOR SELECT USING (true);
CREATE POLICY vehicles_insert_own ON public.vehicles FOR INSERT WITH CHECK ((select auth.uid()) = driver_id);
CREATE POLICY vehicles_update_own ON public.vehicles FOR UPDATE USING ((select auth.uid()) = driver_id) WITH CHECK ((select auth.uid()) = driver_id);
CREATE POLICY vehicles_delete_own ON public.vehicles FOR DELETE USING ((select auth.uid()) = driver_id);

-- rides
DROP POLICY IF EXISTS rides_select_all ON public.rides;
DROP POLICY IF EXISTS rides_insert_auth ON public.rides;
DROP POLICY IF EXISTS rides_update_own ON public.rides;
CREATE POLICY rides_select_all ON public.rides FOR SELECT USING (true);
CREATE POLICY rides_insert_auth ON public.rides FOR INSERT WITH CHECK ((select auth.uid()) = creator_id);
CREATE POLICY rides_update_own ON public.rides FOR UPDATE USING ((select auth.uid()) = creator_id);

-- bids
DROP POLICY IF EXISTS bids_select_all ON public.bids;
DROP POLICY IF EXISTS bids_insert_auth ON public.bids;
CREATE POLICY bids_select_all ON public.bids FOR SELECT USING (true);
CREATE POLICY bids_insert_auth ON public.bids FOR INSERT WITH CHECK ((select auth.uid()) = bidder_id);

-- conversations
DROP POLICY IF EXISTS conv_select_participant ON public.conversations;
DROP POLICY IF EXISTS conv_insert_participant ON public.conversations;
DROP POLICY IF EXISTS conv_update_participant ON public.conversations;
CREATE POLICY conv_select_participant ON public.conversations FOR SELECT
  USING (((select auth.uid()) = user1_id) OR ((select auth.uid()) = user2_id));
CREATE POLICY conv_insert_participant ON public.conversations FOR INSERT
  WITH CHECK (((select auth.uid()) = user1_id) OR ((select auth.uid()) = user2_id));
CREATE POLICY conv_update_participant ON public.conversations FOR UPDATE
  USING (((select auth.uid()) = user1_id) OR ((select auth.uid()) = user2_id));

-- direct_messages
DROP POLICY IF EXISTS dm_select_participant ON public.direct_messages;
DROP POLICY IF EXISTS dm_insert_sender ON public.direct_messages;
DROP POLICY IF EXISTS dm_update_participant ON public.direct_messages;
CREATE POLICY dm_select_participant ON public.direct_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.conversations c
                 WHERE c.id = direct_messages.conversation_id
                   AND ((c.user1_id = (select auth.uid())) OR (c.user2_id = (select auth.uid())))));
CREATE POLICY dm_insert_sender ON public.direct_messages FOR INSERT
  WITH CHECK ((select auth.uid()) = sender_id);
CREATE POLICY dm_update_participant ON public.direct_messages FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.conversations c
                 WHERE c.id = direct_messages.conversation_id
                   AND ((c.user1_id = (select auth.uid())) OR (c.user2_id = (select auth.uid())))));

-- messages (убраны широкие «английские» политики; доступ только участникам)
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Авторизованные отправляют сообще"       ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can read messages"  ON public.messages;
DROP POLICY IF EXISTS "Участники поездки видят сообщения"      ON public.messages;
DROP POLICY IF EXISTS "Users can mark messages as read"        ON public.messages;
DROP POLICY IF EXISTS "Участники обновляют статус прочте"      ON public.messages;
CREATE POLICY msg_select_participant ON public.messages FOR SELECT
  USING ((EXISTS (SELECT 1 FROM public.rides r
                  WHERE r.id = messages.ride_id
                    AND ((r.creator_id = (select auth.uid())) OR (r.winner_id = (select auth.uid())))))
      OR (EXISTS (SELECT 1 FROM public.bids b
                  WHERE b.ride_id = messages.ride_id AND b.bidder_id = (select auth.uid()))));
CREATE POLICY msg_insert_sender ON public.messages FOR INSERT
  WITH CHECK ((select auth.uid()) = sender_id);
CREATE POLICY msg_update_participant ON public.messages FOR UPDATE
  USING ((EXISTS (SELECT 1 FROM public.rides r
                  WHERE r.id = messages.ride_id
                    AND ((r.creator_id = (select auth.uid())) OR (r.winner_id = (select auth.uid())))))
      OR (EXISTS (SELECT 1 FROM public.bids b
                  WHERE b.ride_id = messages.ride_id AND b.bidder_id = (select auth.uid()))));

-- reviews
DROP POLICY IF EXISTS reviews_select_all ON public.reviews;
DROP POLICY IF EXISTS reviews_insert_auth ON public.reviews;
CREATE POLICY reviews_select_all ON public.reviews FOR SELECT USING (true);
CREATE POLICY reviews_insert_auth ON public.reviews FOR INSERT WITH CHECK ((select auth.uid()) = reviewer_id);

-- notifications (клиентский INSERT запрещён; пишут только SECURITY DEFINER функции)
DROP POLICY IF EXISTS notif_insert_system ON public.notifications;
DROP POLICY IF EXISTS "Система создаёт уведомления" ON public.notifications;
DROP POLICY IF EXISTS notif_select_own ON public.notifications;
DROP POLICY IF EXISTS notif_update_own ON public.notifications;
DROP POLICY IF EXISTS "Пользователь помечает свои уведом" ON public.notifications;
CREATE POLICY notif_select_own ON public.notifications FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY notif_update_own ON public.notifications FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY notif_insert_none ON public.notifications FOR INSERT WITH CHECK (false);
