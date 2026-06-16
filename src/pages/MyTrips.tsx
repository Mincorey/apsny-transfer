import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, MapPin, Users, Clock, AlertCircle, Trophy, CreditCard, ReceiptText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { redirectToYooMoney } from '../lib/yoomoneyPay';

interface MyTrip {
  id: string;
  type: 'request' | 'offer';
  origin: string;
  destination: string;
  departure_date: string;
  departure_time: string;
  current_price: number;
  status: string;
  created_at: string;
  bids_count?: number;
  seats?: number;
}

type TripsTab = 'active' | 'completed' | 'won';

interface WonTrip {
  id: string;
  origin: string;
  destination: string;
  departure_date: string;
  departure_time: string;
  current_price: number;
  status: string;
  created_at: string;
  creator: { full_name: string; avatar_url: string | null } | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-amber-400/15 text-amber-400 border-amber-400/30',
  active: 'bg-primary-container/20 text-primary-container border-primary-container/30',
  booked: 'bg-blue-400/15 text-blue-400 border-blue-400/30',
  completed: 'bg-green-400/15 text-green-400 border-green-400/30',
  cancelled: 'bg-red-400/15 text-red-400 border-red-400/30',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Ожидает оплаты',
  active: 'Активна',
  booked: 'Забронировано',
  completed: 'Завершена',
  cancelled: 'Отменена',
};

function formatDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

function formatTime(timeStr: string): string {
  return timeStr.slice(0, 5);
}

// Неоплаченный черновик удаляется автоматически через 24ч после создания.
function deletionCountdown(createdAt: string): string {
  const deadline = new Date(createdAt).getTime() + 24 * 3600 * 1000;
  const ms = deadline - Date.now();
  if (ms <= 0) return 'будет удалён в ближайший час';
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `удалится без оплаты через ~${h} ч`;
  const m = Math.max(1, Math.floor(ms / 60000));
  return `удалится без оплаты через ~${m} мин`;
}

function TripCard({
  trip,
  onClick,
  onPay,
  onReceipt,
  paying,
}: {
  trip: MyTrip;
  onClick: () => void;
  onPay: (rideId: string) => void;
  onReceipt: (rideId: string) => void;
  paying: boolean;
}) {
  const statusColor = STATUS_COLORS[trip.status] || 'bg-surface-container-high text-on-surface';
  const statusLabel = STATUS_LABELS[trip.status] || trip.status;
  const isDraft = trip.status === 'draft';
  const isPaid = trip.status !== 'draft' && trip.status !== 'cancelled';

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="w-full p-4 rounded-2xl bg-surface-container-high/60 hover:bg-surface-container-high transition-all text-left border border-outline-variant/40 hover:border-outline-variant/60 group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Route */}
          <div className="flex items-start gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 mb-1">
                <MapPin size={14} className="text-primary-container flex-shrink-0" />
                <span className="text-xs text-on-surface-variant truncate">{trip.origin}</span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin size={14} className="text-primary-container flex-shrink-0" />
                <span className="text-xs text-on-surface-variant truncate">{trip.destination}</span>
              </div>
            </div>
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-3 flex-wrap text-xs text-on-surface-variant mb-3">
            <div className="flex items-center gap-1">
              <Clock size={13} />
              <span>
                {formatDate(trip.departure_date)} {formatTime(trip.departure_time)}
              </span>
            </div>
            {trip.seats && trip.seats > 0 && (
              <div className="flex items-center gap-1">
                <Users size={13} />
                <span>{trip.seats}</span>
              </div>
            )}
          </div>

          {/* Bids and price */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-on-surface">{trip.current_price} ₽</span>
            {trip.bids_count && trip.bids_count > 0 && (
              <span className="text-xs bg-primary-container/20 text-primary-container px-2 py-1 rounded-md">
                {trip.bids_count} {trip.bids_count === 1 ? 'ставка' : trip.bids_count < 5 ? 'ставки' : 'ставок'}
              </span>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div className={`flex items-center justify-center px-3 py-1.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap flex-shrink-0 ${statusColor}`}>
          {statusLabel}
        </div>
      </div>

      {isDraft && (
        <>
          <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-amber-400/90">
            <Clock size={12} />
            <span>{deletionCountdown(trip.created_at)}</span>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); if (!paying) onPay(trip.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); if (!paying) onPay(trip.id); } }}
            className={`mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl btn-mesh text-white text-sm font-bold ${paying ? 'opacity-60 pointer-events-none' : ''}`}
          >
            {paying ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <CreditCard size={15} />
                Оплатить и опубликовать — 100 ₽
              </>
            )}
          </div>
        </>
      )}

      {isPaid && (
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onReceipt(trip.id); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onReceipt(trip.id); } }}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl glass-card border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-xs font-medium transition-colors"
        >
          <ReceiptText size={14} />
          Квитанция об оплате
        </div>
      )}
    </motion.button>
  );
}

