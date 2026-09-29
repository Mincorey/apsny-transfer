#!/usr/bin/env bash
# ============================================================================
# Перенос базы APSNY-TRANSFER: Supabase Cloud → свой сервер (self-hosted
# Supabase) С СОХРАНЕНИЕМ ПРАВ ДОСТУПА.
#
# Почему не просто pg_dump/pg_restore (как было в MOVING_CHECKLIST.md до
# 29.09.2026): см. АУДИТ-2026-09-29.md, пункт К-3. Коротко —
#   1) --no-privileges выбрасывает все GRANT/REVOKE, на которых держится
#      приватность телефонов и защита денежных функций;
#   2) даже БЕЗ этого флага свежий Supabase при создании таблиц и функций
#      сам раздаёт anon/authenticated полные права («права по умолчанию»),
#      и восстановленные объекты получают больше прав, чем было в облаке;
#   3) триггер на auth.users, политики Storage, таблицы Realtime, задачи
#      pg_cron и секреты Vault в дамп схемы public не входят вообще;
#   4) при загрузке данных срабатывают триггеры — force_ride_draft
#      превратил бы все поездки в черновики.
# Скрипт закрывает все четыре пункта и в конце сам сверяет права
# облака и нового сервера.
#
# ЗАПУСК — на новом сервере, из этой папки, ПОСЛЕ первого запуска стека
# Supabase и ДО того, как на новый сервер пущены пользователи:
#
#   export CLOUD_DB_URL='postgresql://postgres.uprcnpgmmnvsoxasuhun:ПАРОЛЬ@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'
#   export NEW_API_URL='https://api.ВАШ-ДОМЕН'
#   ./migrate-db.sh
#
# CLOUD_DB_URL — строка «Session pooler» из панели Supabase (Connect →
# Session pooler). Прямой адрес db.<ref>.supabase.co работает только по
# IPv6 и с сервера может не открыться.
#
# Повторный запуск на уже заполненной базе скрипт не даёт — проверка в шаге 0.
# ============================================================================
set -euo pipefail

: "${CLOUD_DB_URL:?Задайте CLOUD_DB_URL — строка подключения к базе в облаке}"
: "${NEW_API_URL:?Задайте NEW_API_URL — адрес API нового сервера, например https://api.example.ru}"

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
OLD_API_URL="${OLD_API_URL:-https://uprcnpgmmnvsoxasuhun.supabase.co}"
WORK="${WORK:-./migrate-$(date +%Y%m%d-%H%M)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# Инструменты PostgreSQL берутся из контейнера базы нового сервера — там
# ровно та версия, что нужна. Для проверки скрипта на стенде их можно
# подменить переменными окружения.
SRC_DUMP="${SRC_DUMP:-docker exec -i $DB_CONTAINER pg_dump $CLOUD_DB_URL}"
SRC_PSQL="${SRC_PSQL:-docker exec -i $DB_CONTAINER psql $CLOUD_DB_URL}"
DST_PSQL="${DST_PSQL:-docker exec -i $DB_CONTAINER psql -U supabase_admin -d postgres}"

mkdir -p "$WORK"
chmod 700 "$WORK"
say() { echo; echo "=== $*"; }

# ---------------------------------------------------------------------------
say "0. Проверки перед началом"
SRC_VER=$($SRC_PSQL -XAtc "show server_version_num")
DST_VER=$($DST_PSQL -XAtc "show server_version_num")
echo "   облако: PostgreSQL $SRC_VER, новый сервер: PostgreSQL $DST_VER"
if [ "${SRC_VER:0:2}" != "${DST_VER:0:2}" ]; then
  echo "ОШИБКА: разные основные версии PostgreSQL (${SRC_VER:0:2} и ${DST_VER:0:2})."
  echo "В docker-compose Supabase выставьте образ базы той же версии, что в облаке."
  exit 1
fi
DST_TABLES=$($DST_PSQL -XAtc "select count(*) from pg_tables where schemaname='public'")
if [ "$DST_TABLES" != "0" ]; then
  echo "ОШИБКА: в схеме public нового сервера уже $DST_TABLES таблиц. Скрипт работает только на чистой базе."
  exit 1
fi

# ---------------------------------------------------------------------------
say "1. Выгрузка из облака"
# Схема public С ПРАВАМИ (без --no-privileges!), без владельцев.
$SRC_DUMP --schema-only --schema=public --no-owner \
  | grep -v -E '^(CREATE SCHEMA public;|COMMENT ON SCHEMA public )' > "$WORK/10-schema.sql"
