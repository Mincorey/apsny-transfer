import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Modal } from './ui/Modal';

/**
 * Предложение обновиться, когда на сервере вышла новая версия.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. Одностраничное приложение, единожды загрузившись,
 * живёт в памяти вкладки и само по себе новый код не подхватывает. index.html
 * отдаётся без кэша, поэтому любая перезагрузка приносит свежую версию — но
 * человек, свернувший приложение на телефоне и не закрывший его, может неделю
 * работать на старом коде. Пока правки косметические, это терпимо; как только
 * меняется формат данных или логика оплаты — уже нет.
 *
 * КАК УСТРОЕНО. При сборке один и тот же идентификатор попадает в бандл
 * (константа __BUILD_ID__) и в файл /version.json. Приложение запрашивает
 * этот файл в обход кэшей и сравнивает со своим. Не совпало — значит деплой
 * прошёл уже после того, как человек открыл страницу.
 *
 * КОГДА ПРОВЕРЯЕМ. При возврате на вкладку и раз в полчаса. Возврат — главный
 * случай: именно так выглядит «свернул приложение, потом открыл снова», и
 * предложение появится в первую же секунду. Проверка не чаще раза в минуту,
 * чтобы переключения между вкладками не порождали поток запросов.
 *
 * ПОЧЕМУ НЕ ЧЕРЕЗ SERVICE WORKER. Он тоже так умеет, но у нас SW кэширует
 * ровно один файл и нужен главным образом для установки приложения. Отдельный
 * маленький файл версии проще, не зависит от капризов SW в установленном PWA
 * на iOS и легко проверяется руками — достаточно открыть /version.json.
 */

const CHECK_INTERVAL_MS = 30 * 60_000; // раз в полчаса, пока вкладка открыта
const MIN_GAP_MS = 60_000;             // не чаще раза в минуту при переключениях

async function fetchServerBuildId(): Promise<string | null> {
  try {
    // no-store, а не no-cache: нужно гарантированно спросить сервер, а не
    // получить «не изменилось» из кэша браузера или service worker.
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const id = (data as { buildId?: unknown } | null)?.buildId;
    return typeof id === 'string' ? id : null;
  } catch {
    // Нет сети или сервер недоступен — не повод шуметь. Проверим позже.
    return null;
  }
}

export function UpdatePrompt() {
  const [available, setAvailable] = useState(false);
  const [reloading, setReloading] = useState(false);
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    // В dev-режиме идентификатор меняется при каждом запуске — предлагать
    // обновление на каждый чих незачем.
    if (!import.meta.env.PROD) return;
    if (Date.now() - lastCheck.current < MIN_GAP_MS) return;
    lastCheck.current = Date.now();

    const serverId = await fetchServerBuildId();
    if (serverId && serverId !== __BUILD_ID__) setAvailable(true);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(check, CHECK_INTERVAL_MS);
    // Первая проверка не сразу: при холодном старте человек только что
    // получил свежий код, спрашивать сервер об этом же бессмысленно.
    const first = setTimeout(check, MIN_GAP_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(id);
      clearTimeout(first);
    };
  }, [check]);

  const applyUpdate = async () => {
    setReloading(true);
    try {
      // Чистим кэш оболочки: там лежит index.html со ссылками на файлы старой
      // сборки. Без этого офлайн-копия ещё какое-то время указывала бы
      // на бандлы, которых на сервере уже нет.
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
      // Просим service worker переустановиться с новой версией.
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      }
    } catch {
      // Если что-то из этого не удалось — не страшно: перезагрузка всё равно
      // принесёт свежий index.html, он отдаётся без кэша.
    }
    window.location.reload();
  };

  return (
    <Modal open={available} onClose={() => setAvailable(false)} size="sm" label="Доступно обновление">
      <div className="text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-[#00f0ff]/15 border border-[#00f0ff]/30 flex items-center justify-center mx-auto">
          <Sparkles size={26} className="text-[#00f0ff]" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-display font-bold text-on-surface">
            Вышло обновление
          </h2>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            У вас открыта предыдущая версия приложения. Обновление займёт пару секунд —
            страница просто перезагрузится.
          </p>
        </div>

        <div className="flex flex-col gap-2.5 pt-1">
          <button
            onClick={applyUpdate}
            disabled={reloading}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl btn-mesh font-bold text-white disabled:opacity-60"
          >
            {reloading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <RefreshCw size={16} /> Обновить
              </>
            )}
          </button>
          <button
            onClick={() => setAvailable(false)}
            className="w-full px-6 py-3 rounded-xl glass-card border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-sm font-semibold transition-colors"
          >
            Позже
          </button>
        </div>

        <p className="text-on-surface-variant/60 text-[11px] leading-relaxed">
          Если отложить, обновление предложится снова при следующем открытии приложения.
        </p>
      </div>
    </Modal>
  );
}
