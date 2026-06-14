import React, { createContext, useCallback, useContext, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ToastItem } from '../components/ui/Toast';

export type ToastType = 'success' | 'error' | 'info' | 'bid' | 'won';

interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  body?: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, body?: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((type: ToastType, title: string, body?: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-4), { id, type, title, body }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed z-[200] pointer-events-none flex flex-col gap-2 top-[4.5rem] left-0 right-0 items-center md:top-4 md:left-auto md:right-4 md:items-end">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <ToastItem key={t.id} {...t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
