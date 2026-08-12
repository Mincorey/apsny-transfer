// Конфигурация ESLint (плоский формат, ESLint 9).
//
// До 12.08.2026 линтера в проекте не было вообще: скрипт "lint" вызывал
// tsc --noEmit, то есть проверял только типы (пункт 4 аудита AUDIT_2026-08-10.md).
// Проверка типов и линтинг решают разные задачи — tsc не видит забытую
// зависимость в useEffect, недостижимый код или подписку без отписки.
// Теперь это два разных скрипта: npm run typecheck и npm run lint.
//
// Набор правил намеренно близок к рекомендованному, без экзотики: цель —
// ловить ошибки, а не переучивать проект на новый стиль.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/sw.js', 'supabase/functions/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // ------------------------------------------------------------------
      // Два правила из нового набора react-hooks 7 (правила React Compiler)
      // понижены с ошибки до предупреждения. Это осознанное решение, а не
      // способ «сделать, чтобы прошло»:
      //
      // set-state-in-effect (9 мест) — запрещает вызывать setState прямо
      //   в теле эффекта. В проекте это основной способ загрузки данных:
      //   эффект дёргает Supabase и раскладывает ответ по состояниям.
      //   Переписывать это правильно — переход на внешний загрузчик данных
      //   или на Suspense, то есть переделка всех страниц разом. Код рабочий
      //   и протестированный, ломать его ради нового правила нельзя.
      //
      // purity (2 места) — Date.now() во время рендера в отсчёте времени до
      //   конца аукциона (Feed.tsx, TripDetail.tsx). Замечание по существу
      //   верное: результат рендера зависит от момента вызова. Практического
      //   вреда нет — рядом и так стоит таймер, перерисовывающий компонент,
      //   а признак «меньше часа до конца» от лишней перерисовки не портится.
      //
      // Оба остаются видимыми как предупреждения — чтобы новые случаи было
      // заметно, а не чтобы про них забыли. Разбор — отдельная задача.
      // ------------------------------------------------------------------
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',

      // В проекте 17 осознанных `any` (аудит, п. 3.6). Убирать их — отдельная
      // задача; пока предупреждение, чтобы новые не появлялись незаметно.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Неиспользуемые переменные уже ловит tsc (noUnusedLocals), но он не
      // умеет делать исключение для аргументов с префиксом _.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Конфиги сборки исполняются в Node, а не в браузере.
    files: ['*.config.{js,ts}', 'vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Обычные браузерные скрипты из public/ (например canonical.js): Vite их
    // не собирает, они подключаются тегом <script> как есть — значит это не
    // модули, и им нужны браузерные глобальные объекты (location, document).
    // sw.js сюда не попадает: он в ignores, потому что живёт в окружении
    // service worker со своим набором глобальных объектов.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: globals.browser,
    },
  },
);
