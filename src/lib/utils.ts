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
