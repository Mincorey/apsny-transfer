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
    <div className="min-h-screen bg-background text-on-surface">
      {/* Header */}
      <header className="fixed top-0 md:top-16 w-full z-50 md:z-40 h-16 flex items-center justify-between px-4 md:px-8 bg-surface/80 backdrop-blur-2xl border-b border-white/5">
        <button
          onClick={() => (window.history.length > 2 ? navigate(-1) : navigate('/'))}
          className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Назад
        </button>
        <div className="flex items-center gap-2 font-display font-bold">
          <Trophy size={18} className="text-yellow-400" aria-hidden="true" />
          Рейтинги водителей
        </div>
        <div className="w-16" />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-24 md:pt-32 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <DriverLeaderboard currentUserId={userId} />
        </motion.div>
      </main>
    </div>
  );
}
