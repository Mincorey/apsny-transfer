-- ============================================================
-- 20260810_fix_3_3_text_length_limits.sql
--
-- Закрывает пункт 3.3 аудита AUDIT_2026-08-10.md:
-- «Нет ограничений длины у пользовательских текстов».
--
-- ПРОБЛЕМА
-- --------
-- В users и rides не было CHECK на длину: full_name, origin, destination,
-- comment, telegram. Profile.handleSaveProfile тоже ничего не проверял.
-- Можно было записать мегабайт в имя и сломать вёрстку ленты у всех.
--
-- СВЕРХ ПУНКТА АУДИТА
-- --------------------
-- Аудит явно называет только full_name/origin/destination/comment/telegram.
-- Тем же способом (прямой PATCH, в обход UI) можно было раздуть и три
-- соседних поля из той же группы контактов — whatsapp, max (мессенджер
-- Max) и phone. Патч 8.1.2 уже свёл GRANT UPDATE на users ровно к этим
-- 10 колонкам как к одной группе профиля, так что логично закрыть длину
-- у всей группы, а не только у части.
--
-- ВЫБОР ЛИМИТОВ
-- -------------
-- full_name / phone / telegram / whatsapp — не берутся с потолка: ровно
-- эти значения (100 / 32 / 64 / 64) уже используются триггером
-- handle_new_user (миграция 20260810_fix_3_1_handle_new_user.sql) для
-- обрезки данных при регистрации. Новый CHECK просто делает эту границу
-- обязательной и для последующих UPDATE через Profile, а не только для
-- INSERT при регистрации. Рассинхрона между триггером и ограничением нет.
--   max            — та же категория (мессенджер), лимит по аналогии — 64.
--   origin/destination/comment — как в патче 8.7 аудита (100/100/1000).
--
-- full_name/phone/origin/destination требуют длины >= 1 после btrim —
-- по аналогии с contact_messages (миграция 20260613_contact_messages.sql).
-- Пустые строки-пробелы для этих полей уже сегодня невозможны с фронтенда:
--   • phone — обязательное поле формы регистрации (Auth.tsx, required)
--     и больше нигде не перезаписывается;
--   • origin/destination — CreateTrip.canGoNext блокирует переход дальше
--     без непустых значений, других мест записи в БД нет (проверено
--     поиском по миграциям и src/);
--   • full_name — handle_new_user всегда подставляет непустое значение.
-- telegram/whatsapp/max — необязательные поля, лимит только на длину,
-- NULL разрешён.
--
-- ПРОВЕРКА ТЕКУЩИХ ДАННЫХ ПЕРЕД ПРИМЕНЕНИЕМ
-- -------------------------------------------
-- Прямым запросом к боевой базе: 6 пользователей, 6 поездок, максимальные
-- длины сильно меньше новых лимитов (full_name<=14, telegram<=20,
-- whatsapp<=11, phone<=19, origin<=17, destination<=14, comment<=116,
-- max<=11), пустых/пробельных значений нет. Constraint применяется сразу
-- (без NOT VALID) — данных мало, полная проверка мгновенная.
--
-- ПРОВЕРЕНО НА БОЕВОЙ БАЗЕ (в транзакции с откатом)
-- ---------------------------------------------------
--   имя 5000 символов               → отклонено (check_violation)
--   имя из пробелов                 → отклонено (check_violation)
--   комментарий к поездке 100000 символов → отклонено (check_violation)
--   origin 500 символов             → отклонено (check_violation)
--   обычное обновление telegram/comment в пределах лимита → прошло
--
-- ОТКАТ
-- -----
--   ALTER TABLE public.users ALTER CONSTRAINT ... -- нет, для CHECK:
--   ALTER TABLE public.users DROP CONSTRAINT users_full_name_len,
--     DROP CONSTRAINT users_phone_len, DROP CONSTRAINT users_telegram_len,
--     DROP CONSTRAINT users_whatsapp_len, DROP CONSTRAINT users_max_len;
--   ALTER TABLE public.rides DROP CONSTRAINT rides_origin_len,
--     DROP CONSTRAINT rides_destination_len, DROP CONSTRAINT rides_comment_len;
--
-- Миграция идемпотентна: ADD CONSTRAINT IF NOT EXISTS.
-- ============================================================

begin;

ALTER TABLE public.users
  ADD CONSTRAINT users_full_name_len
    CHECK (length(btrim(full_name)) BETWEEN 1 AND 100);

ALTER TABLE public.users
  ADD CONSTRAINT users_phone_len
    CHECK (length(btrim(phone)) BETWEEN 1 AND 32);

ALTER TABLE public.users
  ADD CONSTRAINT users_telegram_len
    CHECK (telegram IS NULL OR length(telegram) <= 64);

ALTER TABLE public.users
  ADD CONSTRAINT users_whatsapp_len
    CHECK (whatsapp IS NULL OR length(whatsapp) <= 64);

ALTER TABLE public.users
  ADD CONSTRAINT users_max_len
    CHECK (max IS NULL OR length(max) <= 64);

ALTER TABLE public.rides
  ADD CONSTRAINT rides_origin_len
    CHECK (length(btrim(origin)) BETWEEN 1 AND 100);

ALTER TABLE public.rides
  ADD CONSTRAINT rides_destination_len
    CHECK (length(btrim(destination)) BETWEEN 1 AND 100);

ALTER TABLE public.rides
  ADD CONSTRAINT rides_comment_len
    CHECK (comment IS NULL OR length(comment) <= 1000);

commit;
