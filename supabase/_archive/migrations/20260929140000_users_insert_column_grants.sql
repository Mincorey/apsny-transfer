-- Аудит 29.09.2026, пункт В-3.
--
-- Права на INSERT в users были табличными — то есть на ВСЕ колонки, включая
-- rating, trips_count, show_*, avatar_url. Проверено на стенде: вошедший
-- пользователь, у которого ещё нет профиля, мог создать его сразу с
-- rating = 5 и trips_count = 200. Защита держалась только на том, что
-- триггер handle_new_user всегда успевает создать профиль первым.
--
-- Для UPDATE это закрыли ещё 10.08 (20260810_fix_1_2_users_update_grants.sql);
-- здесь то же самое для INSERT.
--
-- Оставляем ровно те колонки, которые вставляет запасной путь в Auth.tsx
-- (если триггер не сработал): id, email, full_name, phone, role, telegram,
-- whatsapp — плюс max для симметрии с правами на UPDATE. Всё остальное
-- заполняется значениями по умолчанию. У anon INSERT не нужен вовсе:
-- без входа auth.uid() пустой, и политика users_insert_own его и так гасит.
--
-- Профиль, который создаёт триггер handle_new_user, это не затрагивает —
-- триггер работает с правами владельца функции.

revoke insert on public.users from anon, authenticated;

grant insert (id, email, full_name, phone, role, telegram, whatsapp, max)
  on public.users to authenticated;
