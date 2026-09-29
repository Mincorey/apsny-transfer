// ============================================================================
// Копирование файлов Storage (аватары, фото машин): облако → свой сервер.
//
// Дамп базы переносит только ЗАПИСИ о бакетах, сами файлы лежат отдельно.
// Скрипт обходит все бакеты облака, скачивает каждый файл и загружает его
// на новый сервер по тому же пути. Пути сохраняются, поэтому ссылки в базе
// (их migrate-db.sh уже переписал на новый домен) начинают работать.
//
// Запуск на новом сервере (Node 18+ не нужен на хосте — через docker):
//
//   docker run --rm -v "$PWD":/w -w /w \
//     -e OLD_URL=https://uprcnpgmmnvsoxasuhun.supabase.co \
//     -e OLD_SERVICE_KEY=... \
//     -e NEW_URL=https://api.ВАШ-ДОМЕН \
//     -e NEW_SERVICE_KEY=... \
//     node:22-alpine node copy-storage.mjs
//
// Ключи service_role — из панели облака (Settings → API) и из .env нового
// сервера. Повторный запуск безопасен: файлы перезаписываются (upsert).
// ============================================================================

const { OLD_URL, OLD_SERVICE_KEY, NEW_URL, NEW_SERVICE_KEY } = process.env;
if (!OLD_URL || !OLD_SERVICE_KEY || !NEW_URL || !NEW_SERVICE_KEY) {
  console.error('Задайте OLD_URL, OLD_SERVICE_KEY, NEW_URL, NEW_SERVICE_KEY');
  process.exit(1);
}

const auth = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });
const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

async function api(base, key, path, init = {}) {
  const res = await fetch(`${base}/storage/v1${path}`, {
    ...init,
    headers: { ...auth(key), ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

// Рекурсивный обход «папок» бакета. У папок id = null.
async function listAll(bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += 100) {
    const res = await api(OLD_URL, OLD_SERVICE_KEY, `/object/list/${bucket}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    const items = await res.json();
    for (const it of items) {
      const full = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) files.push(...(await listAll(bucket, full)));
      else files.push({ path: full, type: it.metadata?.mimetype || 'application/octet-stream' });
    }
    if (items.length < 100) return files;
  }
}

const buckets = await (await api(OLD_URL, OLD_SERVICE_KEY, '/bucket')).json();
let copied = 0, failed = 0;
for (const b of buckets) {
  const files = await listAll(b.id);
  console.log(`Бакет ${b.id}: файлов ${files.length}`);
  for (const f of files) {
    try {
      const data = await (await api(OLD_URL, OLD_SERVICE_KEY, `/object/${b.id}/${enc(f.path)}`)).arrayBuffer();
      await api(NEW_URL, NEW_SERVICE_KEY, `/object/${b.id}/${enc(f.path)}`, {
        method: 'POST',
        headers: { 'Content-Type': f.type, 'x-upsert': 'true' },
        body: data,
      });
      copied++;
      console.log(`  ✓ ${f.path} (${data.byteLength} Б)`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${f.path}: ${e.message}`);
    }
  }
}
console.log(`\nСкопировано: ${copied}, ошибок: ${failed}`);
process.exit(failed ? 1 : 0);
