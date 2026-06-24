import React, { useEffect, useState } from 'react';
import { X, Share2, Plus, Download } from 'lucide-react';

// Предложение установить сайт как приложение (Add to Home Screen).
// Android/Chromium: ловим системное событие beforeinstallprompt и показываем
// кнопку «Установить». iOS Safari: системного события нет — показываем короткую
// инструкцию (Поделиться → «На экран „Домой“»). Если приложение уже установлено
// (standalone) или баннер недавно закрывали — не показываем.

const DISMISS_KEY = 'pwa_install_dismissed_at';
const DISMISS_DAYS = 14;

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
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

type Mode = 'android' | 'ios' | null;

export function PWAInstallPrompt() {
  const [mode, setMode] = useState<Mode>(null);
  const [deferred, setDeferred] = useState<any>(null);

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return;

    const ua = navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isIOSSafari = isIOS && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setMode('android');
    };
    window.addEventListener('beforeinstallprompt', onBIP);

    let t: ReturnType<typeof setTimeout> | undefined;
    if (isIOSSafari) t = setTimeout(() => setMode('ios'), 1800);

    const onInstalled = () => {
      setMode(null);
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  const close = () => {
    setMode(null);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  };

  const installAndroid = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    setDeferred(null);
    close();
  };

  if (!mode) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] p-3 sm:p-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md glass-panel rounded-2xl border border-white/10 p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <img src="/icons/icon-192.png" alt="" className="w-11 h-11 rounded-xl shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-display font-bold text-on-surface text-sm">
              Установить APSNY-TRANSFER
            </div>
            {mode === 'android' ? (
              <>
                <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                  Добавьте приложение на главный экран — открывается как обычное приложение,
                  без браузера и адресной строки.
                </p>
                <button
                  onClick={installAndroid}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl btn-mesh text-white text-sm font-bold"
                >
                  <Download size={15} /> Установить
                </button>
              </>
            ) : (
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                Чтобы установить: нажмите{' '}
                <Share2 size={13} className="inline align-text-bottom text-[#00f0ff]" /> «Поделиться»
                на нижней панели Safari, пролистайте и выберите{' '}
                <span className="text-on-surface font-medium">«На экран „Домой“»</span>{' '}
                <Plus size={13} className="inline align-text-bottom text-[#00f0ff]" />.
              </p>
            )}
          </div>
          <button
            onClick={close}
            aria-label="Закрыть"
            className="shrink-0 text-on-surface-variant hover:text-on-surface p-1 -mt-1 -mr-1"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
