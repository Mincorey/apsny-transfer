import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Star, Trophy } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { pluralTrips } from '../../lib/utils';

/**
 * Таблица рейтингов водителей.
 *
 * Рейтинги в сервисе есть только у водителей: оценку ставит пассажир после
 * поездки, обратной оценки нет. Раньше список водителей рисовался в двух
 * местах — на странице «Рейтинги» и во вкладке профиля — двумя разными кусками
 * кода, и они успели разойтись (во вкладке был лишний переключатель на
 * пассажиров). Теперь список один на оба места.
 *
 * Своя строка подсвечивается и подписывается местом в таблице, чтобы водителю
 * не приходилось искать себя глазами.
 */

interface RatedDriver {
  id: string;
  full_name: string;
  avatar_url: string | null;
  rating: number;
  trips_count: number;
}

function RankBadge({ index }: { index: number }) {
  if (index === 0) return <span className="text-xl shrink-0">🥇</span>;
  if (index === 1) return <span className="text-xl shrink-0">🥈</span>;
  if (index === 2) return <span className="text-xl shrink-0">🥉</span>;
  return (
    <span className="w-7 text-center text-sm font-bold text-outline shrink-0">{index + 1}</span>
  );
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0] ?? '')
    .join('')
    .toUpperCase();
}

export function DriverLeaderboard({ currentUserId }: { currentUserId?: string | null }) {
  const navigate = useNavigate();
  const [drivers, setDrivers] = useState<RatedDriver[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, rating, trips_count')
        .eq('role', 'driver')
        .gt('trips_count', 0)
        .order('rating', { ascending: false })
        .limit(50);
      if (cancelled) return;
      setDrivers((data ?? []) as RatedDriver[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-10 h-10 border-4 border-primary-container border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (drivers.length === 0) {
    return (
      <div className="glass-card rounded-3xl p-14 text-center">
        <Trophy size={36} className="mx-auto mb-3 text-outline/40" aria-hidden="true" />
        <p className="text-outline">Пока нет оценённых водителей</p>
        <p className="text-xs text-outline/60 mt-1">
          Рейтинг появляется после первого отзыва от пассажира
        </p>
      </div>
    );
  }

  const myIndex = currentUserId ? drivers.findIndex((d) => d.id === currentUserId) : -1;

  return (
    <div className="space-y-3">
      {myIndex >= 0 && (
        <p className="text-sm text-on-surface-variant px-1">
          Ваше место в рейтинге —{' '}
          <span className="font-bold text-[#00f0ff]">{myIndex + 1}</span> из {drivers.length}
        </p>
      )}

      {drivers.map((user, index) => {
        const isMe = user.id === currentUserId;
        return (
          <motion.div
            key={user.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index, 12) * 0.035 }}
            onClick={() => navigate(`/users/${user.id}`)}
            className={`glass-card rounded-2xl p-4 flex items-center gap-4 cursor-pointer active:scale-[0.99] transition-all ${
              isMe
                ? 'border border-[#00f0ff]/60 bg-[#00f0ff]/[0.07] shadow-[0_0_18px_rgba(0,240,255,0.15)]'
                : 'hover:border-white/20'
            }`}
          >
            <RankBadge index={index} />

            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="w-12 h-12 rounded-full object-cover border border-white/10 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-[#00f0ff]/15 border border-[#00f0ff]/30 flex items-center justify-center text-base font-bold text-[#00f0ff] shrink-0">
                {initialsOf(user.full_name)}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate flex items-center gap-2">
                {user.full_name}
                {isMe && (
                  <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/40">
                    Вы
                  </span>
                )}
              </div>
              <div className="text-sm text-outline">{pluralTrips(user.trips_count)}</div>
            </div>

            <div className="shrink-0 flex items-center gap-1.5">
              <Star size={15} className="text-yellow-400 fill-yellow-400" aria-hidden="true" />
              <span className="font-bold text-lg font-mono">{user.rating.toFixed(1)}</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
