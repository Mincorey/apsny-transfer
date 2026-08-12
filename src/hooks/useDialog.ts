import { useEffect, useRef } from 'react';

/**
 * Делает модальное окно доступным с клавиатуры и для скринридеров.
 *
 * Зачем это нужно, простыми словами. Модальное окно на сайте — это только
 * картинка: полупрозрачная подложка и панель поверх страницы. Для браузера
 * страница под окном никуда не делась, она по-прежнему живая. Из-за этого
 * без специальных мер получается три неприятности:
 *
 *  1. Клавиша Tab уходит из окна на страницу под ним. Человек, который не
 *     пользуется мышью, нажимает Tab несколько раз — и оказывается «где-то
 *     там», на кнопках, которых он не видит, потому что их закрывает окно.
 *     Выбраться обратно он не может.
 *  2. После закрытия окна фокус пропадает. Браузер сбрасывает его в начало
 *     документа, и человек начинает обход страницы заново — вместо того
 *     чтобы вернуться к кнопке, которой окно и открыл.
 *  3. Скринридер не сообщает, что окно вообще открылось: для него это просто
 *     ещё один блок разметки где-то на странице.
 *
 * Хук закрывает всё три: держит Tab внутри окна по кругу, возвращает фокус
 * туда, откуда окно открыли, и закрывает окно по Escape. Роль окна
 * (`role="dialog"`, `aria-modal`) проставляется на самой панели в компоненте —
 * см. Modal.tsx и ReviewModal.tsx.
 *
 * Возвращает ref, который нужно повесить на панель окна (не на подложку).
 */

/**
 * Что считается элементом, на который можно поставить фокус.
 * `:not([disabled])` — выключенные кнопки Tab пропускает.
 * `[tabindex="-1"]` исключён намеренно: такие элементы можно сфокусировать
 * из кода, но обходить их клавишей Tab не полагается.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface Options {
  /** Открыто ли окно сейчас. */
  open: boolean;
  /** Что вызвать при Escape. */
  onClose: () => void;
}

export function useDialog<T extends HTMLElement = HTMLDivElement>({ open, onClose }: Options) {
  const ref = useRef<T>(null);

  // Держим последнюю переданную функцию закрытия в отдельной ссылке.
  // Иначе эффект пересоздавался бы на каждый рендер родителя (обработчик
  // обычно пишут стрелкой прямо в разметке, а это каждый раз новая функция) —
  // и вместе с ним заново забирался бы фокус, сбивая набор текста в полях.
  const onCloseRef = useRef(onClose);
  // Обновляем ссылку в эффекте, а не прямо в теле функции: править ref во
  // время отрисовки нельзя — React может отрисовать компонент и выбросить
  // результат, и тогда в ссылке осело бы значение из несостоявшегося рендера.
  // Эффект без списка зависимостей выполняется после каждой отрисовки, то
  // есть ссылка всегда указывает на актуальный обработчик.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    // Запоминаем, что было в фокусе до открытия, чтобы потом туда вернуться.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Переводим фокус внутрь окна: на первый пригодный элемент, а если таких
    // нет — на саму панель (для этого у неё стоит tabIndex={-1}).
    // Небольшая задержка нужна из-за анимации появления: в момент открытия
    // панель ещё может быть невидимой, а невидимый элемент сфокусировать
    // нельзя — браузер молча проигнорирует попытку.
    const focusTimer = window.setTimeout(() => {
      const node = ref.current;
      if (!node) return;
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    }, 50);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;

      const node = ref.current;
      if (!node) return;

      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
        // Отсеиваем то, что не отображается, — например, спрятанное поле
        // выбора файла: сфокусировать его нельзя, а в подсчёте «первый и
        // последний элемент» оно бы всё сбивало.
        //
        // Проверка именно через getClientRects, а не через популярный
        // offsetParent === null: у элементов с position: fixed offsetParent
        // равен null всегда, даже когда они прекрасно видны, — и такой
        // элемент выпал бы из обхода без всякой причины. getClientRects
        // возвращает пустой список ровно тогда, когда элемент не занимает
        // на экране места.
        .filter((el) => el.getClientRects().length > 0 || el === document.activeElement);

      if (items.length === 0) {
        // Внутри нечего фокусировать — просто не выпускаем Tab наружу.
        e.preventDefault();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      // Замыкаем обход в кольцо: с последнего элемента Tab ведёт на первый,
      // а Shift+Tab с первого — на последний. Наружу фокус не уходит.
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      // Возвращаем фокус туда, откуда окно открыли. Проверка на isConnected —
      // на случай, если та кнопка успела исчезнуть со страницы вместе с
      // карточкой, которую окно и редактировало.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  return ref;
}
