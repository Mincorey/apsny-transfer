// supabase/functions/yoomoney-webhook/index.ts
// Edge Function (Deno): принимает HTTP-уведомление ЮMoney, проверяет подпись `sign`
// (HMAC-SHA256) и публикует поездку через RPC publish_ride_paid.
//
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY доступны в Edge Functions автоматически.
//
// ВОССТАНОВЛЕНО 10.08.2026 из развёрнутой в Supabase версии 4 (аудит AUDIT_2026-08-10.md).
// Исходник был по ошибке удалён из репозитория коммитом 6cca574, при этом функция
// оставалась активной в облаке. Не удалять — это боевой приёмник платежей.
//
// ДОПОЛНЕНО 12.08.2026 — пункт 5.2 аудита: добавлены 4 недостающие проверки
// (секрет, test_notification, currency, unaccepted). Алгоритм подписи не менялся —
// он был сверен с документацией ЮMoney и признан верным.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SECRET = Deno.env.get("YOOMONEY_NOTIFICATION_SECRET");
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Код рубля в уведомлениях ЮMoney (ISO 4217).
const RUB = "643";

// Строгое RFC 3986 кодирование (как в подписи ЮMoney).
function rfc3986(v: string): string {
  return encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

// Строка для подписи: все параметры кроме sign, по алфавиту, значения URL-кодированы.
function buildBase(p: Record<string, string>): string {
  return Object.keys(p)
    .filter((k) => k !== "sign")
    .sort()
    .map((k) => `${k}=${rfc3986(p[k] ?? "")}`)
    .join("&");
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Уведомление администратору в Telegram (через RPC tg_notify). Ошибки глушим,
// чтобы сбой Telegram не влиял на ответ вебхука ЮMoney.
async function notifyAdmin(text: string): Promise<void> {
  try {
    await supabase.rpc("tg_notify", { p_text: text });
  } catch (e) {
    console.error("notifyAdmin failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    // Заодно показываем, настроен ли секрет, — чтобы это было видно без чтения логов.
    return new Response(
      SECRET ? "yoomoney webhook alive" : "yoomoney webhook alive (SECRET NOT SET)",
      { status: 200 },
    );
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // 0) Секрет обязан быть задан. Без этой проверки функция считала бы HMAC от
  //    строки "undefined" и молча отклоняла ВСЕ уведомления как «bad sign» —
  //    деньги бы приходили, поездки не публиковались, а в логах была бы
  //    неверная причина. Пункт 5.2 аудита.
  if (!SECRET) {
    console.error("YOOMONEY_NOTIFICATION_SECRET is not set");
    await notifyAdmin(
      "❌ <b>Вебхук ЮMoney: не задан секрет</b>\n" +
        "Переменная YOOMONEY_NOTIFICATION_SECRET отсутствует в секретах Edge Functions. " +
        "Уведомления об оплате не обрабатываются.",
    );
    // 500 — ЮMoney повторит попытку, когда секрет пропишут.
    return new Response("secret not configured", { status: 500 });
  }

  // 1) Читаем form-urlencoded тело.
  const raw = await req.text();
  const sp = new URLSearchParams(raw);
  const params: Record<string, string> = {};
  sp.forEach((v, k) => (params[k] = v));

  // 2) Проверяем подпись.
  const expected = await hmacHex(SECRET, buildBase(params));
  if ((params["sign"] || "").toLowerCase() !== expected) {
    console.warn("bad sign", params);
    return new Response("bad sign", { status: 403 });
  }

  // --- дальше идут проверки, которые имеют смысл ТОЛЬКО после подписи ---

  // 3) Тестовое уведомление из кабинета ЮMoney (кнопка «Протестировать»).
  //    Оно приходит с корректной подписью и может нести реальную метку —
  //    без этой проверки нажатие кнопки опубликовало бы поездку бесплатно.
  //    Отвечаем 200, иначе кабинет покажет ошибку настройки. Пункт 5.2 аудита.
  if (params["test_notification"] === "true") {
    console.log("test notification, ignored", params["label"] || "");
    return new Response("OK", { status: 200 });
  }

  // 4) Платежи без метки нас не касаются (перевод «просто так» на кошелёк).
  const label = params["label"] || "";
  if (!label) return new Response("OK", { status: 200 });

  // 5) Валюта. Тариф — 100 ₽; уведомление в другой валюте сравнивать с этой
  //    суммой нельзя. Отвечаем 200 (повтор ничего не изменит) и зовём человека.
  const currency = params["currency"] || "";
  if (currency && currency !== RUB) {
    console.warn("unexpected currency", currency);
    await notifyAdmin(
      "⚠️ <b>Вебхук ЮMoney: платёж не в рублях</b>\n" +
        "Метка: " + label + "\n" +
        "Валюта: " + currency + " (ожидалась " + RUB + ")\n" +
        "Поездка НЕ опубликована, нужна ручная проверка.",
    );
    return new Response("OK", { status: 200 });
  }

  // 6) Замороженный перевод. unaccepted=true означает, что деньги зачислены
  //    с условием (например, кошелёк упёрся в лимит остатка) и получателю
  //    ещё не доступны. Публиковать поездку за такой платёж нельзя.
  //    ЮMoney пишет, что параметр всегда false, но проверка стоит копейки.
  if (params["unaccepted"] === "true") {
    console.warn("unaccepted transfer", label);
    await notifyAdmin(
      "⚠️ <b>Вебхук ЮMoney: перевод заморожен</b>\n" +
        "Метка: " + label + "\n" +
        "Операция: " + (params["operation_id"] || "—") + "\n" +
        "Пришёл с unaccepted=true — деньги не зачислены на кошелёк. " +
        "Поездка НЕ опубликована.",
    );
    return new Response("OK", { status: 200 });
  }

  // 7) Публикуем поездку (вся логика и идемпотентность — внутри RPC).
  //
  //    ВАЖНО про суммы. Сверяем по withdraw_amount — это сколько СПИСАНО
  //    с плательщика, и именно на этот вопрос («заплатил ли пользователь
  //    100 ₽») мы отвечаем. На кошелёк при этом придёт params.amount,
  //    то есть меньше на комиссию ЮMoney. Разницу учитывайте в экономике
  //    сервиса: тариф 100 ₽ — это не 100 ₽ поступлений.
  const { data, error } = await supabase.rpc("publish_ride_paid", {
    p_label: label,
    p_operation_id: params["operation_id"] || "",
    p_withdraw: parseFloat(params["withdraw_amount"] || "0"),
    p_raw: params,
  });

  if (error) {
    console.error("publish_ride_paid error", error);
    await notifyAdmin(
      "❌ <b>Вебхук ЮMoney: ошибка БД</b>\n" +
        "Метка: " + label + "\n" +
        "Операция: " + (params["operation_id"] || "—") + "\n" +
        (error.message || ""),
    );
    // 500 — ЮMoney повторит уведомление (всего 3 попытки).
    return new Response("db error", { status: 500 });
  }

  // Платёж пришёл, но метки в БД нет — аномалия, сообщаем админу.
  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  if (result.ok === false && result.reason === "unknown_label") {
    await notifyAdmin(
      "⚠️ <b>Вебхук ЮMoney: неизвестная метка</b>\n" +
        "Метка: " + label + "\n" +
        "Операция: " + (params["operation_id"] || "—") + "\n" +
        "Сумма: " + (params["withdraw_amount"] || "—") + " ₽",
    );
  }

  console.log("publish_ride_paid", data);
  return new Response("OK", { status: 200 });
});
