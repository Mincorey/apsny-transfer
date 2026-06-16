// src/lib/yoomoneyPay.ts
// Редирект пользователя на оплату ЮMoney QuickPay (кошелёк).
// Требует переменную окружения VITE_YOOMONEY_RECEIVER — номер кошелька
// (напр. 4100117652929755).
//
// Цена публикации поездки — 100 ₽. После оплаты ЮMoney пришлёт HTTP-уведомление
// на Edge Function `yoomoney-webhook`, которая опубликует поездку (draft → active).

export const PUBLICATION_PRICE = 100; // ₽ за публикацию поездки

/**
 * Строит форму QuickPay и уводит пользователя на страницу оплаты ЮMoney.
 * @param label   уникальная метка платежа (из RPC start_ride_payment)
 * @param rideId  id поездки — кладём в successURL, чтобы страница /payment
 *                могла отследить, когда поездка опубликуется
 * @param paymentType  'AC' — банковская карта (вкл. МИР), 'PC' — кошелёк ЮMoney
 */
export function redirectToYooMoney(
  label: string,
  rideId: string,
  paymentType: 'AC' | 'PC' = 'AC',
): void {
  const receiver = import.meta.env.VITE_YOOMONEY_RECEIVER as string | undefined;
  if (!receiver) throw new Error('VITE_YOOMONEY_RECEIVER не задан');

  const successURL = `${window.location.origin}/payment?status=pending&label=${encodeURIComponent(
    label,
  )}&ride=${encodeURIComponent(rideId)}`;

  const fields: Record<string, string> = {
    receiver,
    'quickpay-form': 'button',
    sum: PUBLICATION_PRICE.toFixed(2), // "100.00"
    label,
    paymentType,
    successURL,
  };

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = 'https://yoomoney.ru/quickpay/confirm';
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit(); // уводит пользователя на страницу оплаты ЮMoney
}
