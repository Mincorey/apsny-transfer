import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Clock, Users, Zap, Search, Star, Car, ChevronRight,
  Timer, ShieldAlert, ArrowUpDown, Route, LogIn, RefreshCw, CreditCard,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PUBLICATION_PRICE } from '../lib/publishRide';
import { pluralTrips } from '../lib/utils';

// Free-тариф Supabase: realtime-подключения дефицитны (лимит 200 одновременных).
// Лента обновляется опросом, а не постоянной realtime-подпиской на всю таблицу rides
// (которая ещё и рассылалась всем зрителям ленты — веерная нагрузка).
const FEED_POLL_INTERVAL_MS = 15_000; // обновление раз в 15 секунд

interface RideCreator {
  id: string;
  full_name: string;
  avatar_url: string | null;
  rating: number;
  trips_count: number;
}

interface FeedRide {
  id: string;
  type: 'request' | 'offer';
  origin: string;
  destination: string;
  departure_date: string;
  departure_time: string;
  seats: number;
  border_crossing: boolean;
  comment: string | null;
  start_price: number;
  current_price: number;
  bid_step: number;
  auction_end_time: string | null;
  status: string;
  cancelled_at: string | null;
  created_at: string;
  creator: RideCreator | null;
  amenities: string[] | null;
  bids_count: number;
}

const AMENITY_LABELS: Record<string, { icon: string; label: string }> = {
  ac:        { icon: '❄️', label: 'Кондиционер' },
  drinks:    { icon: '🥤', label: 'Напитки' },
  music:     { icon: '🎵', label: 'Музыка' },
  wifi:      { icon: '📶', label: 'Wi-Fi' },
  nosmoking: { icon: '🚭', label: 'Некурящий' },
  luggage:   { icon: '🧳', label: 'Багаж' },
};

type SortKey = 'newest' | 'price_asc' | 'price_desc' | 'auction';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'price_asc', label: 'Цена ↑' },
  { value: 'price_desc', label: 'Цена ↓' },
  { value: 'auction', label: 'Конец аукциона' },
];

