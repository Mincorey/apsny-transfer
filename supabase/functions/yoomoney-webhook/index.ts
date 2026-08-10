// supabase/functions/yoomoney-webhook/index.ts
// Edge Function (Deno): принимает HTTP-уведомление ЮMoney, проверяет подпись `sign`
// (HMAC-SHA256) и публикует поездку через RPC publish_ride_paid.
//
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY доступны в Edge Functions автоматически.
//
// ВОССТАНОВЛЕНО 10.08.2026 из развёрнутой в Supabase версии 4 (аудит AUDIT_2026-08-10.md).
// Исходник был по ошибке удалён из репозитория коммитом 6cca574, при этом функция
// оставалась активной в облаке. Не удалять — это боевой приёмник платежей.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SECRET = Deno.env.get("YOOMONEY_NOTIFICATION_SECRET")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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
  if (req.method === "GET") return new Response("yoomoney webhook alive", { status: 200 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

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

  // 3) Тестовое уведомление ЮMoney и платежи без метки — просто подтверждаем.
  const label = params["label"] || "";
  if (!label) return new Response("OK", { status: 200 });

  // 4) Публикуем поездку (вся логика и идемпотентность — внутри RPC).
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
