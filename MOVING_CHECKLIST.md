# Перенос проекта на VDS

Создан 10.08.2026. Подробное обоснование — в `AUDIT_2026-08-10.md`, раздел 7.

---

## 1. Что переносим

| Слой | Сейчас | Куда |
|---|---|---|
| Фронтенд (React SPA) | Vercel, `apsny-transfer.vercel.app` | nginx на VDS, статика из `dist/` |
| База и бэкенд | Supabase Cloud, проект `uprcnpgmmnvsoxasuhun`, регион `ap-southeast-2` | self-hosted Supabase (docker compose) на VDS |
| Приём платежей | Edge Function `yoomoney-webhook` | Edge Function на своём Supabase |

**Важно про 152-ФЗ.** Проект обрабатывает ПДн граждан РФ (ФИО, телефон, email). База сейчас в Австралии. VDS нужно брать **в российской юрисдикции** — переезд это как раз исправляет.

---

## 2. Требования к серверу

- 4 vCPU / 8 ГБ RAM / 80 ГБ SSD — минимум. На 2 ГБ стек Supabase не поднимется.
- Ubuntu 22.04 или 24.04 LTS
- Docker + Docker Compose v2
- Публичный IP, открытые 80 и 443
- Домен с делегированием на этот IP

---

## 3. Сервисы, которые нужно поднять

Проект реально использует:

- **PostgreSQL 17** — вся БД
- **GoTrue (Auth)** — регистрация и вход; `auth.uid()` используется в каждой RLS-политике, без него ничего не работает
- **PostgREST** — через него идут ВСЕ запросы `supabase.from()` и `supabase.rpc()`
- **Storage** — аватары пользователей и фото автомобилей
- **Edge Functions (Deno)** — вебхук ЮMoney
- **pg_cron** — 4 регулярные задачи (было 5; дубль отключён 10.08.2026, см. аудит п. 2.5)
- **pg_net** — HTTP-запросы в Telegram из БД
- **Vault** — токен Telegram-бота
- Realtime — публикация настроена, но фронтенд её не использует (лента обновляется опросом). Можно не поднимать на старте.

Ставить официальный `supabase/supabase` → папка `docker`. Собирать компоненты вручную не стоит.

---

## 4. Перенос данных

```bash
# Дамп из облака
pg_dump "postgresql://postgres:PASS@db.uprcnpgmmnvsoxasuhun.supabase.co:5432/postgres" \
  --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  -Fc -f apsny_$(date +%F).dump

# Восстановление на VDS
pg_restore -d postgres --no-owner --no-privileges apsny_2026-08-10.dump
```

Пароли пользователей — bcrypt-хеши в `auth.users`, переносятся дампом как есть, пересоздавать аккаунты не нужно.

### Что дампом НЕ переносится — делать руками

- [ ] Секреты Vault: токен Telegram-бота и chat_id
- [ ] Задачи `pg_cron` — пересоздать 4 штуки:
  - `* * * * *` → `SELECT close_expired_auctions()`
  - `0 * * * *` → `SELECT auto_complete_expired_rides()`
  - `0 3 * * *` → `SELECT run_retention_cleanup()`
  - `7 * * * *` → `SELECT public.cleanup_unpaid_drafts()`
  - **`process_expired_auctions()` НЕ восстанавливать** — дубль `close_expired_auctions`, см. аудит п. 2.5.
    Функция удалена из базы 10.08.2026, в дампе её уже не будет. Если всё же встретится
    в старом дампе — не создавать и в расписание не ставить.
- [ ] Настройки Auth: подтверждение email вкл/выкл, SMTP, Site URL, Redirect URLs
- [ ] Bucket'ы Storage + их политики
- [ ] Сами файлы из Storage (аватары, фото машин)
- [ ] Edge Function `yoomoney-webhook` — задеплоить заново
- [ ] Переменная `YOOMONEY_NOTIFICATION_SECRET` в секретах Edge Functions
- [ ] **JWT-секрет генерируется новый** → старый `anon key` перестаёт работать, обязательно обновить `.env`

---

## 5. Что поменять в коде

| Файл | Что менять |
|---|---|
| `.env` | `VITE_SUPABASE_URL` → `https://api.<домен>`, `VITE_SUPABASE_ANON_KEY` → новый ключ |
| `.env.example` | то же, заглушками; заодно убрать реальный номер кошелька |
| `index.html` | 5 абсолютных URL `https://apsny-transfer.vercel.app` в OG- и Twitter-тегах |
| `public/sitemap.xml` | 9 URL со старым доменом |
| `public/robots.txt` | строка `Sitemap:` |
| `vercel.json` | удалить, заменить конфигом nginx |
| `package.json` | заодно переименовать с `react-example` на `apsny-transfer` |
| Кабинет ЮMoney | новый URL вебхука |
| Supabase Auth | Site URL и Redirect URLs на новый домен |

---

## 6. nginx

`vercel.json` делал одно — SPA-fallback. На nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name apsny-transfer.ru;

    root /var/www/apsny/dist;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location = /index.html {
        add_header Cache-Control "no-cache, must-revalidate";
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    add_header X-Frame-Options            "SAMEORIGIN"        always;
    add_header X-Content-Type-Options     "nosniff"           always;
    add_header Referrer-Policy            "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy         "geolocation=(), microphone=(), camera=()" always;
    add_header Strict-Transport-Security  "max-age=31536000; includeSubDomains" always;
}
```

Сборка: `npm ci && npm run build`, содержимое `dist/` — в `/var/www/apsny/dist`.

---

## 7. Обязательное после переезда

- [ ] **Бэкапы.** В Supabase Cloud они были автоматические, на VDS их нет. Настроить `pg_dump` по cron с выгрузкой на **другой** диск/хранилище. Обязательно проверить восстановление — непроверенный бэкап это не бэкап.
- [ ] **Мониторинг:** место на диске, живость контейнеров, доступность вебхука. Если вебхук ляжет — деньги придут, а поездки не опубликуются, и узнаете вы об этом от пользователей.
- [ ] **SSL:** certbot + автопродление
- [ ] **Фаервол:** наружу только 80/443/SSH. Порт 5432 в интернет **не открывать**.
- [ ] **Часовой пояс:** `publish_ride_paid` формирует квитанцию через `now() at time zone 'Europe/Moscow'`, `auto_complete_expired_rides` приводит `departure_date + departure_time` к `timestamptz` по TZ сессии. Выставить единый TZ на сервере и в Postgres, иначе поездки будут завершаться не вовремя.
- [ ] Прогнать раздел E из `ПРОВЕРИТЬ.md`

---

## 8. Порядок переключения (минимум простоя)

1. Поднять и настроить VDS полностью, залить дамп-репетицию, прогнать `ПРОВЕРИТЬ.md`
2. Объявить окно обслуживания
3. Финальный дамп из облака → восстановление на VDS
4. Переключить DNS на новый IP
5. Обновить URL вебхука в кабинете ЮMoney
6. Прогнать разделы C и E из `ПРОВЕРИТЬ.md`
7. Supabase Cloud держать в режиме read-only ещё 1–2 недели как запасной вариант, не удалять
