import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useDropdownInView } from './useDropdownInView';

interface TimePickerProps {
  value: string; // HH:MM
  onChange: (val: string) => void;
  placeholder?: string;
  /** Идентификатор кнопки-поля — чтобы внешняя подпись «Время» могла
   *  сослаться на неё через <label htmlFor>. Подробности — в DatePicker. */
  id?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export function TimePicker({ value, onChange, placeholder = 'Выберите время', id }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDropdownInView(open, panelRef);
  const [tempHour, setTempHour] = useState(() => value ? parseInt(value.split(':')[0] ?? '0') : -1);
  const [tempMin, setTempMin] = useState(() => {
    if (!value) return -1;
    return Math.round(parseInt(value.split(':')[1] ?? '0') / 5) * 5 % 60;
  });

  useEffect(() => {
    if (open && value) {
      setTempHour(parseInt(value.split(':')[0] ?? '0'));
      setTempMin(Math.round(parseInt(value.split(':')[1] ?? '0') / 5) * 5 % 60);
    }
  }, [open]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (tempHour >= 0 && tempMin < 0) {
          onChange(`${String(tempHour).padStart(2, '0')}:00`);
          setTempMin(0);
        }
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, tempHour, tempMin, onChange]);

  function pickHour(h: number) {
    setTempHour(h);
    if (tempMin >= 0) {
      onChange(`${String(h).padStart(2,'0')}:${String(tempMin).padStart(2,'0')}`);
      setOpen(false);
    }
  }

  function pickMin(m: number) {
    setTempMin(m);
    const h = tempHour >= 0 ? tempHour : 12;
    onChange(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    setOpen(false);
  }

  return (
    <div className="relative w-full" ref={ref}>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full pl-11 pr-4 py-4 rounded-2xl input-glass font-medium text-left transition-all"
      >
        <span className={value ? 'text-on-surface' : 'text-outline'}>
          {value || placeholder}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            // Фон сплошной: при полупрозрачном сквозь панель читался блок
            // «Удобства в поездке» и цифры часов мешались с надписями.
            className={[
              'absolute right-0 top-full mt-2 z-50 w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl p-4',
              'border border-[#7701d0]/30 shadow-2xl bg-surface-container-high backdrop-blur-md',
              // Страховка от совсем низких окон: панель не выше экрана,
              // остаток прокручивается внутри неё.
              'max-h-[calc(100vh-9rem)] overflow-y-auto',
            ].join(' ')}
          >
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-semibold text-outline uppercase tracking-wider mb-2">Часы</div>
                <div className="grid grid-cols-6 gap-1">
                  {HOURS.map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => pickHour(h)}
                      className={[
                        'py-1.5 rounded-xl text-sm font-bold transition-all',
                        tempHour === h
                          ? 'bg-[#00f0ff] text-black shadow-[0_0_10px_rgba(0,240,255,0.3)]'
                          : 'text-on-surface-variant hover:bg-white/10 hover:text-on-surface',
                      ].join(' ')}
                    >
                      {String(h).padStart(2,'0')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-outline-variant/20 pt-3">
                <div className="text-[10px] font-semibold text-outline uppercase tracking-wider mb-2">Минуты</div>
                <div className="grid grid-cols-6 gap-1">
                  {MINUTES.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => pickMin(m)}
                      className={[
                        'py-1.5 rounded-xl text-sm font-bold transition-all',
                        tempMin === m
                          ? 'bg-[#7701d0] text-white shadow-[0_0_10px_rgba(119,1,208,0.3)]'
                          : 'text-on-surface-variant hover:bg-white/10 hover:text-on-surface',
                      ].join(' ')}
                    >
                      {String(m).padStart(2,'0')}
                    </button>
                  ))}
                </div>
              </div>
              {tempHour >= 0 && tempMin < 0 && (
                <p className="text-xs text-outline text-center pt-1">Теперь выберите минуты</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