# Данные. Служебные таблицы версий GoTrue и Storage не переносим —
# новый сервер заполнил их сам своими версиями.
$SRC_DUMP --data-only --schema=auth \
  --exclude-table=auth.schema_migrations > "$WORK/20-auth-data.sql"
$SRC_DUMP --data-only --table=storage.buckets  > "$WORK/21-storage-buckets.sql"
$SRC_DUMP --data-only --schema=public          > "$WORK/22-public-data.sql"
# Всё, что живёт вне public (триггер auth.users, политики Storage, Realtime,
# pg_cron, Vault) — готовым SQL.
$SRC_PSQL -X -q -f - < "$HERE/export-extras.sql" > "$WORK/30-extras.sql"
chmod 600 "$WORK"/*.sql
ls -la "$WORK"

# ---------------------------------------------------------------------------
say "2. Загрузка на новый сервер (одной транзакцией)"
{
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"
  echo "-- Выключаем раздачу прав «по умолчанию» на время восстановления,"
  echo "-- иначе новые объекты получат лишние права (см. шапку файла)."
  for r in postgres supabase_admin; do
    for o in tables functions sequences; do
      echo "alter default privileges for role $r in schema public revoke all on $o from anon, authenticated, service_role;"
    done
  done
  echo "set role postgres;"
  cat "$WORK/10-schema.sql"
  echo "reset role;"
  echo "-- Данные грузим без триггеров: иначе force_ride_draft сделал бы"
  echo "-- все поездки черновиками, а handle_new_user дублировал профили."
  echo "set session_replication_role = replica;"
  cat "$WORK/20-auth-data.sql" "$WORK/21-storage-buckets.sql" "$WORK/22-public-data.sql"
  echo "set session_replication_role = origin;"
  echo "set search_path to default;"
  echo "-- Адреса аватаров и фото машин — на новый сервер."
  echo "update public.users    set avatar_url = replace(avatar_url, '$OLD_API_URL', '$NEW_API_URL') where avatar_url like '$OLD_API_URL%';"
  echo "update public.vehicles set photo_url  = replace(photo_url,  '$OLD_API_URL', '$NEW_API_URL') where photo_url  like '$OLD_API_URL%';"
  cat "$WORK/30-extras.sql"
  echo "-- Возвращаем стандартное поведение Supabase для будущих объектов."
  for r in postgres supabase_admin; do
    for o in tables functions sequences; do
      echo "alter default privileges for role $r in schema public grant all on $o to anon, authenticated, service_role;"
    done
  done
  echo "commit;"
} | $DST_PSQL -X -q > "$WORK/import.log"
echo "   загружено без ошибок"

# Секреты Vault больше нигде не нужны — файл с ними удаляем.
shred -u "$WORK/30-extras.sql" 2>/dev/null || rm -f "$WORK/30-extras.sql"

# ---------------------------------------------------------------------------
say "3. Сверка прав, политик и функций: облако ↔ новый сервер"
$SRC_PSQL -X -At -F' | ' -f - < "$HERE/verify-grants.sql" > "$WORK/verify-cloud.txt"
$DST_PSQL -X -At -F' | ' -f - < "$HERE/verify-grants.sql" > "$WORK/verify-new.txt"
if diff -u "$WORK/verify-cloud.txt" "$WORK/verify-new.txt"; then
  echo "   ✅ Все разделы совпали:"
  sed 's/^/      /' "$WORK/verify-new.txt"
else
  echo
  echo "   ❌ РАЗДЕЛЫ ВЫШЕ НЕ СОВПАЛИ. Переезд не завершён — пользователей"
  echo "      на новый сервер не пускать. Разбор — в конце verify-grants.sql."
  exit 1
fi

say "4. Сверка количества строк"
COUNT_SQL="select 'users='||(select count(*) from public.users)||' rides='||(select count(*) from public.rides)||' bids='||(select count(*) from public.bids)||' reviews='||(select count(*) from public.reviews)||' notifications='||(select count(*) from public.notifications)||' payments='||(select count(*) from public.payments)||' auth.users='||(select count(*) from auth.users)"
C1=$($SRC_PSQL -XAtc "$COUNT_SQL"); C2=$($DST_PSQL -XAtc "$COUNT_SQL")
echo "   облако:      $C1"; echo "   новый сервер: $C2"
[ "$C1" = "$C2" ] || { echo "   ❌ Количество строк не совпало"; exit 1; }
echo "   ✅ совпало"

say "Готово"
echo "Дампы лежат в $WORK — в них персональные данные и хеши паролей."
echo "Перенесите их в надёжное место или удалите после проверки сайта."
echo "Дальше: файлы Storage (copy-storage.mjs) и шаги из MOVING_CHECKLIST.md, раздел 4."
