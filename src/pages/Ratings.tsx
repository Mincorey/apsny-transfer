import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { DriverLeaderboard } from '../components/ui/DriverLeaderboard';

export function Ratings() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setUserId(session?.user?.id ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    /*
      Страница живёт внутри MainLayout, а тот уже даёт фон, цвет текста, шапку,
      прокручиваемую область и контейнер с отступами. Здесь всё это было
      объявлено второй раз: min-h-screen внутри уже прокручиваемой области
      (страница гарантированно выше окна — прокрутка в пустоту даже при
      коротком списке), собственная fixed-шапка со смещениями, посчитанными
      под чужой layout, и ещё один набор отступов поверх родительских.

      Теперь как у соседних страниц того же layout (Feed, Notifications):
      обычный заголовок в потоке. Ширину в 2xl оставляю намеренно — длинные
      строки списка на всю ширину 4xl читать неудобно.
    */
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 2 ? navigate(-1) : navigate('/'))}
          className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Назад
        </button>
        <h1 className="flex items-center gap-2 text-2xl font-display font-bold ml-auto">
          <Trophy size={20} className="text-yellow-400" aria-hidden="true" />
          Рейтинги водителей
        </h1>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <DriverLeaderboard currentUserId={userId} />
      </motion.div>
    </div>
  );
}
