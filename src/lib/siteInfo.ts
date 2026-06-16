/**
 * Реквизиты для публичных и юридических страниц (Контакты, Оферта, Политика).
 *
 * Реквизиты оператора и каналы связи в одном месте, чтобы не искать по страницам:
 *  - operatorName: полное ФИО (статус «физлицо без статуса»);
 *  - email / telegram: действующие каналы связи.
 */
export const SITE = {
  name: 'APSNY-TRANSFER',
  tagline: 'Умный агрегатор трансферов между Абхазией и Россией',

  // Оператор сервиса (для оферты и политики обработки ПДн по 152-ФЗ):
  operatorName: 'Антонов Олег Валерьевич',

  // Контакты:
  email: 'mincorey@internet.ru',
  telegram: 'Mincorey', // ник в Telegram, без «@»

  // Дата вступления документов в силу:
  legalDate: '13 июня 2026 г.',
} as const;

export const telegramUrl = `https://t.me/${SITE.telegram}`;
export const mailtoUrl = `mailto:${SITE.email}`;
