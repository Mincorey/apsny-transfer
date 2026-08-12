import { useLayoutEffect, type RefObject } from 'react';

/**
 * Держит открытую выпадающую панель в видимой области.
 *
 * Зачем: панели выбора даты и времени высокие (~320–370 px) и раскрываются вниз.
 * На ноутбуке с невысоким окном нижняя часть панели уезжала за край экрана:
 * человек выбирал час, не видел блок «Минуты», в поле оставалось «--:--» и
 * складывалось впечатление, что форма сломана.
 *
 * Почему не разворачиваем вверх: страница живёт в собственном контейнере с
 * прокруткой, а сверху висит закреплённая шапка. Панель, раскрытая вверх,
 * упирается в них и обрезается — проверено, получается хуже исходного. Поэтому
 * панель всегда снизу, а если она не помещается, подкручиваем к ней прокрутку.
 * От совсем низких окон дополнительно страхует max-height у самой панели.
 *
 * @param open  открыта ли панель
 * @param panel ссылка на панель
 */
export function useDropdownInView(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    if (!open) return;
    const panelEl = panel.current;
    if (!panelEl) return;

    const GAP = 12; // запас до края экрана
    const rect = panelEl.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - GAP) {
      panelEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [open, panel]);
}
