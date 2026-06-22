import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getOptimizedImageUrl } from '../lib/imageOptimization';
import { TopNav } from '../components/layout/TopNav';
import { BottomNav } from '../components/layout/BottomNav';
import { useUnreadCount } from '../hooks/useUnreadCount';
import {
  ArrowLeft, Clock, Users, Timer, ShieldAlert, Star,
  MessageCircle, Phone, LogIn, Trophy, Calendar, PenLine, X as XIcon, Car,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ReviewModal } from '../components/ui/ReviewModal';
import { Modal } from '../components/ui/Modal';
import { Footer } from '../components/layout/Footer';
import { useToast } from '../context/ToastContext';

interface TripCreator {
  id: string;
  full_name: string;
  avatar_url: string | null;
  rating: number;
  trips_count: number;
  phone?: string | null;
  telegram?: string | null;
  whatsapp?: string | null;
  show_phone?: boolean;
  show_telegram?: boolean;
  show_whatsapp?: boolean;
}

interface TripWinner {
  id: string;
  full_name: string;
  avatar_url: string | null;
  phone?: string | null;
  telegram?: string | null;
  whatsapp?: string | null;
}

const AMENITY_LABELS: Record<string, { icon: string; label: string }> = {
  ac:        { icon: '❄️', label: 'Кондиционер' },
  drinks:    { icon: '🥤', label: 'Напитки' },
  music:     { icon: '🎵', label: 'Музыка' },
  wifi:      { icon: '📶', label: 'Wi-Fi' },
  nosmoking: { icon: '🚭', label: 'Некурящий' },
  luggage:   { icon: '🧳', label: 'Место для багажа' },
};

interface TripDetailRide {
  id: string;
  type: 'request' | 'offer';
  origin: string;
  destination: string;
  departure_date: string;
  departure_time: string;
  seats: number;
  border_crossing: boolean;
  comment: string | null;
  amenities: string[] | null;
  start_price: number;
  current_price: number;
  bid_step: number;
  auction_end_time: string | null;
  winner_id: string | null;
  creator_id: string;
  status: string;
  created_at: string;
  creator: TripCreator | null;
  winner: TripWinner | null;
}

interface BidEntry {
  id: string;
  amount: number;
  created_at: string;
  bidder: { id: string; full_name: string; avatar_url: string | null } | null;
}

function AvatarLarge({ user }: { user: { full_name: string; avatar_url: string | null } | null }) {
  if (!user) return <div className="w-14 h-14 rounded-full bg-surface-container-high shrink-0" />;
  if (user.avatar_url) {
    return (
      <img
        src={getOptimizedImageUrl(user.avatar_url, { width: 80, quality: 85 }) || user.avatar_url}
        alt={user.full_name}
        className="w-14 h-14 rounded-full object-cover border border-white/10 shrink-0"
        loading="lazy"
        decoding="async"
      />
    );
  }
  const initials = user.full_name.split(' ').slice(0, 2).map((n) => n[0] ?? '').join('').toUpperCase();
  return (
    <div className="w-14 h-14 rounded-full bg-[#00f0ff]/15 border border-[#00f0ff]/30 flex items-center justify-center text-lg font-bold text-[#00f0ff] shrink-0">
      {initials}
    </div>
  );
}

function AuctionTimer({ endTime, large }: { endTime: string | null; large?: boolean }) {
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
    <span className={`font-mono font-bold flex items-center gap-1.5 ${large ? 'text-base' : 'text-sm'} ${isUrgent ? 'text-red-400' : 'text-[#00f0ff]'}`}>
      <Timer size={large ? 16 : 14} />
      {display}
    </span>
  );
}

function formatDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatBidTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return (
    date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) +
    ' ' +
    date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  );
}

