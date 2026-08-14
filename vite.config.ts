import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

/**
 * Идентификатор сборки.
 *
 * Нужен, чтобы уже открытое у пользователя приложение могло понять, что на
 * сервере лежит другая версия. Одно и то же значение попадает в два места:
 * внутрь бандла (константа __BUILD_ID__) и в файл /version.json рядом с ним.
 * Приложение сравнивает их и при расхождении предлагает обновиться.
 *
 * На Vercel берём хеш коммита — он меняется ровно тогда, когда меняется код.
 * Локально подставляем метку времени сборки.
 */
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? `local-${Date.now().toString(36)}`;

/**
 * Кладёт /version.json в собранный сайт.
 *
 * Файл намеренно крошечный и лежит отдельно от бандла: приложение запрашивает
 * его с cache: 'no-store', то есть в обход всех кэшей, и по нему одному
 * понимает, вышло ли обновление. Тянуть ради этого index.html было бы
 * в десятки раз дороже.
 */
function buildVersionFile(): Plugin {
  return {
    name: 'apsny-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() }),
      });
    },
  };
}

export default defineConfig(() => {
  return {
    define: {
      __BUILD_ID__: JSON.stringify(BUILD_ID),
    },
    plugins: [react(), tailwindcss(), buildVersionFile()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Выносим тяжёлые вендоры в отдельные кэшируемые чанки —
          // быстрее повторные загрузки, меньше вес главного бандла.
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            motion: ['motion'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
