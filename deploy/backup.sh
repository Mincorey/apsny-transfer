#!/usr/bin/env bash
#
# Резервное копирование базы APSNY-TRANSFER с проверкой восстановления.
#
# В облаке бэкапы делались сами. На своём сервере их нет, пока не сделаешь —
# и это первое, что нужно настроить после переезда, до всего остального.
#
# Главное здесь — не сам дамп, а строки после него. Непроверенный бэкап
# бэкапом не является: файл может писаться каждую ночь, весить правдоподобно
# и не восстанавливаться. Узнать об этом в день аварии — худший из вариантов.
# Поэтому скрипт после каждого дампа поднимает его во временную базу и
# пересчитывает строки в ключевых таблицах.
#
# Установка:
#   cp backup.sh /usr/local/bin/apsny-backup && chmod +x /usr/local/bin/apsny-backup
#   crontab -e
#   17 4 * * * /usr/local/bin/apsny-backup >> /var/log/apsny-backup.log 2>&1
#
# Хранить копии на ДРУГОМ диске или в другом месте. Бэкап на том же диске
# защищает только от «удалил не то», но не от отказа диска.

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${DB_USER:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/apsny}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"
FILE="$BACKUP_DIR/apsny-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

echo "[$(date +%F\ %T)] дамп → $FILE"
# Формат custom (-Fc): сжат, восстанавливается выборочно, переживает смену
# версии PostgreSQL лучше простого SQL.
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner \
  > "$FILE"

SIZE=$(stat -c%s "$FILE")
if [ "$SIZE" -lt 100000 ]; then
  echo "ОШИБКА: дамп подозрительно мал ($SIZE Б) — база пуста или дамп не удался"
  exit 1
fi
echo "  размер: $(numfmt --to=iec "$SIZE")"

# ---------------------------------------------------------------------------
# Проверка восстановления. Разворачиваем дамп во временную базу и сверяем,
# что данные на месте. Временная база удаляется в любом случае.
# ---------------------------------------------------------------------------
CHECK_DB="apsny_restore_check_$$"
cleanup() { docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -qc \
            "drop database if exists $CHECK_DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "  проверка восстановления во временную базу $CHECK_DB"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -qc "create database $CHECK_DB;"
docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$CHECK_DB" --no-owner --clean --if-exists \
  < "$FILE" >/dev/null 2>&1 || true   # предупреждения о ролях ожидаемы

COUNTS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$CHECK_DB" -tAc "
  select 'пользователей='||(select count(*) from public.users)
      || ' поездок='||(select count(*) from public.rides)
      || ' ставок='||(select count(*) from public.bids)
      || ' отзывов='||(select count(*) from public.reviews);" 2>/dev/null || echo "")

if [ -z "$COUNTS" ]; then
  echo "ОШИБКА: восстановленная база не отвечает — дамп непригоден"
  exit 1
fi
echo "  восстановлено: $COUNTS"

USERS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$CHECK_DB" -tAc \
        "select count(*) from public.users;" 2>/dev/null || echo 0)
if [ "$USERS" -lt 1 ]; then
  echo "ОШИБКА: в восстановленной базе нет пользователей — дамп непригоден"
  exit 1
fi

echo "  проверка пройдена"

# ---------------------------------------------------------------------------
# Ротация
# ---------------------------------------------------------------------------
find "$BACKUP_DIR" -name 'apsny-*.dump' -mtime +"$KEEP_DAYS" -print -delete
echo "[$(date +%F\ %T)] готово, копий в каталоге: $(ls -1 "$BACKUP_DIR"/apsny-*.dump 2>/dev/null | wc -l)"
