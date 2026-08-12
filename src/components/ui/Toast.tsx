import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle, XCircle, Info, Zap, Trophy, X } from 'lucide-react';
import type { ToastType } from '../../context/ToastContext';

export interface ToastItemProps {
  id: string;
  type: ToastType;
  title: string;
  body?: string;
  onDismiss: () => void;
}

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={17} className="text-green-400 shrink-0" />,
  error:   <XCircle   size={17} className="text-red-400 shrink-0" />,
  info:    <Info      size={17} className="text-[#00f0ff] shrink-0" />,
  bid:     <Zap       size={17} className="text-[#b47aff] shrink-0" />,
  won:     <Trophy    size={17} className="text-yellow-400 shrink-0" />,
};

const borders: Record<ToastType, string> = {
  success: 'border-green-500/30',
  error:   'border-red-500/30',
  info:    'border-[#00f0ff]/30',
  bid:     'border-[#7701d0]/30',
  won:     'border-yellow-500/30',
};

export function ToastItem({ type, title, body, onDismiss }: ToastItemProps) {
  return (
    <motion.div
      // Всплывающее уведомление появляется само, без действия человека, и
      // само же исчезает. Зрячий заметит его краем глаза; скринридеру нужно
      // сказать об этом явно, иначе сообщение пройдёт мимо незамеченным.
      // role="status" проговаривает текст, не перебивая то, что читается
      // сейчас; aria-live="polite" — то же самое, продублировано для старых
      // экранных дикторов, которые понимают только его.
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, x: 60, scale: 0.93 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.93 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={`pointer-events-auto w-72 glass-card rounded-2xl px-4 py-3 flex items-start gap-3 border ${borders[type]} shadow-xl`}
    >
      {/* Значок дублирует смысл заголовка, читать его вслух незачем. */}
      <div className="mt-0.5" aria-hidden="true">{icons[type]}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-on-surface leading-tight">{title}</div>
        {body && (
          <div className="text-xs text-on-surface-variant mt-0.5 leading-snug">{body}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Скрыть уведомление"
        className="shrink-0 text-outline hover:text-on-surface transition-colors mt-0.5"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </motion.div>
  );
}
