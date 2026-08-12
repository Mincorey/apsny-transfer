import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Регистрируем service worker только в проде: в dev-режиме он мешал бы
// Vite (перехват навигации + собственный кэш конфликтуют с HMR).
// Нужен для установки как приложения (PWA) — без него Chrome на Android
// не показывает предложение «Установить» (см. AUDIT_2026-08-10.md, 3.5).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('SW registration failed:', err);
    });
  });
}