function sortRides(rides: FeedRide[], key: SortKey): FeedRide[] {
  return [...rides].sort((a, b) => {
    if (key === 'price_asc') return a.current_price - b.current_price;
    if (key === 'price_desc') return b.current_price - a.current_price;
    if (key === 'auction') {
      if (!a.auction_end_time) return 1;
      if (!b.auction_end_time) return -1;
      return new Date(a.auction_end_time).getTime() - new Date(b.auction_end_time).getTime();
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// Склонение слова «ставка» по числу (1 ставка, 2 ставки, 5 ставок).
function pluralBids(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'ставка';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'ставки';
  return 'ставок';
}

export function Feed({ feedType }: { feedType?: 'offer' | 'request' }) {
  const navigate = useNavigate();
  const [rides, setRides] = useState<FeedRide[]>([]);
  const [userRole, setUserRole] = useState<'passenger' | 'driver' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('newest');
  const [activeTab, setActiveTab] = useState<'offer' | 'request' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  // Тип ленты, который сейчас показан — по нему опрос обновляет список.
  const lastTypeRef = useRef<'offer' | 'request'>('offer');

  // Есть ли у пользователя неоплаченный черновик — для баннера-напоминания.
  useEffect(() => {
    if (!userId) { setDraftId(null); return; }
    supabase
      .from('rides')
      .select('id')
      .eq('creator_id', userId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => setDraftId(data?.[0]?.id ?? null));
  }, [userId]);

  const handlePayDraft = () => {
    if (!draftId) return;
    // Ведём на страницу оплаты с условиями услуги, а не публикуем сразу.
    navigate(`/payment?ride=${draftId}`);
  };

  const fetchRides = useCallback(async (type: 'offer' | 'request') => {
    lastTypeRef.current = type;
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('rides')
        .select('id, type, origin, destination, departure_date, departure_time, seats, border_crossing, comment, start_price, current_price, bid_step, auction_end_time, status, cancelled_at, created_at, amenities, bids_count, creator:users!creator_id(id, full_name, avatar_url, rating, trips_count)')
        .or(`status.eq.active,and(status.eq.cancelled,cancelled_at.gte.${yesterday})`)
        .eq('type', type)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      const fetched = (data as unknown as FeedRide[]) || [];
      // Без realtime лента — это полный снимок (limit 50). Заменяем список целиком,
      // чтобы поездки, вышедшие из выборки (booked/completed), исчезали из ленты.
      setRides(fetched);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error fetching rides:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
        setIsAuthenticated(true);

        if (feedType) {
          fetchRides(feedType);
          return;
        }

        supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => {
            const role = data?.role as 'passenger' | 'driver' | null;
            setUserRole(role);
            const type = role === 'driver' ? 'request' : 'offer';
            fetchRides(type);
          });
      } else {
        setIsAuthenticated(false);
        fetchRides(feedType ?? 'offer');
      }
    });
  }, [feedType, fetchRides]);

  // Обновление ленты опросом (замена realtime): раз в 15 сек + при возврате на вкладку.
  // Живая цена важна на странице самой поездки; в ленте достаточно периодического обновления.
  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      if (cancelled) return;
      // Не опрашиваем, пока вкладка скрыта — экономим запросы.
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchRides(lastTypeRef.current);
    };

    const intervalId = setInterval(refresh, FEED_POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchRides]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await fetchRides(lastTypeRef.current);
    setRefreshing(false);
  };

  const filteredRides = sortRides(
    rides.filter((ride) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return ride.origin.toLowerCase().includes(q) || ride.destination.toLowerCase().includes(q);
    }),
    sortBy
  );

  const resolvedType = activeTab ?? feedType ?? (userRole === 'driver' ? 'request' : 'offer');
  const headingLabel = resolvedType === 'offer' ? 'Предложения водителей' : 'Запросы пассажиров';

  function switchTab(tab: 'offer' | 'request') {
    if (tab === resolvedType) return;
    setActiveTab(tab);
    setLoading(true);
    setRides([]);
    fetchRides(tab);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-display font-bold">Активные аукционы</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            title="Обновить ленту"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Обновить</span>
          </button>
          {!isAuthenticated && (
            <a
              href="/"
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-[#00f0ff]/40 text-[#00f0ff] bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 transition-all"
            >
              <LogIn size={15} />
              Войти
            </a>
          )}
        </div>
      </div>

      {/* Напоминание о неоплаченном черновике */}
      {isAuthenticated && draftId && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl bg-amber-400/10 border border-amber-400/30"
        >
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <CreditCard size={18} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-amber-300">У вас есть неопубликованная поездка</div>
              <div className="text-xs text-on-surface-variant">
                Опубликуйте её, чтобы она появилась в ленте и стартовал аукцион. Неопубликованный черновик удалится через сутки.
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {/* Цена услуги показана, но зачёркнута: тариф 100 ₽ действует,
                а пока ЮMoney подключается — размещение бесплатное.
                Кнопка ведёт на страницу с полными условиями. */}
            <button
              onClick={handlePayDraft}
              className="flex flex-col items-center justify-center px-4 py-2 rounded-xl btn-mesh text-white text-sm font-bold"
            >
              <span>Опубликовать</span>
              <span className="text-[10px] font-medium opacity-90">
                <s>{PUBLICATION_PRICE} ₽</s> сейчас бесплатно
              </span>
            </button>
            <button
              onClick={() => navigate('/my-trips')}
              className="px-4 py-2 rounded-xl glass-card border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-sm font-semibold transition-colors"
            >
              Мои поездки
            </button>
          </div>
        </motion.div>
      )}

      {/* Tab switcher (only for authenticated users without forced feedType) */}
      {isAuthenticated && !feedType && (
        <div className="flex gap-1 p-1 rounded-2xl bg-surface-container-low/60 border border-outline-variant/20 w-fit">
          {(['offer', 'request'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                resolvedType === tab
                  ? tab === 'offer'
                    ? 'bg-[#7701d0]/30 border border-[#7701d0]/50 text-[#b47aff]'
                    : 'bg-[#00e290]/15 border border-[#00e290]/40 text-[#00e290]'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
              }`}
            >
              {tab === 'offer' ? 'Предложения водителей' : 'Запросы пассажиров'}
            </button>
          ))}
        </div>
      )}

      {/* Filters bar */}
      <div className="glass-panel p-4 rounded-2xl flex flex-col sm:flex-row gap-3 items-center bg-surface-container-low/50">
        <span className="text-on-surface-variant text-sm font-medium shrink-0 hidden sm:block">
          {headingLabel}
        </span>

        <div className="flex flex-1 gap-3 w-full">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              aria-label="Поиск по маршруту"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl input-glass text-sm text-on-surface placeholder:text-outline"
              placeholder="Поиск по маршруту..."
            />
          </div>

          <div className="relative">
            <ArrowUpDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none" aria-hidden="true" />
            <select
              aria-label="Порядок сортировки"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="pl-8 pr-3 py-2 rounded-xl input-glass text-sm text-on-surface appearance-none cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => <RideSkeleton key={i} />)}
        </div>
      ) : filteredRides.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center justify-center py-24 gap-4 text-center"
        >
          <Route size={52} className="text-outline/40" />
          <p className="text-on-surface-variant text-lg font-medium">
            {searchQuery ? 'По вашему запросу ничего не найдено' : 'Активных аукционов пока нет'}
          </p>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-sm text-[#00f0ff] hover:underline"
            >
              Сбросить поиск
            </button>
          )}
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AnimatePresence mode="popLayout">
            {filteredRides.map((ride) => (
              <RideCard
                key={ride.id}
                ride={ride}
                isAuthenticated={isAuthenticated}
                userId={userId}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────

function RideSkeleton() {
  return (
    <div className="glass-card rounded-3xl p-6 space-y-4 animate-pulse">
      <div className="flex justify-between">
        <div className="h-5 bg-surface-container-high rounded-full w-32" />
        <div className="h-5 bg-surface-container-high rounded-full w-20" />
      </div>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-surface-container-high shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-surface-container-high rounded w-1/2" />
          <div className="h-3 bg-surface-container-high rounded w-1/3" />
        </div>
      </div>
      <div className="space-y-3 pl-1">
        <div className="h-5 bg-surface-container-high rounded w-3/4" />
        <div className="h-5 bg-surface-container-high rounded w-2/3" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-16 bg-surface-container-high rounded-2xl" />
        <div className="h-16 bg-surface-container-high rounded-2xl" />
      </div>
      <div className="h-11 bg-surface-container-high rounded-xl" />
    </div>
  );
}

// ─── Auction Timer ───────────────────────────────────────────────

function AuctionTimer({ endTime }: { endTime: string | null }) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    if (!endTime) return;

    const update = () => {
      const diff = new Date(endTime).getTime() - Date.now();
      if (diff <= 0) { setDisplay('Завершён'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setDisplay(h > 0 ? `${h}ч ${m}м` : m > 0 ? `${m}м ${s}с` : `${s}с`);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  if (!endTime || !display) return null;

  const isUrgent = new Date(endTime).getTime() - Date.now() < 3_600_000;

  return (
    <div className={`flex items-center gap-1 text-xs font-mono font-bold whitespace-nowrap ${isUrgent ? 'text-red-400' : 'text-[#00f0ff]'}`}>
      <Timer size={11} />
      {display}
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────

function Avatar({ creator }: { creator: RideCreator | null }) {
  if (!creator) {
    return (
      <div className="w-10 h-10 rounded-full bg-surface-container-high shrink-0" />
    );
  }

  if (creator.avatar_url) {
    return (
      <img
        src={creator.avatar_url}
        alt={creator.full_name}
        loading="lazy"
        decoding="async"
        className="w-10 h-10 rounded-full object-cover border border-white/10 shrink-0"
      />
    );
  }

  const initials = creator.full_name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <div className="w-10 h-10 rounded-full bg-[#00f0ff]/15 border border-[#00f0ff]/30 flex items-center justify-center text-sm font-bold text-[#00f0ff] shrink-0">
      {initials}
    </div>
  );
}

// ─── Ride Card ───────────────────────────────────────────────────

function RideCard({
  ride,
  isAuthenticated,
  userId,
}: {
  ride: FeedRide;
  isAuthenticated: boolean;
  userId: string | null;
}) {
  const navigate = useNavigate();
  const isRequest = ride.type === 'request';
  const isOwnRide = userId === ride.creator?.id;
  const isCancelled = ride.status === 'cancelled';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: isCancelled ? 0.55 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      onClick={isCancelled ? undefined : () => navigate(`/trips/${ride.id}`)}
      className={`glass-card rounded-3xl p-6 group transition-colors ${
        isCancelled ? 'cursor-default grayscale' : 'cursor-pointer hover:border-[#00f0ff]/20'
      }`}
    >
      {/* Top row: type badge + timer */}
      <div className="flex justify-between items-center mb-4 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border ${
            isRequest
              ? 'text-[#00e290] bg-[#00e290]/10 border-[#00e290]/30'
              : 'text-[#b47aff] bg-[#7701d0]/10 border-[#7701d0]/30'
          }`}>
            {isRequest ? 'Запрос пассажира' : 'Предложение водителя'}
          </span>
          {ride.border_crossing && !isCancelled && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400">
              <ShieldAlert size={11} />
              Граница
            </span>
          )}
          {isCancelled && (
            <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border text-red-400 bg-red-500/10 border-red-500/30">
              ОТМЕНЕНА
            </span>
          )}
        </div>
        {!isCancelled && <AuctionTimer endTime={ride.auction_end_time} />}
      </div>

      {/* Creator */}
      <div className="flex items-center gap-3 mb-5">
        <Avatar creator={ride.creator} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-on-surface truncate">
            {ride.creator?.full_name ?? 'Пользователь'}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {/* Рейтинг есть только у водителей. В предложении («offer») автор —
                водитель, в запросе («request») — пассажир, у него оценки нет. */}
            {ride.type === 'offer' && (ride.creator?.rating ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-xs text-on-surface-variant">
                <Star size={11} className="text-yellow-400 fill-yellow-400" />
                {ride.creator!.rating.toFixed(1)}
              </span>
            )}
            {(ride.creator?.trips_count ?? 0) > 0 && (
              <span className="text-xs text-outline">
                {pluralTrips(ride.creator!.trips_count)}
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-on-surface-variant text-sm shrink-0">
          <Clock size={13} className="text-[#00f0ff]" />
          {ride.departure_time.slice(0, 5)}
        </div>
      </div>

      {/* Route */}
      <div className="flex items-stretch gap-4 mb-5">
        <div className="w-6 flex flex-col items-center py-1 gap-1 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-[#00f0ff] shadow-[0_0_8px_rgba(0,240,255,0.8)]" />
          <div className="flex-1 w-px bg-gradient-to-b from-[#00f0ff] to-[#7701d0] min-h-[24px]" />
          <div className="w-2.5 h-2.5 rounded-full border-2 border-[#7701d0]" />
        </div>
        <div className="flex-1 space-y-4">
          <div>
            <div className="text-[10px] text-outline uppercase tracking-widest mb-0.5">Откуда</div>
            <div className="font-bold text-on-surface">{ride.origin}</div>
          </div>
          <div>
            <div className="text-[10px] text-outline uppercase tracking-widest mb-0.5">Куда</div>
            <div className="font-bold text-on-surface">{ride.destination}</div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-surface-container-low rounded-2xl p-3 border border-outline-variant/30">
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mb-1">
            <Users size={12} />
            Места
          </div>
          <div className="text-xl font-bold">{ride.seats}</div>
        </div>
        <div className="bg-surface-container-low rounded-2xl p-3 border border-outline-variant/30 relative overflow-hidden">
          <div className="absolute inset-0 bg-[#00f0ff]/5" />
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mb-1 relative">
            <Zap size={12} className="text-[#00f0ff]" />
            Текущая цена
          </div>
          <motion.div
            key={ride.current_price}
            initial={{ scale: 1.15, color: '#00f0ff' }}
            animate={{ scale: 1, color: '#00f0ff' }}
            transition={{ duration: 0.4 }}
            className="text-xl font-display font-bold text-[#00f0ff] relative"
          >
            {ride.current_price.toLocaleString('ru-RU')} ₽
          </motion.div>
          <div className="text-[11px] text-on-surface-variant/70 mt-1 relative">
            {ride.bids_count > 0 ? `${ride.bids_count} ${pluralBids(ride.bids_count)}` : 'Ставок пока нет'}
          </div>
        </div>
      </div>

      {/* Amenities */}
      {ride.amenities && ride.amenities.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {ride.amenities.map(id => {
            const a = AMENITY_LABELS[id];
            return a ? (
              <span key={id} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-container-high/60 border border-outline-variant/20 text-xs text-on-surface-variant">
                <span>{a.icon}</span>{a.label}
              </span>
            ) : null;
          })}
        </div>
      )}

      {/* Comment preview */}
      {ride.comment && (
        <p className="text-xs text-on-surface-variant mb-4 line-clamp-2 whitespace-pre-wrap">{ride.comment}</p>
      )}

      {/* CTA */}
      {!isCancelled && (
        !isAuthenticated ? (
          <a
            href="/"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#00f0ff]/30 text-[#00f0ff] text-sm font-semibold hover:bg-[#00f0ff]/10 transition-colors"
          >
            <LogIn size={15} />
            Войти для участия
          </a>
        ) : isOwnRide ? (
          <div className="flex items-center justify-center gap-1.5 text-xs text-outline py-2">
            <Car size={13} />
            Ваша поездка
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#00f0ff]/20 text-[#00f0ff]/80 text-sm font-semibold group-hover:border-[#00f0ff]/40 group-hover:text-[#00f0ff] transition-colors">
            Открыть и сделать ставку
            <ChevronRight size={14} />
          </div>
        )
      )}
    </motion.div>
  );
}
