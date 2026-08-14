// Ранний перехват события установки приложения.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ И ПОЧЕМУ В <head>.
//
// Chrome бросает событие beforeinstallprompt ОДИН раз за загрузку страницы и
// больше к нему не возвращается. Раньше слушатель вешался внутри React —
// в useEffect компонента, — то есть уже после того, как браузер скачал и
// выполнил бандлы (250 КБ основного плюс 206 КБ supabase). На мобильном
// интернете это секунды, и Chrome вполне успевал выстрелить раньше. Событие
// уходило в никуда, предложение установить не появлялось, а при следующей
// загрузке повторялось то же самое.
//
// Здесь слушатель встаёт до того, как начнёт грузиться приложение. Событие
// перехватывается, откладывается и ждёт, пока интерфейс будет готов его
// показать — сколько бы времени это ни заняло.
//
// Инлайном писать нельзя: CSP запрещает script-src 'unsafe-inline', и это
// сознательное решение (см. vercel.json). Поэтому отдельный файл, как
// canonical.js.
(function () {
  'use strict';

  // Состояние кладётся в window, потому что это единственный способ передать
  // его из обычного скрипта в модульный код приложения.
  var state = { event: null, installed: false };
  window.__apsnyInstall = state;

  window.addEventListener('beforeinstallprompt', function (e) {
    // preventDefault нужен, чтобы Chrome не показал свою мини-подсказку:
    // предложение мы рисуем сами и в своём оформлении.
    e.preventDefault();
    state.event = e;
    // Отдельное событие — на случай, если приложение уже загрузилось и ждёт.
    window.dispatchEvent(new CustomEvent('apsny:install-ready'));
  });

  window.addEventListener('appinstalled', function () {
    state.event = null;
    state.installed = true;
    window.dispatchEvent(new CustomEvent('apsny:installed'));
  });
})();
