import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Star, ArrowLeft, Trophy } from 'lucide-react';
import { motion } from 'motion/react';

interface RatedUser {
  id: string;
  full_name: string;
  avatar_url: string | null;
  rating: number;
  trips_count: number;
}

function pluralTrips(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'поездка';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'поездки';
  return 'поездок';
}

function RankBadge({ index }: { index: number }) {
  if (index === 0) return <span className="text-xl shrink-0">🥇</span>;
  if (index === 1) return <span className="text-xl shrink-0">🥈</span>;
  if (index === 2) return <span className="text-xl shrink-0">🥉</span>;
  return (
    <span className="w-7 text-center text-sm font-bold text-outline shrink-0">{index + 1}</span>
  );
}

export function Ratings() {
  const navigate = useNavigate();
  const [drivers, setDrivers] = useState<RatedUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, rating, trips_count')
        .eq('role', 'driver')
        .gt('trips_count', 0)
        .order('rating', { ascending: false })
        .limit(50);
      setDrivers((data ?? []) as RatedUser[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* Header */}
      <header className="fixed top-0 md:top-16 w-full z-50 md:z-40 h-16 flex items-center justify-between px-4 md:px-8 bg-surface/80 backdrop-blur-2xl border-b border-white/5">
        <button
          onClick={() => (window.history.length > 2 ? navigate(-1) : navigate('/'))}
          className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={18} />
          Назад
        </button>
        <div className="flex items-center gap-2 font-display font-bold">
          <Trophy size={18} className="text-yellow-400" />
          Рейтинги
        </div>
        <div className="w-16" />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-24 md:pt-32 pb-16">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-4 border-primary-container border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
              {drivers.length === 0 ? (
                <div className="glass-card rounded-3xl p-14 text-center">
                  <Trophy size={36} className="mx-auto mb-3 text-outline/40" />
                  <p className="text-outline">Пока нет оценённых пользователей</p>
                  <p className="text-xs text-outline/60 mt-1">
                    Завершите поездку, чтобы оставить отзыв
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {drivers.map((user, index) => (
                    <motion.div
                      key={user.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.035 }}
                      onClick={() => navigate(`/users/${user.id}`)}
                      className="glass-card rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:border-white/20 active:scale-[0.99] transition-all"
                    >
                      <RankBadge index={index} />

                      {/* Avatar */}
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt={user.full_name}
                          className="w-12 h-12 rounded-full object-cover border border-white/10 shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-[#00f0ff]/15 border border-[#00f0ff]/30 flex items-center justify-center text-base font-bold text-[#00f0ff] shrink-0">
                          {user.full_name
                            .split(' ')
                            .slice(0, 2)
                            .map((n) => n[0] ?? '')
                            .join('')
                            .toUpperCase()}
                        </div>
                      )}

                      {/* Name + trips */}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{user.full_name}</div>
                        <div className="text-sm text-outline">
                          {user.trips_count} {pluralTrips(user.trips_count)}
                        </div>
                      </div>

                      {/* Rating */}
                      <div className="shrink-0 flex items-center gap-1.5">
                        <Star size={15} className="text-yellow-400 fill-yellow-400" />
                        <span className="font-bold text-lg font-mono">
                          {user.rating.toFixed(1)}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
          </motion.div>
        )}
      </main>
    </div>
  );
}
