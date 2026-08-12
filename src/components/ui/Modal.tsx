import React, { useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /**
   * Подпись окна для скринридера, когда видимого заголовка нет.
   * Если передан `title`, ничего указывать не нужно — окно назовётся им.
   */
  label?: string;
}

export function Modal({ open, onClose, title, children, size = 'md', label }: ModalProps) {
  // Обработка Escape, удержание фокуса внутри окна и возврат фокуса после
  // закрытия — всё в одном хуке, см. подробное объяснение в src/hooks/useDialog.ts.
  const panelRef = useDialog<HTMLDivElement>({ open, onClose });

  // Уникальный идентификатор заголовка. useId нужен потому, что окон на
  // странице может быть открыто не одно, а совпадающие id ломают связь
  // «окно ↔ его заголовок»: скринридер прочитал бы чужой.
  const titleId = useId();

  const maxW = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' }[size];

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            ref={panelRef}
            // role="dialog" + aria-modal сообщают скринридеру, что открылось
            // именно окно и что содержимое страницы под ним сейчас недоступно.
            // Без них он объявил бы это обычным блоком текста посреди страницы.
            role="dialog"
            aria-modal="true"
            // Окно называется своим заголовком, если он есть; иначе — переданной
            // подписью. Безымянное окно скринридер объявляет просто «диалог»,
            // и человек не понимает, что от него хотят.
            aria-labelledby={title ? titleId : undefined}
            aria-label={!title ? label : undefined}
            // Нужен, чтобы фокус можно было поставить на саму панель, когда
            // внутри нет ни одной кнопки или поля.
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className={`relative glass-card rounded-2xl p-6 w-full ${maxW} border border-outline-variant/30 outline-none`}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="flex items-center justify-between mb-5">
                <h2 id={titleId} className="text-lg font-display font-semibold text-on-surface">{title}</h2>
                <button
                  onClick={onClose}
                  aria-label="Закрыть окно"
                  className="text-on-surface-variant hover:text-on-surface transition-colors p-1.5 rounded-lg hover:bg-surface-container-high"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
