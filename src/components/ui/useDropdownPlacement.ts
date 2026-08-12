import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Куда раскрыть выпадающую панель — вниз или вверх.
 *
 * Зачем: панели выбора даты и времени высокие (~300 px) и всегда раскрывались
 * вниз. На ноутбуке с невысоким окном нижняя половина панели уезжала за край
 * экрана: человек выбирал час, не видел блок «Минуты», в поле оставалось «--:--»
 * и складывалось впечатление, что форма сломана.
 *
 * Что делаем: если снизу места не хватает, а сверху хватает — раскрываем вверх.
 * Если не хватает нигде (совсем низкое окно), оставляем снизу и подкручиваем
 * страницу к панели, чтобы она попала в видимую область целиком.
 *
 * @param open   открыта ли панель
 * @param anchor ссылка на обёртку поля (position: relative)
 * @param panel  ссылка на саму панель
 */
export function useDropdownPlacement(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
): 'bottom' | 'top' {
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');

  useLayoutEffect(() => {
    if (!open) {
      setPlacement('bottom');
      return;
    }
    const anchorEl = anchor.current;
    const panelEl = panel.current;
    if (!anchorEl || !panelEl) return;

    const GAP = 16; // запас до края экрана
    const rect = anchorEl.getBoundingClientRect();
    const panelHeight = panelEl.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow < panelHeight + GAP && spaceAbove > panelHeight + GAP) {
      setPlacement('top');
      return;
    }

    setPlacement('bottom');
    if (spaceBelow < panelHeight + GAP) {
      // Места нет ни снизу, ни сверху — подтягиваем панель в видимую область.
      panelEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [open, anchor, panel]);

  return placement;
}
