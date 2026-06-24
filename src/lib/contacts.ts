// Утилиты для контактов.
// WhatsApp в БД хранится как «голые» цифры (например, 79001234567), а в
// интерфейсе показывается в виде ссылки wa.me/7XXXXXXXXXX.

/**
 * Нормализует ввод WhatsApp к цифрам с ведущей «7» (российский формат, до 11 цифр).
 * Принимает любую строку (в т.ч. с «wa.me/», «+», пробелами).
 */
export function normalizeWaDigits(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d[0] === '8') d = '7' + d.slice(1);
  else if (d[0] !== '7') d = '7' + d;
  return d.slice(0, 11);
}

/** Отображаемое значение поля WhatsApp: wa.me/7XXXXXXXXXX (или пусто). */
export function waDisplay(digits: string): string {
  return digits ? 'wa.me/' + digits : '';
}