export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const unreadCount = useUnreadCount();

  const [ride, setRide] = useState<TripDetailRide | null>(null);
  const [bids, setBids] = useState<BidEntry[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [bidDelta, setBidDelta] = useState('');
  const [bidding, setBidding] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [closingAuction, setClosingAuction] = useState(false);
  const [cancellingRide, setCancellingRide] = useState(false);
  const [completingTrip, setCompletingTrip] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);
  const [showBidConfirmModal, setShowBidConfirmModal] = useState(false);
  const [pendingBidAmount, setPendingBidAmount] = useState<number | null>(null);

  // Контакты гейтятся серверно в get_trip_view (P1): creator-контакты приходят
  // только победителю/создателю после booked/completed (с учётом show_*),
  // winner-контакты — только создателю. Один RPC вместо нескольких запросов.
  const fetchRide = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.rpc('get_trip_view', { p_ride_id: id });
    const view = data as { ride?: TripDetailRide } | null;
    if (view?.ride) setRide(view.ride);
  }, [id]);

  const fetchBids = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('bids')
      .select('*, bidder:users!bidder_id(id, full_name, avatar_url)')
      .eq('ride_id', id)
      .order('created_at', { ascending: false });
    setBids((data as BidEntry[]) || []);
  }, [id]);

  useEffect(() => {
    if (!id) return;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      if (uid) {
        setUserId(uid);
        setIsAuthenticated(true);
      }

      // get_trip_view: поездка + создатель/победитель (контакты гейтятся серверно)
      // + ставки + has_reviewed одним запросом. Ленивое закрытие истёкшего
      // аукциона выполняется внутри RPC.
      const { data, error } = await supabase.rpc('get_trip_view', { p_ride_id: id });
      const view = data as { ride?: TripDetailRide; bids?: BidEntry[]; has_reviewed?: boolean } | null;

      if (error || !view?.ride) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setRide(view.ride);
      setBids(view.bids ?? []);
      setHasReviewed(!!view.has_reviewed);
      setLoading(false);
    })();

    const rideChannel = supabase
      .channel(`trip-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `id=eq.${id}`,
      }, (payload) => {
        const next = payload.new as TripDetailRide;
        setRide((prev) => (prev ? { ...prev, ...next } : prev));
        // Аукцион закрылся в реальном времени — подтягиваем гейтнутые контакты
        // победителя/создателя через RPC (в payload их нет).
        if (next.status === 'booked' || next.status === 'completed') {
          fetchRide();
        }
      })
      .subscribe();

    const bidsChannel = supabase
      .channel(`trip-bids-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'bids',
        filter: `ride_id=eq.${id}`,
      }, (payload) => {
        fetchBids();
        // Notify the ride creator about a new bid
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user?.id) {
            supabase.from('rides').select('creator_id').eq('id', id).single().then(({ data: r }) => {
              if (r?.creator_id === session.user!.id) {
                const amount = (payload.new as any).amount;
                showToast('bid', 'Новая ставка!', `${Number(amount).toLocaleString('ru-RU')} ₽`);
              }
            });
          }
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(rideChannel);
      supabase.removeChannel(bidsChannel);
    };
  }, [id, fetchRide, fetchBids, showToast]);

  const handleBidClick = (amount: number) => {
    setPendingBidAmount(amount);
    setShowBidConfirmModal(true);
  };

  const handleBid = async (amount: number) => {
    if (!userId || !id) return;
    setBidding(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('place_bid', {
        p_ride_id: id,
        p_amount: amount,
      });
      if (error) throw error;
      setBidDelta('');
      await Promise.all([fetchRide(), fetchBids()]);
      showToast('bid', 'Ставка принята!', `${amount.toLocaleString('ru-RU')} ₽`);
      setShowBidConfirmModal(false);
      setPendingBidAmount(null);
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Ошибка при отправке ставки');
    } finally {
      setBidding(false);
    }
  };

  const handleAcceptPrice = async () => {
    if (!userId || !id) return;
    setAccepting(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('accept_current_price', {
        p_ride_id: id,
        p_bidder_id: userId,
      });
      if (error) throw error;
      fetchBids();
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Ошибка при принятии цены');
    } finally {
      setAccepting(false);
    }
  };

  const handleCloseAuction = async () => {
    if (!id) return;
    setClosingAuction(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('close_auction_early', { p_ride_id: id });
      if (error) throw error;
      await Promise.all([fetchRide(), fetchBids()]);
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Ошибка при завершении аукциона');
    } finally {
      setClosingAuction(false);
    }
  };

  const handleCancelRide = async () => {
    if (!id) return;
    setCancellingRide(true);
    setShowCancelModal(false);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('cancel_ride', { p_ride_id: id });
      if (error) throw error;
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Ошибка при отмене поездки');
      setCancellingRide(false);
    }
  };

  const handleCompleteTrip = async () => {
    if (!id) return;
    setCompletingTrip(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('complete_trip', { p_ride_id: id });
      if (error) throw error;
      await fetchRide();
      showToast('success', 'Поездка завершена!', 'Теперь пассажир может оставить отзыв');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Ошибка при завершении поездки');
    } finally {
      setCompletingTrip(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-container border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !ride) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center px-4">
        <p className="text-on-surface-variant text-lg">Поездка не найдена</p>
        <button onClick={() => navigate('/')} className="text-[#00f0ff] hover:underline text-sm">
          На главную
        </button>
      </div>
    );
  }

  const isOwnRide = userId === ride.creator_id;
  const isWinner = userId === ride.winner_id;
  const isParticipant = isOwnRide || isWinner;
  const isCompleted = ride.status === 'completed';
  const isBooked = ride.status === 'booked';
  const isActive = ride.status === 'active';
  const hasHeaderContent = (!!ride.auction_end_time && isActive) || !isAuthenticated;
  const isRequest = ride.type === 'request';
  const canBid = isAuthenticated && !isOwnRide && isActive;
  const canSeeCreatorContacts = isParticipant && (isCompleted || isBooked);

  // Роли по типу поездки: водителя оценивает пассажир.
  // offer: водитель = создатель, пассажир = победитель. request: наоборот.
  const driverId = isRequest ? ride.winner_id : ride.creator_id;
  const driverName = (isRequest ? ride.winner?.full_name : ride.creator?.full_name) ?? '';
  const passengerId = isRequest ? ride.creator_id : ride.winner_id;
  const isPassenger = !!userId && userId === passengerId;

  // Отзыв оставляет пассажир о водителе.
  const reviewTarget = { id: driverId ?? '', name: driverName };
  const canLeaveReview = isCompleted && isPassenger && !hasReviewed && !!reviewTarget.id;

  const quickBidAmounts = isRequest
    ? [1, 2, 3, 4].map((n) => ride.current_price - ride.bid_step * n).filter((a) => a > 0)
    : [1, 2, 3, 4].map((n) => ride.current_price + ride.bid_step * n);

  const minBidStep = Math.max(50, ride.bid_step);
  const parsedDelta = parseInt(bidDelta, 10);
  const isDeltaValid = !isNaN(parsedDelta) && parsedDelta >= minBidStep;
  const computedBidAmount = isDeltaValid
    ? isRequest ? ride.current_price - parsedDelta : ride.current_price + parsedDelta
    : null;
  const canAcceptPrice = canBid && bids.length === 0;

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col">
      {isAuthenticated && <TopNav unreadCount={unreadCount} />}

      <div className="flex-1 flex flex-col overflow-hidden min-h-0 text-on-surface">
        {/* Top bar */}
        <header className="fixed top-0 md:top-16 left-0 right-0 z-40 md:flex md:items-center md:justify-end bg-surface/80 backdrop-blur-2xl border-b border-white/5 md:px-8 px-4">
          {ride?.auction_end_time && isActive ? (
            <div className="w-full h-12 md:h-16 flex items-center justify-center md:justify-end gap-2 text-sm md:text-base">
              <span className="text-on-surface-variant whitespace-nowrap">До завершения:</span>
              <AuctionTimer endTime={ride.auction_end_time} large={false} />
            </div>
          ) : !isAuthenticated ? (
            <div className="h-16 flex items-center justify-center md:justify-end gap-3 w-full">
              <a
                href="/login"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[#00f0ff]/40 text-[#00f0ff] bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 transition-all"
              >
                <LogIn size={13} />
                Войти
              </a>
            </div>
          ) : null}
        </header>

        <main className="flex-1 overflow-y-auto w-full min-h-0">
          <div className={`max-w-3xl mx-auto w-full md:p-8 p-4 pb-24 md:pb-8 space-y-5 ${hasHeaderContent ? 'pt-32 md:pt-32' : 'pt-6 md:pt-20'}`}>
        {/* Back button */}
        <button
          onClick={() => (window.history.length > 2 ? navigate(-1) : navigate('/'))}
          className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors mb-2"
        >
          <ArrowLeft size={18} />
          Назад
        </button>

        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border ${
            isRequest
              ? 'text-[#00e290] bg-[#00e290]/10 border-[#00e290]/30'
              : 'text-[#b47aff] bg-[#7701d0]/10 border-[#7701d0]/30'
          }`}>
            {isRequest ? 'Запрос пассажира' : 'Предложение водителя'}
          </span>
          {ride.border_crossing && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400">
              <ShieldAlert size={11} />
              Граница
            </span>
          )}
          {isBooked && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Car size={11} />
              Забронировано
            </span>
          )}
          {isCompleted && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">
              <Trophy size={11} />
              Завершён
            </span>
          )}
          {ride.status === 'cancelled' && (
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400">
              Отменён
            </span>
          )}
        </div>

        {/* Creator card */}
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-start gap-4 mb-3">
            <AvatarLarge user={ride.creator} />
            <div className="flex-1 min-w-0">
              <div className="font-display text-lg font-bold mb-2">{ride.creator?.full_name ?? 'Пользователь'}</div>
              <div className="space-y-1.5">
                {(ride.creator?.rating ?? 0) > 0 && (
                  <div className="flex items-center gap-1 text-sm text-on-surface-variant">
                    <Star size={13} className="text-yellow-400 fill-yellow-400" />
                    <span className="font-semibold text-on-surface">{ride.creator!.rating.toFixed(1)}</span>
                    <span className="text-xs">рейтинг</span>
                  </div>
                )}
                {(ride.creator?.trips_count ?? 0) > 0 && (
                  <div className="text-sm text-on-surface-variant">
                    <span className="font-semibold text-on-surface">{ride.creator!.trips_count}</span>
                    <span className="ml-1">{ride.creator!.trips_count === 1 ? 'поездка' : ride.creator!.trips_count < 5 ? 'поездки' : 'поездок'}</span>
                  </div>
                )}
              </div>
            </div>
            {isAuthenticated && !isOwnRide && (
              <button
                onClick={() => navigate(`/messages/${ride.id}`)}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-surface-container hover:bg-white/10 border border-white/10 transition-colors"
              >
                <MessageCircle size={15} />
                Написать
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canSeeCreatorContacts && ride.creator?.telegram && ride.creator.show_telegram !== false && (
              <a
                href={`https://t.me/${ride.creator.telegram.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-xl bg-[#229ED9]/10 border border-[#229ED9]/30 text-[#229ED9] hover:bg-[#229ED9]/20 transition-colors"
              >
                Telegram
              </a>
            )}
            {/* Телефон и WhatsApp скрыты на время модерации Platega — связь только через Telegram. */}
            {!canSeeCreatorContacts && isAuthenticated && !isOwnRide && (
              <span className="text-xs text-on-surface-variant/60 italic">
                Контакты доступны победителю после завершения аукциона
              </span>
            )}
          </div>
        </div>

        {/* Route + Details */}
        <div className="glass-card rounded-3xl p-5 grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs text-outline uppercase tracking-widest mb-4">Маршрут</div>
            <div className="flex items-stretch gap-4">
              <div className="w-6 flex flex-col items-center py-1 gap-1 shrink-0">
                <div className="w-3 h-3 rounded-full bg-[#00f0ff] shadow-[0_0_10px_rgba(0,240,255,0.8)]" />
                <motion.div
                  className="flex-1 w-0.5 min-h-[48px]"
                  style={{ background: 'linear-gradient(to bottom, #00f0ff, #7701d0)' }}
                  initial={{ scaleY: 0, originY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
                <div className="w-3 h-3 rounded-full border-2 border-[#7701d0]" />
              </div>
              <div className="flex-1 space-y-6">
                <div>
                  <div className="text-[10px] text-outline uppercase tracking-widest mb-0.5">Откуда</div>
                  <div className="text-xl font-bold">{ride.origin}</div>
                </div>
                <div>
                  <div className="text-[10px] text-outline uppercase tracking-widest mb-0.5">Куда</div>
                  <div className="text-xl font-bold">{ride.destination}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs text-outline uppercase tracking-widest mb-4">Детали</div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar size={14} className="text-[#00f0ff] shrink-0" />
              <span>{formatDate(ride.departure_date)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock size={14} className="text-[#00f0ff] shrink-0" />
              <span>{ride.departure_time.slice(0, 5)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Users size={14} className="text-[#00f0ff] shrink-0" />
              <span>
                {ride.seats}{' '}
                {ride.seats === 1 ? 'место' : ride.seats < 5 ? 'места' : 'мест'}
              </span>
            </div>
            {ride.amenities && ride.amenities.length > 0 && (
              <div className="mt-3 pt-3 border-t border-outline-variant/30">
                <div className="text-[10px] text-outline uppercase tracking-widest mb-2">Удобства</div>
                <div className="flex flex-wrap gap-1.5">
                  {ride.amenities.map(id => {
                    const a = AMENITY_LABELS[id];
                    return a ? (
                      <span key={id} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-container-high/60 border border-outline-variant/20 text-xs text-on-surface-variant">
                        {a.icon} {a.label}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            )}
            {ride.comment && (
              <div className="mt-3 pt-3 border-t border-outline-variant/30 text-sm text-on-surface-variant whitespace-pre-wrap">
                {ride.comment}
              </div>
            )}
          </div>
        </div>

        {/* Auction block */}
        <div className="glass-card rounded-3xl p-5 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs text-outline uppercase tracking-widest mb-1">Начальная цена</div>
              <div className="text-on-surface-variant font-mono text-lg">
                {ride.start_price.toLocaleString('ru-RU')} ₽
              </div>
            </div>
            <div className="text-2xl text-outline">→</div>
            <div className="text-right">
              <div className="text-xs text-outline uppercase tracking-widest mb-1">Текущая цена</div>
              <motion.div
                key={ride.current_price}
                initial={{ scale: 1.2, color: '#00f0ff' }}
                animate={{ scale: 1, color: '#00f0ff' }}
                transition={{ duration: 0.4 }}
                className="text-3xl font-display font-bold text-[#00f0ff]"
              >
                {ride.current_price.toLocaleString('ru-RU')} ₽
              </motion.div>
            </div>
          </div>

          {/* Accept current price — only before any bids */}
          {canAcceptPrice && (
            <div className="pt-2 border-t border-outline-variant/30 space-y-3">
              <div className="text-xs text-outline uppercase tracking-widest">Принять участие</div>
              <button
                onClick={handleAcceptPrice}
                disabled={accepting}
                className="w-full py-3 rounded-xl bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff] font-bold text-sm hover:bg-[#00f0ff]/20 transition-colors disabled:opacity-50"
              >
                {accepting ? '...' : `Принять цену — ${ride.current_price.toLocaleString('ru-RU')} ₽`}
              </button>
              <p className="text-xs text-on-surface-variant text-center">
                После принятия аукцион откроется — другие смогут перебить ставку
              </p>
            </div>
          )}

          {/* Delta bid form — after auction started */}
          {canBid && bids.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-outline-variant/30">
              <div className="text-xs text-outline uppercase tracking-widest">
                {isRequest ? 'Снизить цену' : 'Повысить ставку'}
              </div>
              <div className="flex flex-col gap-2">
                {quickBidAmounts.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => handleBidClick(amount)}
                    disabled={bidding}
                    className="w-full py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-[#00f0ff]/20 to-[#7701d0]/20 border border-[#00f0ff]/40 text-white hover:from-[#00f0ff]/30 hover:to-[#7701d0]/30 transition-colors disabled:opacity-40"
                  >
                    {isRequest ? '−' : '+'}
                    {Math.abs(amount - ride.current_price).toLocaleString('ru-RU')} ₽
                    <span className="ml-1.5 text-xs font-normal text-on-surface-variant">
                      → {amount.toLocaleString('ru-RU')}
                    </span>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <div className="relative w-full">
                  <input
                    type="number"
                    value={bidDelta}
                    onChange={(e) => { setBidDelta(e.target.value); setErrorMsg(null); }}
                    className="w-full pl-4 pr-8 py-3 rounded-xl input-glass text-sm"
                    placeholder={`${isRequest ? 'Снижение' : 'Надбавка'} (мин. ${minBidStep} ₽)`}
                    inputMode="numeric"
                    min={minBidStep}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-outline text-sm">₽</span>
                </div>
                <button
                  onClick={() => computedBidAmount !== null && handleBidClick(computedBidAmount)}
                  disabled={bidding || !isDeltaValid}
                  className="w-full py-3 rounded-xl btn-mesh font-bold text-sm disabled:opacity-50"
                >
                  {bidding ? '...' : 'Ставка'}
                </button>
                {isDeltaValid && computedBidAmount !== null && (
                  <p className="text-xs text-on-surface-variant pl-1">
                    Итоговая ставка:{' '}
                    <span className="text-[#00f0ff] font-semibold">
                      {computedBidAmount.toLocaleString('ru-RU')} ₽
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Error message */}
          <AnimatePresence>
            {errorMsg && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-red-400 text-sm pt-1"
              >
                {errorMsg}
              </motion.p>
            )}
          </AnimatePresence>

          {!isAuthenticated && (
            <div className="pt-2 border-t border-outline-variant/30">
              <a
                href="/login"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-[#00f0ff]/30 text-[#00f0ff] text-sm font-semibold hover:bg-[#00f0ff]/10 transition-colors"
              >
                <LogIn size={15} />
                Войдите, чтобы участвовать в аукционе
              </a>
            </div>
          )}

          {/* Creator controls — active auction */}
          {isAuthenticated && isOwnRide && isActive && (
            <div className="pt-2 border-t border-outline-variant/30 space-y-2">
              {bids.length > 0 && (
                <button
                  onClick={handleCloseAuction}
                  disabled={closingAuction}
                  className="w-full py-2.5 rounded-xl border border-[#00e290]/30 text-[#00e290] text-sm font-semibold hover:bg-[#00e290]/10 transition-colors disabled:opacity-50"
                >
                  {closingAuction
                    ? 'Завершаем...'
                    : `Завершить аукцион — принять ${ride.current_price.toLocaleString('ru-RU')} ₽`}
                </button>
              )}
              <button
                onClick={() => setShowCancelModal(true)}
                disabled={cancellingRide}
                className="w-full py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                {cancellingRide ? 'Отменяем...' : 'Отменить поездку'}
              </button>
            </div>
          )}

          {/* Creator controls — booked: mark trip as completed */}
          {isAuthenticated && isOwnRide && isBooked && (
            <div className="pt-2 border-t border-outline-variant/30 space-y-2">
              <button
                onClick={handleCompleteTrip}
                disabled={completingTrip}
                className="w-full py-2.5 rounded-xl border border-[#00e290]/30 text-[#00e290] text-sm font-semibold hover:bg-[#00e290]/10 transition-colors disabled:opacity-50"
              >
                {completingTrip ? 'Завершаем...' : 'Завершить поездку'}
              </button>
              <p className="text-xs text-center text-on-surface-variant">
                Нажмите после того, как поездка состоялась
              </p>
            </div>
          )}
        </div>

        {/* Winner block */}
        {(isCompleted || isBooked) && ride.winner && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-3xl p-5 border border-green-500/20"
          >
            <div className="flex items-center gap-2 mb-4">
              <Trophy size={18} className="text-yellow-400" />
              <span className="font-bold text-green-400">Победитель аукциона</span>
            </div>
            <div className="flex items-center gap-3">
              <AvatarLarge user={ride.winner} />
              <div>
                <div className="font-semibold">{ride.winner.full_name}</div>
                {isOwnRide && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {ride.winner.telegram && (
                      <a
                        href={`https://t.me/${ride.winner.telegram.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 rounded-xl bg-[#229ED9]/10 border border-[#229ED9]/30 text-[#229ED9] hover:bg-[#229ED9]/20 transition-colors"
                      >
                        Telegram
                      </a>
                    )}
                    {/* Телефон и WhatsApp скрыты на время модерации Platega. */}
                  </div>
                )}
              </div>
            </div>
            {isWinner && (
              <div className="mt-4 pt-4 border-t border-outline-variant/30">
                <div className="text-sm text-green-400 flex items-center gap-2 mb-3">
                  <Trophy size={14} />
                  Вы выиграли этот аукцион! Свяжитесь с {isRequest ? 'пассажиром' : 'водителем'}:
                </div>
                <div className="flex flex-wrap gap-2">
                  {ride.creator?.telegram && ride.creator.show_telegram !== false && (
                    <a
                      href={`https://t.me/${ride.creator.telegram.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-xl bg-[#229ED9]/10 border border-[#229ED9]/30 text-[#229ED9] hover:bg-[#229ED9]/20 transition-colors"
                    >
                      Telegram
                    </a>
                  )}
                  {/* Телефон и WhatsApp скрыты на время модерации Platega — связь через Telegram. */}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Bid history */}
        {bids.length > 0 ? (
          <div className="glass-card rounded-3xl p-5 space-y-3">
            <div className="text-xs text-outline uppercase tracking-widest">
              История ставок ({bids.length})
            </div>
            <AnimatePresence mode="popLayout">
              {bids.map((bid, idx) => {
                const isFirst = idx === 0;
                const initials = (bid.bidder?.full_name ?? '?')
                  .split(' ')
                  .slice(0, 2)
                  .map((n) => n[0] ?? '')
                  .join('')
                  .toUpperCase();
                return (
                  <motion.div
                    key={bid.id}
                    layout
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`flex items-center gap-3 rounded-2xl ${
                      isFirst ? 'bg-[#00f0ff]/5 border border-[#00f0ff]/15 px-3 py-2' : 'py-1'
                    }`}
                  >
                    {bid.bidder?.avatar_url ? (
                      <img
                        src={getOptimizedImageUrl(bid.bidder.avatar_url, { width: 64, quality: 80 }) || bid.bidder.avatar_url}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-bold text-on-surface-variant shrink-0">
                        {initials}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {bid.bidder?.full_name ?? 'Пользователь'}
                      </div>
                      <div className="text-xs text-outline">{formatBidTime(bid.created_at)}</div>
                    </div>
                    <div
                      className={`text-sm font-bold font-mono shrink-0 ${
                        isFirst ? 'text-[#00f0ff]' : 'text-on-surface-variant'
                      }`}
                    >
                      {bid.amount.toLocaleString('ru-RU')} ₽
                      {isFirst && (
                        <span className="ml-1.5 text-xs font-normal opacity-60">лучшая</span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        ) : isActive ? (
          <p className="text-center text-outline text-sm py-4">Ставок пока нет — будь первым!</p>
        ) : null}

        {/* Review prompt — only for the winner (passenger) */}
        {canLeaveReview && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-3xl p-5 border border-yellow-500/20"
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Star size={16} className="text-yellow-400 fill-yellow-400" />
                  <span className="font-semibold">Оценить водителя</span>
                </div>
                <p className="text-sm text-on-surface-variant">
                  Оставьте отзыв о водителе{' '}
                  <span className="text-on-surface">{reviewTarget.name}</span>
                </p>
              </div>
              <button
                onClick={() => setShowReviewModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl btn-mesh text-sm font-semibold shrink-0"
              >
                <PenLine size={14} />
                Оценить водителя
              </button>
            </div>
          </motion.div>
        )}

        {hasReviewed && isCompleted && isPassenger && (
          <div className="flex items-center justify-center gap-2 text-sm text-outline py-2">
            <Star size={14} className="text-yellow-400 fill-yellow-400" />
            Вы уже оставили отзыв о водителе
          </div>
        )}
        </div>
        <Footer />
      </main>

      {/* Bid confirmation modal */}
      <Modal open={showBidConfirmModal} onClose={() => { setShowBidConfirmModal(false); setPendingBidAmount(null); setErrorMsg(null); }} size="sm">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#00f0ff]/10 border border-[#00f0ff]/25 flex items-center justify-center shadow-[0_0_24px_rgba(0,240,255,0.15)]">
            <Trophy size={28} className="text-[#00f0ff]" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-display font-semibold text-on-surface">
              Подтвердите ставку
            </h3>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Вы действительно хотите сделать ставку на{' '}
              <span className="text-[#00f0ff] font-semibold">
                {pendingBidAmount?.toLocaleString('ru-RU')} ₽
              </span>
              ?
            </p>
          </div>
          {errorMsg && (
            <p className="text-red-400 text-sm">{errorMsg}</p>
          )}
          <div className="flex gap-3 w-full pt-1">
            <button
              onClick={() => { setShowBidConfirmModal(false); setPendingBidAmount(null); setErrorMsg(null); }}
              className="flex-1 py-2.5 rounded-xl border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all font-medium text-sm"
            >
              Отменить
            </button>
            <button
              onClick={() => pendingBidAmount !== null && handleBid(pendingBidAmount)}
              disabled={bidding}
              className="flex-1 py-2.5 rounded-xl bg-[#00f0ff]/15 border border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/25 transition-all font-semibold text-sm disabled:opacity-50"
            >
              {bidding ? 'Подтверждаем...' : 'Подтвердить'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Review modal */}
      <AnimatePresence>
        {showReviewModal && id && (
          <ReviewModal
            rideId={id}
            targetId={reviewTarget.id}
            targetName={reviewTarget.name}
            onClose={() => setShowReviewModal(false)}
            onDone={() => {
              setShowReviewModal(false);
              setHasReviewed(true);
            }}
          />
        )}
      </AnimatePresence>

      {/* Cancel ride confirmation */}
      <Modal open={showCancelModal} onClose={() => setShowCancelModal(false)} size="sm">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center shadow-[0_0_24px_rgba(239,68,68,0.15)]">
            <XIcon size={28} className="text-red-400" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-display font-semibold text-on-surface">Отменить поездку?</h3>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Поездка останется видна в ленте 24 часа с бейджем «ОТМЕНЕНА», затем исчезнет.
            </p>
          </div>
          <div className="flex gap-3 w-full pt-1">
            <button
              onClick={() => setShowCancelModal(false)}
              className="flex-1 py-2.5 rounded-xl border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all font-medium text-sm"
            >
              Назад
            </button>
            <button
              onClick={handleCancelRide}
              className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-all font-semibold text-sm"
            >
              Отменить поездку
            </button>
          </div>
        </div>
      </Modal>

      {/* Mobile Bottom Navigation — only for authenticated users */}
      {isAuthenticated && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-50">
          <BottomNav unreadCount={unreadCount} />
        </div>
      )}
      </div>
     </div>
  );
}
