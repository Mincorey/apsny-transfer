import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Разбирает дату в формате YYYY-MM-DD (из <input type="date"> или из
// колонки БД) в объект Date. Строка на всех участках, где это используется,
// уже гарантированно в этом формате (либо от date-picker'а, либо из БД),
// поэтому при некорректном вводе возвращается Invalid Date, а не бросается
// исключение — вызывающий код сравнивает/форматирует Date как обычно, и
// toLocaleDateString/сравнения на Invalid Date просто дадут "Invalid Date"
// или false, не уронив страницу.
export function parseISODate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return new Date(NaN);
  return new Date(y, m - 1, d);
}

/**
 * Русское склонение по числу: 1 место, 2 места, 5 мест.
 * Учитывает 11–14 («11 мест», а не «11 место») — раньше склонение писали
 * по месту и в вместимости автомобиля получалось «3 мест».
 *
 * @param n     число
 * @param one   форма для 1  (место)
 * @param few   форма для 2–4 (места)
 * @param many  форма для 0, 5–20 (мест)
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  if (abs >= 11 && abs <= 14) return many;
  const last = abs % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** «4 места», «11 мест» — число вместе со склонённым словом. */
export function pluralSeats(n: number): string {
  return `${n} ${plural(n, 'место', 'места', 'мест')}`;
}

/** «1 поездка», «3 поездки», «11 поездок». */
export function pluralTrips(n: number): string {
  return `${n} ${plural(n, 'поездка', 'поездки', 'поездок')}`;
}

/**
 * Дата поездки в едином виде: «15 августа 2026 г.».
 *
 * До 12.08.2026 дата выводилась по-разному в каждом разделе: в профиле сырое
 * «2026-08-15» прямо из базы, в «Моих поездках» «15 авг.», на карточке
 * «15 августа 2026 г.». Человек видел одну и ту же поездку в трёх написаниях
 * и в списках не понимал, какой это год. Формат один на весь интерфейс.
 *
 * @param dateStr дата в формате YYYY-MM-DD
 */
export function formatRideDate(dateStr: string): string {
  return parseISODate(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Время отправления «08:30» из «08:30:00». */
export function formatRideTime(timeStr: string): string {
  return (timeStr || '').slice(0, 5);
}

/** Дата и время вместе: «15 августа 2026 г., 08:30». */
export function formatRideDateTime(dateStr: string, timeStr: string): string {
  return `${formatRideDate(dateStr)}, ${formatRideTime(timeStr)}`;
}

/**
 * Цена с разделителем разрядов: «4 000 ₽».
 *
 * В карточке поездки цена печаталась через toLocaleString и получалась
 * «4 000 ₽», а в списках подставлялась голым числом — «4000 ₽». Одна и та же
 * сумма выглядела по-разному на соседних экранах.
 */
export function formatPrice(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

/**
 * Дата из метки времени базы: «12 августа 2026 г.».
 *
 * Отличается от formatRideDate тем, что на входе полный timestamptz
 * («2026-08-12T17:47:37.354+00»), а не «YYYY-MM-DD». Раньше такие значения
 * (дата отзыва) прогонялись через разборщик для коротких дат — он резал строку
 * по дефисам, получал «12T17:47:37.354+00» вместо числа и выдавал «Invalid
 * Date». Именно это и висело на всех отзывах в чужом профиле.
 */
export function formatStampDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * Месяц и год в родительном падеже: «мая 2026 г.».
 *
 * Нужен для оборота «с мая 2026 г.». Стандартное форматирование даёт
 * именительный — получалось «с май 2026 г.».
 */
export function formatMonthYearGenitive(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()} г.`;
}

/**
 * Телефон в читаемом виде: «+7 (940) 771-80-35».
 *
 * Свой номер показывался как есть — «+79407779001», а номер второй стороны
 * форматированным. Один и тот же номер выглядел по-разному на соседних экранах.
 * Нероссийские и неполные номера возвращаются без изменений.
 */
export function formatPhone(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const d = s.replace(/\D/g, '');
  if (d.length !== 11 || (d[0] !== '7' && d[0] !== '8')) return s;
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}
