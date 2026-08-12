-- ============================================================
-- 20260810_fix_3_4_contact_rate_limit.sql
--
-- Закрывает пункт 3.4 аудита AUDIT_2026-08-10.md:
-- «Форма обратной связи без защиты от спама».
--
-- ПРОБЛЕМА
-- --------
-- contact_messages открыта для anon на INSERT, без капчи и без rate-limit.
-- Каждая вставка запускает триггер notify_contact_telegram → HTTP-запрос
-- через pg_net в Telegram-чат владельца. Скрипт, обращающийся к REST API
-- напрямую (в обход формы на сайте), легко заливает чат и упирается в
-- лимиты Telegram API. В отчёте готового патча для этого пункта не было —
-- решение разработано и проверено отдельно.
--
-- РЕШЕНИЕ
-- -------
-- Два независимых рубежа защиты, оба на уровне базы (форма на фронтенде
-- их не может обойти, потому что это не проверка в браузере, а INSERT
-- через сервисный REST API — ровно тот путь, которым пользуется и спам-
-- скрипт):
--
--   1. Rate-limit по IP: не больше 3 сообщений в час с одного адреса.
--   2. Общий предохранитель: не больше 20 сообщений в час суммарно —
--      защищает от атаки с ротацией IP, когда по IP лимитировать нечем.
--
-- Плюс honeypot-поле `website`: невидимое поле формы, которое настоящий
-- посетитель никогда не заполнит, а простые боты, автозаполняющие все
-- поля формы, — заполнят. Заполненное поле — сообщение отклоняется.
--
-- КАК ОПРЕДЕЛЯЕТСЯ IP И ПОЧЕМУ ИМЕННО ТАК
-- ----------------------------------------
-- PostgREST кладёт заголовки запроса в current_setting('request.headers').
-- Прямая проверка на боевом проекте (через net.http_post на собственный
-- REST-эндпоинт с поддельными заголовками) показала:
--   • X-Forwarded-For клиент подделывает свободно — Cloudflare дописывает
--     свой хоп вторым значением, но первое остаётся ровно тем, что прислал
--     клиент. Доверять ему для лимита нельзя — спам-скрипт впишет туда что
--     угодно и обойдёт лимит с одного и того же реального IP.
--   • CF-Connecting-IP клиент подделать НЕ может: Cloudflare отклоняет
--     сам запрос (403) при попытке клиента задать этот заголовок вручную —
--     значение всегда выставляет сама Cloudflare по реальному TCP-
--     соединению. Поэтому лимит построен на нём.
--
-- ВАЖНО ПРО ПЕРЕЕЗД НА VDS (см. MOVING_CHECKLIST.md)
-- ----------------------------------------------------
-- CF-Connecting-IP — заголовок именно Cloudflare, которая сейчас стоит
-- перед Supabase Cloud. После переезда на арендованный VDS этот заголовок
-- будет отсутствовать, ЕСЛИ Cloudflare (или другой прокси, честно
-- подставляющий IP) не будет настроен перед новым Kong/PostgREST.
-- Функция ниже на этот случай безопасна по умолчанию: при отсутствии
-- заголовка она просто пропускает проверку по IP (v_ip = NULL) и
-- полагается только на общий лимит в 20/час — сообщения не блокируются
-- ошибочно, но и точечная защита по IP перестаёт работать. Это нужно
-- перепроверить после переезда: либо сохранить Cloudflare перед новым
-- сервером, либо адаптировать функцию под заголовок, который будет
-- честно подставлять новый reverse-proxy (например, X-Real-IP от nginx
-- при условии, что nginx сам его выставляет по реальному соединению,
-- а не пробрасывает клиентский).
--
-- ПОЧЕМУ ЛИМИТ ИМЕННО В ТРИГГЕРЕ, А НЕ ТОЛЬКО В RLS-ПОЛИТИКЕ
-- -------------------------------------------------------------
-- Подсчёт «сколько сообщений уже было» — это SELECT с условием, которое
-- WITH CHECK тоже мог бы выполнить, но BEFORE INSERT триггер даёт то же
-- самое проще и позволяет сразу же (в этой же функции) проставить
-- client_ip на основе заголовков запроса, а не значения, присланного
-- клиентом. Это важно: если бы client_ip принимался из тела запроса,
-- спам-скрипт мог бы писать туда что угодно, включая IP другого человека,
-- и путать счётчик. Функция всегда перезаписывает NEW.client_ip
-- вычисленным значением, что бы ни прислал клиент.
--
-- ПРИВАТНОСТЬ
-- -----------
-- client_ip недоступен клиенту на чтение (у anon/authenticated нет SELECT
-- на contact_messages — как и раньше, читать может только владелец БД).
-- В Privacy.tsx добавлено явное упоминание, что IP-адрес отправителя формы
-- обратной связи хранится для защиты от спама.
--
-- ПРОВЕРЕНО НА БОЕВОЙ БАЗЕ (в транзакции с откатом, без реальных
-- отправок в Telegram — pg_net кладёт запрос в свою очередь как обычную
-- INSERT-строку в рамках той же транзакции, откат отменяет и её)
-- ---------------------------------------------------------------
--   3 сообщения с одного IP подряд           → все прошли
--   4-е сообщение с того же IP за тот же час → отклонено
--   сообщение с другого IP                   → прошло (свой счётчик)
--   сообщение с заполненным honeypot         → отклонено RLS-политикой
--   докрутка до 20 сообщений суммарно (разные IP) → все прошли
--   21-е сообщение сверх общего лимита (новый IP) → отклонено
--
-- ОТКАТ
-- -----
--   DROP TRIGGER trg_enforce_contact_rate_limit ON public.contact_messages;
--   DROP FUNCTION public.enforce_contact_rate_limit();
--   вернуть политику contact_insert_any в прежнем виде (без website);
--   ALTER TABLE public.contact_messages DROP COLUMN website, DROP COLUMN client_ip;
--
-- Миграция идемпотентна.
-- ============================================================

