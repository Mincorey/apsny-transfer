// supabase/functions/delete-account/index.ts
// Edge Function (Deno): удаление аккаунта по кнопке в профиле.
// Аудит 29.09.2026, пункт В-10 (152-ФЗ: право на удаление данных).
//
// Порядок:
//   1. Проверяем, кто звонит: токен пользователя из заголовка Authorization.
//      Удалить можно только СЕБЯ — id берётся из токена, а не из запроса.
//   2. anonymize_user (SQL, только service_role): отказ, если удаление сломает
//      сделку другому человеку; иначе снимает активные поездки, удаляет
//      черновики, обезличивает профиль и машины.
//   3. Удаляем файлы пользователя из хранилища (аватар, фото машин).
//   4. «Мягко» удаляем учётную запись: GoTrue стирает email и телефон,
//      войти больше нельзя, а строка остаётся — на ней держится обезличенный
//      профиль с чужими отзывами и поездками. Жёсткое удаление каскадом снесло
//      бы и поездки второй стороны.
//
// SUPABASE_URL, SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY доступны в Edge
// Functions автоматически. На своём сервере — те же переменные в окружении
// контейнера functions (см. MOVING_CHECKLIST.md).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Метод не поддерживается" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return reply(401, { error: "Требуется авторизация" });
  }

  // 1. Кто звонит.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return reply(401, { error: "Сессия истекла, войдите заново" });
  }
  const uid = userData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // 2. Обезличить данные в базе. Отказы — понятным текстом для человека.
  const { error: rpcError } = await admin.rpc("anonymize_user", { p_user_id: uid });
  if (rpcError) {
    return reply(409, { error: rpcError.message });
  }

  // 3. Файлы: <uid>/avatar.* и <uid>/vehicles/*. Ошибки здесь не повод
  //    останавливать удаление — данные в базе уже обезличены.
  try {
    const bucket = admin.storage.from("avatars");
    const paths: string[] = [];
    for (const folder of [uid, `${uid}/vehicles`]) {
      const { data } = await bucket.list(folder, { limit: 1000 });
      for (const f of data ?? []) {
        if (f.id) paths.push(`${folder}/${f.name}`); // у папок id = null
      }
    }
    if (paths.length > 0) await bucket.remove(paths);
  } catch (e) {
    console.error("delete-account: storage cleanup failed", uid, e);
  }

  // 4. Учётная запись: мягкое удаление.
  const { error: delError } = await admin.auth.admin.deleteUser(uid, true);
  if (delError) {
    console.error("delete-account: auth delete failed", uid, delError);
    return reply(500, {
      error: "Профиль обезличен, но учётную запись удалить не удалось. Напишите нам — доделаем вручную",
    });
  }

  return reply(200, { ok: true });
});
