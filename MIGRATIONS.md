# MIGRATIONS.md — Состояние миграций БД

## Канонический источник схемы

| Файл | Назначение |
|------|-----------|
| `supabase_schema_v2.sql` | Эталонная схема для **чистого развёртывания** (применяется один раз на пустой БД) |
| `supabase/migrations/` | **Канонический** каталог инкрементальных миграций (для уже развёрнутой БД) |
| `migrations/` | **УСТАРЕЛ.** Старые миграции, заменены `supabase/migrations/`. Не применять. |

---

## Порядок применения миграций (`supabase/migrations/`)

Применять **строго по порядку** в Supabase Dashboard → SQL Editor:

| № | Файл | Что делает |
|---|------|-----------|
| 1 | `20260519_add_max_contacts.sql` | Добавляет поле `max` в таблицу `users` |
| 2 | `20260522_schema_fixes.sql` | Добавляет `rides.amenities`, `rides.cancelled_at`, таблицу `messages` с RLS |
| 3 | `20260522_fix_notifications_rls.sql` | Запрещает прямую вставку уведомлений через REST API |
| 4 | `20260522_fix_users_anon_access.sql` | REVOKE контактных полей (`phone`, `telegram`, `whatsapp`) от роли `anon` |
| 5 | `20260522_fix_rides_update_policy.sql` | Удаляет политику UPDATE на `rides` (обходила бизнес-логику) |
| 6 | `20260522_fix_auction_status_lifecycle.sql` | Исправляет `close_auction_early`, `finish_auction` (→ `booked`), добавляет `complete_trip` |
| 7 | `20260522_fix_misc_bugs.sql` | `cancel_ride` cancelled_at, `submit_review` winner-only, `complete_trip` trips_count, `place_bid` дубликаты |
| 8 | `20260522_fix_cron_jobs.sql` | pg_cron: авто-завершение аукционов и поездок по таймеру |

---

## Что уже устарело

- `migrations/002_booked_status.sql` — заменено миграциями 6 и 8 выше. Функции переработаны,
  cron-задача заменена правильной функцией-обёрткой с обновлением `trips_count`.

---

## Чистое развёртывание (новая БД)

1. Применить `supabase_schema_v2.sql` целиком
2. Применить все миграции из таблицы выше (они идемпотентны — `CREATE OR REPLACE`, `IF NOT EXISTS`)

---

## pg_cron

Миграция `20260522_fix_cron_jobs.sql` создаёт две задачи pg_cron.
pg_cron доступен на Supabase Pro и выше. Если расширение не установлено,
миграция выводит NOTICE и пропускает создание задач — приложение работает,
но аукционы не завершаются автоматически по таймеру.