begin;

ALTER TABLE public.contact_messages ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.contact_messages ADD COLUMN IF NOT EXISTS client_ip text;

CREATE INDEX IF NOT EXISTS idx_contact_messages_ip_created
  ON public.contact_messages (client_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created
  ON public.contact_messages (created_at);

CREATE OR REPLACE FUNCTION public.enforce_contact_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ip        text;
  v_ip_count  integer;
  v_total     integer;
BEGIN
  -- IP берём только из CF-Connecting-IP (см. комментарий выше про то,
  -- почему не X-Forwarded-For). Любая ошибка разбора заголовков —
  -- не повод блокировать форму, просто не лимитируем по IP.
  v_ip := NULL;
  BEGIN
    v_ip := nullif(btrim(current_setting('request.headers', true)::json->>'cf-connecting-ip'), '');
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  -- Перезаписываем то, что мог прислать клиент — доверяем только
  -- вычисленному значению.
  NEW.client_ip := v_ip;

  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_ip_count
    FROM public.contact_messages
    WHERE client_ip = v_ip AND created_at > now() - interval '1 hour';
    IF v_ip_count >= 3 THEN
      RAISE EXCEPTION 'Слишком много сообщений с вашего адреса. Попробуйте позже.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Общий предохранитель — защищает Telegram-бота даже при ротации IP.
  SELECT count(*) INTO v_total
  FROM public.contact_messages
  WHERE created_at > now() - interval '1 hour';
  IF v_total >= 20 THEN
    RAISE EXCEPTION 'Форма временно перегружена. Попробуйте позже.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_contact_rate_limit ON public.contact_messages;
CREATE TRIGGER trg_enforce_contact_rate_limit
BEFORE INSERT ON public.contact_messages
FOR EACH ROW
EXECUTE FUNCTION public.enforce_contact_rate_limit();

-- Тот же INSERT-чек, что и раньше (длины полей), плюс honeypot.
DROP POLICY IF EXISTS contact_insert_any ON public.contact_messages;
CREATE POLICY contact_insert_any ON public.contact_messages
  FOR INSERT
  WITH CHECK (
    length(btrim(name)) BETWEEN 1 AND 100
    AND length(btrim(message)) BETWEEN 1 AND 2000
    AND (email IS NULL OR length(email) <= 200)
    AND (website IS NULL OR website = '')
  );

commit;
