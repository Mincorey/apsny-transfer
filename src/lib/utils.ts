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