function WonTripCard({ trip, onClick }: { trip: WonTrip; onClick: () => void }) {
  const initials = (trip.creator?.full_name ?? '?')
    .split(' ').slice(0, 2).map((n) => n[0] ?? '').join('').toUpperCase();

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="w-full p-4 rounded-2xl bg-surface-container-high/60 hover:bg-surface-container-high transition-all text-left border border-yellow-400/20 hover:border-yellow-400/40 group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-3">
            <Trophy size={13} className="text-yellow-400 flex-shrink-0" />
            <span className="text-xs text-yellow-400 font-semibold">Вы победили</span>
          </div>
          <div className="flex items-start gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 mb-1">
                <MapPin size={14} className="text-primary-container flex-shrink-0" />
                <span className="text-xs text-on-surface-variant truncate">{trip.origin}</span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin size={14} className="text-primary-container flex-shrink-0" />
                <span className="text-xs text-on-surface-variant truncate">{trip.destination}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs text-on-surface-variant mb-3">
            <div className="flex items-center gap-1">
              <Clock size={13} />
              <span>{formatDate(trip.departure_date)} {formatTime(trip.departure_time)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-on-surface">{trip.current_price} ₽</span>
            {trip.creator && (
              <div className="flex items-center gap-1.5">
                {trip.creator.avatar_url ? (
                  <img src={trip.creator.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-[#00f0ff]/15 border border-[#00f0ff]/30 flex items-center justify-center text-[8px] font-bold text-[#00f0ff]">
                    {initials}
                  </div>
                )}
                <span className="text-xs text-on-surface-variant">{trip.creator.full_name}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-center px-3 py-1.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap flex-shrink-0 bg-yellow-400/10 text-yellow-400 border-yellow-400/30">
          Победа
        </div>
      </div>
    </motion.button>
  );
}

export function MyTrips() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState<MyTrip[]>([]);
  const [wonTrips, setWonTrips] = useState<WonTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TripsTab>('active');
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  // Чтобы авто-выбор вкладки не перебивал ручной выбор пользователя.
  const tabResolved = useRef(false);

  const fetchTrips = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        return;
      }

      const { data: ridesData, error: ridesError } = await supabase
        .from('rides')
        .select('id, type, origin, destination, departure_date, departure_time, current_price, status, created_at, seats')
        .eq('creator_id', user.id)
        .order('created_at', { ascending: false });

      if (ridesError) throw ridesError;

      if (!ridesData || ridesData.length === 0) {
        setTrips([]);
        setLoading(false);
        return;
      }

      // Get bid counts for all trips in a single query
      const rideIds = ridesData.map(r => r.id);
      const { data: bidRows } = await supabase
        .from('bids')
        .select('ride_id')
        .in('ride_id', rideIds);

      const countMap = (bidRows || []).reduce<Record<string, number>>((acc, b) => {
        acc[b.ride_id] = (acc[b.ride_id] || 0) + 1;
        return acc;
      }, {});

      const tripsWithBids = ridesData.map(ride => ({
        ...ride,
        bids_count: countMap[ride.id] || 0,
      }));

      setTrips(tripsWithBids as MyTrip[]);

      // Fetch won trips (where current user is the winner)
      const { data: wonData } = await supabase
        .from('rides')
        .select('id, origin, destination, departure_date, departure_time, current_price, status, created_at, creator:users!creator_id(full_name, avatar_url)')
        .eq('winner_id', user.id)
        .order('created_at', { ascending: false });

      setWonTrips((wonData ?? []) as unknown as WonTrip[]);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error fetching trips:', err);
      setError('Ошибка при загрузке поездок');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const handlePay = useCallback(async (rideId: string) => {
    try {
      setPayingId(rideId);
      const { data: label, error: payErr } = await supabase.rpc('start_ride_payment', {
        p_ride_id: rideId,
      });
      if (payErr) throw payErr;
      redirectToYooMoney(label as string, rideId, 'AC');
    } catch (err) {
      if (import.meta.env.DEV) console.error('start_ride_payment error:', err);
      setPayingId(null);
      setError('Не удалось начать оплату. Попробуйте ещё раз.');
    }
  }, []);

  // Если активных поездок нет, а есть выигранные аукционы — открываем вкладку
  // «Победы» (бейдж на «Поездки» зажигается именно из-за победы, и пользователь
  // должен сразу видеть выигрыш, а не пустую вкладку «Активные»).
  useEffect(() => {
    if (loading || tabResolved.current) return;
    const activeCount = trips.filter((t) => ['draft', 'active', 'booked'].includes(t.status)).length;
    if (activeCount === 0 && wonTrips.length > 0) setTab('won');
    tabResolved.current = true;
  }, [loading, trips, wonTrips]);

  const filteredTrips = trips.filter((trip) => {
    if (tab === 'active') {
      return ['draft', 'active', 'booked'].includes(trip.status);
    } else {
      return ['completed', 'cancelled'].includes(trip.status);
    }
  });

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
        <div className="font-display font-bold">Мои поездки</div>
        <div className="w-16" />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-24 md:pt-32 pb-24 md:pb-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(['active', 'completed', 'won'] as TripsTab[]).map((t) => (
            <button
              key={t}
              onClick={() => { tabResolved.current = true; setTab(t); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                tab === t
                  ? 'btn-mesh'
                  : 'glass-card text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {t === 'won' && <Trophy size={13} className={tab === t ? '' : 'text-yellow-400'} />}
              {t === 'active' ? 'Активные' : t === 'completed' ? 'Завершённые' : 'Победы'}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-10 h-10 border-4 border-primary-container border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-error/10 border border-error/30 text-error">
            <AlertCircle size={18} className="flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        ) : tab === 'won' ? (
          wonTrips.length === 0 ? (
            <div className="text-center py-12">
              <Trophy size={32} className="text-on-surface-variant/30 mx-auto mb-3" />
              <div className="text-on-surface-variant text-sm">У вас нет выигранных аукционов</div>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <div key="won" className="space-y-3">
                {wonTrips.map((trip) => (
                  <WonTripCard
                    key={trip.id}
                    trip={trip}
                    onClick={() => navigate(`/trips/${trip.id}`)}
                  />
                ))}
              </div>
            </AnimatePresence>
          )
        ) : filteredTrips.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-on-surface-variant text-sm mb-2">
              {tab === 'active' ? 'У вас нет активных поездок' : 'У вас нет завершённых поездок'}
            </div>
            <button
              onClick={() => navigate('/create')}
              className="mt-4 px-4 py-2 rounded-xl bg-primary-container/20 border border-primary-container/30 text-primary-container hover:bg-primary-container/30 transition-all text-sm font-medium"
            >
              Создать поездку
            </button>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <div key={`${tab}-${filteredTrips.length}`} className="space-y-3">
              {filteredTrips.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onClick={() => navigate(`/trips/${trip.id}`)}
                  onPay={handlePay}
                  onReceipt={(id) => navigate(`/receipt/${id}`)}
                  paying={payingId === trip.id}
                />
              ))}
            </div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
