/// <reference types="vite/client" />

/**
 * Идентификатор сборки, подставляемый Vite при компиляции (см. vite.config.ts).
 * В dev-режиме это метка времени запуска, в сборке на Vercel — хеш коммита.
 */
declare const __BUILD_ID__: string;
