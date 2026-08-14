import { useEffect, useState } from 'react';
import { Share2, Plus, Download, Smartphone } from 'lucide-react';
import { Modal } from './ui/Modal';

/**
 * Предложение установить сайт как приложение.
 *
 * ПОЧЕМУ ЭТО НЕ ДЕЛАЕТ БРАУЗЕР САМ. Chrome давно не показывает автоматический
 * баннер установки. Он лишь бросает сайту событие beforeinstallprompt, а
 * показать предложение и вызвать системное окно должен сам сайт.
 *
 * ГЛАВНАЯ ЛОВУШКА — момент подписки. Событие приходит ОДИН раз за загрузку
 * страницы и не повторяется. Раньше слушатель вешался здесь же, в useEffect,
 * то есть после загрузки бандлов, и Chrome успевал выстрелить раньше —
 * предложение не появлялось вовсе. Теперь событие ловится отдельным скриптом
 * в <head> (public/pwa-install.js) и ждёт нас в window.__apsnyInstall.
 * Слушатель apsny:install-ready оставлен на случай, когда событие приходит
 * позже, чем смонтировался интерфейс.
 *
 * ПОЧЕМУ С ПАУЗОЙ. Окно поверх экрана в первую же секунду — самый верный
 * способ получить «Закрыть» не глядя. Человек сначала видит, что за сервис,
 * и только потом получает предложение.
 *
 * iOS. Safari события установки не поддерживает вообще, поэтому там показываем
 * инструкцию: «Поделиться» → «На экран „Домой“».
 */

const DISMISS_KEY = 'pwa_install_dismissed_at';
const DISMISS_DAYS = 14;
const SHOW_AFTER_MS = 25_000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type InstallState = { event: BeforeInstallPromptEvent | null; installed: boolean };

declare global {
  interface Window {
    __apsnyInstall?: InstallState;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function dismissedRecently(): boolean {
  try {
    const ts = localStorage.getItem(DISMISS_KEY);
    if (!ts) return false;
    return (Date.now() - Number(ts)) / 86_400_000 < DISMISS_DAYS;
  } catch {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // localStorage бывает недоступен: приватный режим Safari, запрет хранилища,
    // переполненная квота. Тогда предложение просто появится в следующий раз —
    // это не повод падать.
  }
}

type Mode = 'android' | 'ios' | null;

export function PWAInstallPrompt() {
  const [mode, setMode] = useState<Mode>(null);

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return;

    const ua = navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isIOSSafari = isIOS && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);

    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (next: Mode) => {
      if (timer) return;
      timer = setTimeout(() => setMode(next), SHOW_AFTER_MS);
    };

    // Событие могло прийти ещё до того, как приложение загрузилось: его ловит
    // и придерживает скрипт из <head>.
    if (window.__apsnyInstall?.event) schedule('android');
    else if (isIOSSafari) schedule('ios');

    const onReady = () => schedule('android');
    const onInstalled = () => {
      setMode(null);
      remember();
    };
    window.addEventListener('apsny:install-ready', onReady);
    window.addEventListener('apsny:installed', onInstalled);

    return () => {
      window.removeEventListener('apsny:install-ready', onReady);
      window.removeEventListener('apsny:installed', onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const close = () => {
    setMode(null);
    remember();
  };

  const installAndroid = async () => {
    const deferred = window.__apsnyInstall?.event;
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      // Человек мог закрыть системное окно установки — браузер отклоняет
      // промис. Реакция та же: убрать предложение.
    }
    if (window.__apsnyInstall) window.__apsnyInstall.event = null;
    close();
  };

  return (
    <Modal open={mode !== null} onClose={close} size="sm" label="Установить приложение">
      <div className="text-center space-y-4">
        <img
          src="/icons/icon-192.png?v=2"
          alt=""
          className="w-20 h-20 rounded-2xl mx-auto shadow-lg"
        />

        <div className="space-y-2">
          <h2 className="text-lg font-display font-bold text-on-surface">
            Установить APSNY-TRANSFER
          </h2>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Добавьте приложение на главный экран — открывается сразу, без браузера
            и адресной строки, и не теряется среди вкладок.
          </p>
        </div>

        {mode === 'ios' ? (
          <>
            <div className="glass-card rounded-2xl p-4 text-left space-y-2.5 text-sm text-on-surface-variant">
              <div className="flex items-start gap-2.5">
                <Share2 size={16} className="text-[#00f0ff] shrink-0 mt-0.5" />
                <span>
                  Нажмите <span className="text-on-surface font-medium">«Поделиться»</span> на
                  нижней панели Safari
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <Plus size={16} className="text-[#00f0ff] shrink-0 mt-0.5" />
                <span>
                  Пролистайте список и выберите{' '}
                  <span className="text-on-surface font-medium">«На экран „Домой“»</span>
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <Smartphone size={16} className="text-[#00f0ff] shrink-0 mt-0.5" />
                <span>Готово — значок появится рядом с остальными приложениями</span>
              </div>
            </div>
            <button
              onClick={close}
              className="w-full px-6 py-3 rounded-xl glass-card border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-sm font-semibold transition-colors"
            >
              Понятно
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-2.5 pt-1">
            <button
              onClick={installAndroid}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl btn-mesh font-bold text-white"
            >
              <Download size={16} /> Установить
            </button>
            <button
              onClick={close}
              className="w-full px-6 py-3 rounded-xl glass-card border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-sm font-semibold transition-colors"
            >
              Не сейчас
            </button>
          </div>
        )}

        <p className="text-on-surface-variant/60 text-[11px] leading-relaxed">
          Место на телефоне это почти не занимает: приложение работает через браузер,
          просто без его интерфейса.
        </p>
      </div>
    </Modal>
  );
}
