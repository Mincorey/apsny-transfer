// Service worker APSNY-TRANSFER.
//
// Назначение — не «оффлайн-режим» в полном смысле (сервис живёт на данных
// из Supabase в реальном времени: цены, ставки, статусы аукционов, и их
// кэшировать нельзя, иначе пользователь увидит устаревшую цену), а
// installability: без SW с обработчиком fetch Chrome на Android не
// показывает событие beforeinstallprompt, и кнопка «Установить» не
// появляется никогда (см. AUDIT_2026-08-10.md, пункт 3.5).
//
// Поэтому стратегия сознательно ограничена:
//   • кэшируется только оболочка приложения (index.html) — чтобы при
//     открытии без сети показать хотя бы интерфейс, а не ошибку браузера;
//   • все остальные запросы (JS/CSS, картинки, а главное — вызовы
//     Supabase) SW не перехватывает вообще и не кэширует — они идут
//     напрямую в сеть, как без SW. Это осознанный выбор: наличие
//     обработчика fetch обязательно для критерия установки, но кэшировать
//     в нём можно ровно то, что безопасно кэшировать.

// Версия кэша оболочки. Поднимается всякий раз, когда меняется то, что
// лежит в кэше или ссылается из него: при новом номере старый кэш
// удаляется в activate, и офлайн-копия index.html пересобирается.
// v2 — новые значки (адреса получили ?v=2).
const CACHE_VERSION = 'apsny-shell-v2';
const SHELL_URL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.add(SHELL_URL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Кэшируем и отдаём офлайн-фолбэк только для переходов между страницами
  // (загрузка HTML). Всё остальное — GET на статику, POST/PATCH к
  // Supabase и т. п. — SW не трогает: событие просто не перехватывается
  // (без event.respondWith запрос идёт в сеть как обычно).
  if (request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(SHELL_URL).then((cached) => cached || Response.error())
    )
  );
});
