-- ============================================================
-- 20260810_fix_1_2_users_update_grants.sql
--
-- Закрывает пункт 1.2 аудита AUDIT_2026-08-10.md:
-- «Пользователь может накрутить себе рейтинг и счётчик поездок».
--
-- ПРОБЛЕМА
-- --------
-- Ролям anon и authenticated был выдан GRANT UPDATE на ВСЕ 16 колонок таблицы
-- users, а RLS-политика users_update_own имела только USING (auth.uid() = id)
-- без WITH CHECK. Любой авторизованный мог одним REST-запросом написать себе
-- что угодно:
--
--   PATCH /rest/v1/users?id=eq.<я>
--   {"rating": 5.0, "trips_count": 999}
--
-- Рейтинг корректно пересчитывается функцией submit_review, но защиты
-- «только через функцию» не было — колонка была открыта на прямую запись.
-- Рейтинг это ключевой фактор выбора водителя на площадке, его подделка —
-- репутационный и потенциально юридический риск (недостоверные сведения
-- об услуге).
--
-- Помимо rating и trips_count из аудита, на прямую запись были открыты ещё
-- четыре колонки, которые пользователь менять не должен:
--   role       — самовольная смена «пассажир» ↔ «водитель»;
--   email      — расхождение с auth.users, порча учётной записи;
--   id         — без WITH CHECK строку можно было «увести» на чужой uid;
--   created_at — подделка даты регистрации («на площадке с 2019 года»).
--
-- РЕШЕНИЕ
-- -------
-- 1. Отозвать UPDATE у клиентских ролей и выдать заново точечно — только на
--    те 10 колонок, которые реально правит интерфейс:
--      full_name, avatar_url, telegram, whatsapp, max, phone,
--      show_phone, show_telegram, show_whatsapp, show_max
--    Соответствие проверено по коду: Profile.handleSaveProfile (full_name,
--    telegram, whatsapp, max), загрузка аватара (avatar_url),
--    handlePrivacyToggle (четыре show_*). Поле phone интерфейс сейчас только
--    показывает, но оно оставлено доступным — это собственный контакт
--    пользователя, на доверие к площадке он не влияет.
-- 2. rating и trips_count теперь меняются исключительно через SECURITY DEFINER
--    функции submit_review, complete_trip и auto_complete_expired_rides.
--    Они выполняются от имени владельца БД, поэтому отзыв клиентских грантов
--    их не затрагивает — проверено тестом.
-- 3. Политику users_update_own пересоздать с WITH CHECK — иначе пользователь
--    мог бы переписать свой id и «отдать» строку другому пользователю.
--
-- СВЯЗАННАЯ ПРАВКА ВО ФРОНТЕНДЕ (обязательна, применяется вместе)
-- --------------------------------------------------------------
-- src/pages/Auth.tsx использовал upsert для страховочного создания профиля.
-- Postgres разворачивает upsert в INSERT ... ON CONFLICT DO UPDATE и требует
-- прав UPDATE на все колонки в списке — включая email и role. После этой
-- миграции такой запрос падал бы с permission denied всегда. Заменено на
-- обычный insert: профиль создаётся, если его нет, а если он уже создан
-- триггером handle_new_user — возвращается ошибка дубликата ключа, которая
-- в коде и так проглатывается. Регистрация не страдает.
--
-- ОТКАТ
-- -----
--   GRANT UPDATE ON public.users TO anon, authenticated;
-- (делать так не следует — это возвращает накрутку рейтинга)
--
-- Миграция идемпотентна, применяется повторно без последствий.
-- ============================================================

begin;

-- 1) Снимаем сплошной грант и выдаём точечный.
revoke update on public.users from anon, authenticated;

grant update (full_name, avatar_url, telegram, whatsapp, max, phone,
              show_phone, show_telegram, show_whatsapp, show_max)
  on public.users to authenticated;
-- rating, trips_count, role, email, id, created_at — только через функции.

-- 2) Политика с WITH CHECK: нельзя переписать id и увести строку.
drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update to authenticated
  using      ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

commit;
