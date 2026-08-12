import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (val: string) => void;
  placeholder?: string;
}

const MONTHS_RU = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];
const DAYS_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseDisplay(ymd: string): string {
  const [y,m,d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

export function DatePicker({ value, onChange, placeholder = 'Выберите дату' }: DatePickerProps) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const initDate = value ? new Date(value + 'T00:00:00') : today;
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Mon=0

  const cells: Array<{ date: Date; curr: boolean }> = [];
  for (let i = startDow - 1; i >= 0; i--)
    cells.push({ date: new Date(viewYear, viewMonth, -i), curr: false });
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ date: new Date(viewYear, viewMonth, d), curr: true });
  while (cells.length % 7 !== 0)
    cells.push({ date: new Date(viewYear, viewMonth + 1, cells.length - startDow - daysInMonth + 1), curr: false });

  const todayStr = toYMD(today);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  return (
    <div className="relative w-full" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full pl-11 pr-4 py-4 rounded-2xl input-glass font-medium text-left transition-all"
      >
        <span className={value ? 'text-on-surface' : 'text-outline'}>
          {value ? parseDisplay(value) : placeholder}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 z-50 mt-2 w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl p-4 border border-[#00f0ff]/20 shadow-2xl bg-surface-container/95 backdrop-blur-md"
          >
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={prevMonth} aria-label="Предыдущий месяц" className="p-1.5 rounded-xl hover:bg-white/10 transition-colors">
                <ChevronLeft size={16} aria-hidden="true" className="text-on-surface-variant" />
              </button>
              <span className="text-sm font-bold">{MONTHS_RU[viewMonth]} {viewYear}</span>
              <button type="button" onClick={nextMonth} aria-label="Следующий месяц" className="p-1.5 rounded-xl hover:bg-white/10 transition-colors">
                <ChevronRight size={16} aria-hidden="true" className="text-on-surface-variant" />
              </button>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {DAYS_SHORT.map((d, i) => (
                <div key={d} className={`text-center text-[10px] font-semibold py-1 ${i >= 5 ? 'text-[#00f0ff]/50' : 'text-outline'}`}>
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((cell, idx) => {
                const ds = toYMD(cell.date);
                const isPast = cell.date < today;
                const isSelected = ds === value;
                const isToday = ds === todayStr;
                const isWknd = cell.date.getDay() === 0 || cell.date.getDay() === 6;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isPast}
                    onClick={() => {
                      onChange(ds);
                      setOpen(false);
                      if (!cell.curr) { setViewYear(cell.date.getFullYear()); setViewMonth(cell.date.getMonth()); }
                    }}
                    className={[
                      'h-9 w-full flex items-center justify-center rounded-xl text-sm font-medium transition-all',
                      !cell.curr && 'opacity-20',
                      isPast && 'cursor-not-allowed',
                      isSelected && 'bg-[#00f0ff] text-black font-bold shadow-[0_0_12px_rgba(0,240,255,0.4)]',
                      !isSelected && isToday && 'border border-[#00f0ff]/60 text-[#00f0ff]',
                      !isSelected && !isPast && cell.curr && 'hover:bg-white/10 cursor-pointer',
                      !isSelected && isWknd && cell.curr && !isPast && 'text-[#00f0ff]/70',
                      !isSelected && !isWknd && !isToday && cell.curr && !isPast && 'text-on-surface',
                    ].filter(Boolean).join(' ')}
                  >
                    {cell.date.getDate()}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
