-- ============================================================
-- 20260810_fix_1_1_rides_update_grants.sql
--
-- Закрывает пункт 1.1 аудита AUDIT_2026-08-10.md:
-- «Поездку можно опубликовать бесплатно, в обход оплаты».
--
-- ПРОБЛЕМА
-- --------
-- Ролям anon и authenticated был выдан GRANT UPDATE на ВСЕ 23 колонки
-- таблицы rides, а RLS-политика rides_update_own имела только USING
-- (auth.uid() = creator_id) без WITH CHECK. В сумме это позволяло владельцу
-- поездки одним REST-запросом сделать всё, что должен делать только сервер:
--
--   PATCH /rest/v1/rides?id=eq.<мой_черновик>
--   {"status": "active", "auction_end_time": "..."}   → публикация без оплаты
--   {"winner_id": "<я>", "current_price": 1}          → подкрутка аукциона
--
-- Триггер trg_force_ride_draft не спасал — он стоит только на BEFORE INSERT.
-- Отсутствие WITH CHECK дополнительно позволяло переписать creator_id,
-- то есть «подарить» свою поездку другому пользователю или отобрать чужую.
--
-- ИСТОРИЯ РЕГРЕССИИ
-- -----------------
-- Миграция 20260522_fix_rides_update_policy.sql эту политику уже удаляла
-- по этой же причине. Миграция 20260613_harden_02_rls_dedupe_initplan.sql
-- при массовой переработке политик воссоздала её заново (строка 30),
-- вернув дыру. Данная миграция закрывает её повторно и уже на двух уровнях.
--
-- РЕШЕНИЕ
-- -------
-- 1. Полностью отозвать UPDATE на rides у клиентских ролей. Проверено по коду:
--    фронтенд не выполняет ни одного прямого .update() на таблицу rides —
--    все изменения идут через RPC (publish_ride_free, place_bid,
--    accept_current_price, close_auction_early, cancel_ride, complete_trip,
--    finish_auction). Эти функции объявлены SECURITY DEFINER и выполняются
--    от имени владельца БД, поэтому отзыв клиентских грантов их не затрагивает.
-- 2. Оставить политику rides_update_own, но добавить в неё WITH CHECK —
--    как второй рубеж на случай, если в будущем кто-то по ошибке снова
--    выдаст GRANT UPDATE.
-- 3. Отозвать INSERT у anon: создать поездку аноним всё равно не может
--    (политика rides_insert_auth требует auth.uid() = creator_id), но грант
--    без применения — лишняя поверхность атаки.
--
-- ОТКАТ
-- -----
--   GRANT INSERT, UPDATE ON public.rides TO anon, authenticated;
-- (делать так не следует — это возвращает дыру)
--
-- ЕСЛИ ПОНАДОБИТСЯ РЕДАКТИРОВАНИЕ ПОЕЗДКИ
-- ---------------------------------------
-- Не возвращать общий GRANT UPDATE. Правильный путь — отдельная миграция
-- с точечным грантом на безопасные колонки:
--   GRANT UPDATE (origin, destination, departure_date, departure_time,
--                 seats, border_crossing, comment, amenities, vehicle_id)
--     ON public.rides TO authenticated;
-- Либо, что надёжнее, SECURITY DEFINER функция edit_ride(), которая заодно
-- проверит, что поездка ещё в статусе draft и на неё нет ставок.
--
-- Миграция идемпотентна, применяется повторно без последствий.
-- ============================================================

begin;

-- 1) Клиент больше не может писать в rides напрямую.
revoke update on public.rides from anon, authenticated;
revoke insert on public.rides from anon;

-- 2) Второй рубеж: политика с WITH CHECK.
--    Без грантов она не срабатывает, но защитит, если грант вернут по ошибке.
drop policy if exists rides_update_own on public.rides;
create policy rides_update_own on public.rides
  for update to authenticated
  using      ((select auth.uid()) = creator_id)
  with check ((select auth.uid()) = creator_id);

commit;
