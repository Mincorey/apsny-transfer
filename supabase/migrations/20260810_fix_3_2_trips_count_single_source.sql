-- ============================================================
-- 20260810_fix_3_2_trips_count_single_source.sql
--
-- Закрывает пункт 3.2 аудита AUDIT_2026-08-10.md:
-- «Счётчик поездок считается по-разному».
--
-- ПРОБЛЕМА
-- --------
-- Поездку можно завершить двумя путями, и считали они по-разному:
--   • auto_complete_expired_rides (cron, ежечасно) — переводила поездку
--     в 'completed' И увеличивала trips_count обоим участникам;
--   • complete_trip (кнопка «Завершить поездку» в интерфейсе) — только
--     меняла статус, счётчик не трогала вовсе.
--
-- В итоге у тех, кто закрывает поездки вручную, счётчик занижен. На момент
-- правки расхождение видно на боевых данных: у обоих активных пользователей
-- trips_count = 5 при шести фактически завершённых поездках. Одна поездка
-- была закрыта кнопкой — она и не посчиталась.
--
-- Счётчик поездок виден в профиле и в ленте рядом с рейтингом, то есть
-- напрямую влияет на то, кого выберут. Занижать его нечестно.
--
-- РЕШЕНИЕ — ЕДИНЫЙ ИСТОЧНИК
-- -------------------------
-- Вместо того чтобы дублировать увеличение счётчика в каждой функции (и
-- ловить такое расхождение снова при появлении третьего пути), подсчёт
-- перенесён на триггер таблицы rides. Он срабатывает при любом переходе
-- статуса в 'completed', откуда бы этот переход ни пришёл.
--
--   AFTER UPDATE OF status ON rides
--   WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
--
-- Условие с OLD.status защищает от двойного счёта: повторное обновление
-- уже завершённой поездки счётчик не тронет.
--
-- Соответственно из auto_complete_expired_rides убрано ручное увеличение —
-- иначе счёт был бы двойным. Заодно функция упрощена: цикл по строкам
-- заменён одним UPDATE, что и быстрее, и понятнее.
-- complete_trip менять не потребовалось — триггер срабатывает и на ней.
--
-- ПЕРЕСЧЁТ НАКОПЛЕННОГО
-- ---------------------
-- Уже занижённые значения приводятся к фактическим: считается число
-- завершённых поездок, где пользователь был создателем ИЛИ победителем.
-- Пересчёт разовый и идемпотентный — повторное применение ничего не сломает.
--
-- ЗАМЕЧАНИЕ ПО ТЕСТИРОВАНИЮ (на будущее)
-- --------------------------------------
-- При проверке этой правки легко получить ложный результат. Триггер
-- force_ride_draft на BEFORE INSERT принудительно обнуляет winner_id
-- и ставит status = 'draft'. Если в тесте создать поездку сразу с
-- winner_id, он не сохранится, победителя у поездки не будет, и счётчик
-- вырастет только у создателя — можно ошибочно решить, что патч не работает.
-- Победителя нужно назначать отдельным UPDATE уже после вставки.
--
-- ПРОВЕРЕНО НА БОЕВОЙ БАЗЕ (в транзакции с откатом)
-- -------------------------------------------------
--   было 5 / 5 (создатель / победитель)
--   ручное завершение кнопкой  → 6 / 6
--   авто-завершение по таймеру → 7 / 7
--   повторные вызовы обоих путей → осталось 7 / 7 (двойного счёта нет)
--
-- ОТКАТ
-- -----
--   DROP TRIGGER trg_sync_trips_count ON public.rides;
--   DROP FUNCTION public.sync_trips_count();
-- и вернуть прежнее тело auto_complete_expired_rides.
--
-- Миграция идемпотентна.
-- ============================================================

begin;

-- 1) Единая точка подсчёта: срабатывает на любом переходе в 'completed'.
create or replace function public.sync_trips_count()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
BEGIN
  -- winner_id может быть NULL — тогда обновится только строка создателя.
  UPDATE public.users
  SET trips_count = trips_count + 1
  WHERE id IN (NEW.creator_id, NEW.winner_id);
  RETURN NEW;
END;
$$;

drop trigger if exists trg_sync_trips_count on public.rides;
create trigger trg_sync_trips_count
after update of status on public.rides
for each row
when (new.status = 'completed' and old.status is distinct from 'completed')
execute function public.sync_trips_count();

-- 2) Убираем ручное увеличение из авто-завершения (иначе двойной счёт).
--    Заодно цикл заменён одним UPDATE.
create or replace function public.auto_complete_expired_rides()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
BEGIN
    -- trips_count увеличивает триггер trg_sync_trips_count.
    UPDATE public.rides
    SET status = 'completed'
    WHERE status = 'booked'
      AND (departure_date + departure_time)::timestamptz + INTERVAL '24 hours' < now();
END;
$$;

-- 3) Разовый пересчёт накопленных значений.
update public.users u
set trips_count = f.cnt
from (
  select u2.id,
         (select count(*) from public.rides r
           where r.status = 'completed'
             and (r.creator_id = u2.id or r.winner_id = u2.id)) as cnt
  from public.users u2
) f
where f.id = u.id
  and u.trips_count is distinct from f.cnt;

commit;
