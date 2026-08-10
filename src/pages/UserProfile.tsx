import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft, Star, Phone, Shield,
  User, MapPin, Calendar, LogIn, Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface PublicUserProfile {
  id: string;
  full_name: string;
  role: 'passenger' | 'driver';
  phone: string;
  telegram: string | null;
  whatsapp: string | null;
  max: string | null;
  avatar_url: string | null;
  show_phone: boolean;
  show_telegram: boolean;
  show_whatsapp: boolean;
  show_max: boolean;
  rating: number;
  trips_count: number;
  created_at: string;
}

interface PublicRide {
  id: string;
  type: 'request' | 'offer';
  origin: string;
  destination: string;
  departure_date: string;
  departure_time: string;
  current_price: number;
  border_crossing: boolean;
}

interface UserReview {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: { full_name: string; avatar_url: string | null } | null;
}

type UserProfileTab = 'rides' | 'reviews';

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  const d = (digits[0] === '8' ? '7' + digits.slice(1) : digits).slice(0, 11);
  if (d.length < 11) return '+' + d;
  return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

export function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [rides, setRides] = useState<PublicRide[]>([]);
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<UserProfileTab>('rides');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [hasSharedRide, setHasSharedRide] = useState(false);
  const [isOwnProfile, setIsOwnProfile] = useState(false);

  useEffect(() => {
    if (!id) return;
    init();
  }, [id]);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    const viewerId = session?.user?.id ?? null;
    setCurrentUserId(viewerId);

    // Контакты гейтятся серверно (P1): RPC вернёт phone/telegram/whatsapp/max
    // только если зритель имеет право их видеть (own / совместная завершённая
    // поездка / включённый show_*-флаг); иначе они придут null.
    const { data: profileData, error: profileError } = await supabase
      .rpc('get_user_profile', { p_user_id: id });

    if (profileError || !profileData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setProfile(profileData as PublicUserProfile);

    if (viewerId === id) setIsOwnProfile(true);

    const [ridesResult, reviewsResult] = await Promise.all([
      supabase
        .from('rides')
        .select('id, type, origin, destination, departure_date, departure_time, current_price, border_crossing')
        .eq('creator_id', id)
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
      supabase
        .from('reviews')
        .select('id, rating, comment, created_at, reviewer:users!reviewer_id(full_name, avatar_url)')
        .eq('target_id', id)
        .order('created_at', { ascending: false }),
    ]);

    setRides((ridesResult.data ?? []) as PublicRide[]);
    setReviews((reviewsResult.data ?? []) as unknown as UserReview[]);

    if (viewerId && viewerId !== id) {
      const [s1, s2] = await Promise.all([
        supabase.from('rides').select('id').eq('status', 'completed').eq('creator_id', viewerId).eq('winner_id', id!).limit(1).maybeSingle(),
        supabase.from('rides').select('id').eq('status', 'completed').eq('creator_id', id!).eq('winner_id', viewerId).limit(1).maybeSingle(),
      ]);
      setHasSharedRide(!!(s1.data || s2.data));
    }

    setLoading(false);
  }

  function canSeeContact(showField: boolean): boolean {
    if (!currentUserId) return false;
    if (hasSharedRide) return true;
    return showField;
  }

  function formatDate(dateStr: string) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-container border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <User size={48} className="text-primary-container" />
        <p className="text-white text-xl">Пользователь не найден</p>
        <button onClick={() => navigate(-1)} className="btn-mesh px-6 py-2 rounded-xl text-sm">Назад</button>
      </div>
    );
  }

  const particles = Array.from({ length: 6 });
  const memberSince = new Date(profile.created_at).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const telegramHandle = profile.telegram ? profile.telegram.replace(/@/g, '').trim() : null;
  const whatsappDigits = profile.whatsapp ? profile.whatsapp.replace(/\D/g, '') : null;
  const maxDigits = profile.max ? profile.max.replace(/\D/g, '') : null;

  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Hero Banner — full width */}
      <div className="relative h-44 bg-gradient-to-r from-[#7701d0]/60 via-[#00f0ff]/20 to-[#7701d0]/60 overflow-hidden">
        {particles.map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-primary-container/60"
            style={{ left: `${10 + i * 15}%`, top: `${20 + (i % 3) * 25}%` }}
            animate={{ y: [-8, 8, -8], opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 2 + i * 0.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 p-2 rounded-xl glass-card hover:border-primary-container/50 transition-all z-10"
        >
          <ArrowLeft size={20} className="text-white" />
        </button>
      </div>

      {/* Centered content area */}
      <div className="max-w-2xl mx-auto px-4">
        {/* Avatar + Name — overlaps banner */}
        <div className="relative z-10 -mt-12 mb-5 flex items-end gap-4">
          <div className="w-24 h-24 rounded-full border-4 border-[#0a0e1a] overflow-hidden flex-shrink-0 bg-gradient-to-br from-primary-container/30 to-secondary-container/30 shadow-lg">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.full_name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User size={36} className="text-primary-container" />
              </div>
            )}
          </div>
          <div className="pb-1 flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white font-display truncate">{profile.full_name}</h1>
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mt-1 ${
              profile.role === 'driver'
                ? 'bg-primary-container/20 text-primary-container border border-primary-container/30'
                : 'bg-secondary-container/20 text-secondary-container border border-secondary-container/30'
            }`}>
              {profile.role === 'driver' ? 'Водитель' : 'Пассажир'}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-2 mb-4">
          {profile.role === 'driver' && (
            <div className="glass-card px-3 py-2 rounded-xl flex items-center gap-2">
              <Star size={14} className="text-yellow-400 fill-yellow-400" />
              <span className="text-white font-semibold text-sm">{profile.rating.toFixed(1)}</span>
              <span className="text-white/50 text-xs">рейтинг</span>
            </div>
          )}
          <div className="glass-card px-3 py-2 rounded-xl flex items-center gap-2">
            <MapPin size={14} className="text-primary-container" />
            <span className="text-white font-semibold text-sm">{profile.trips_count}</span>
            <span className="text-white/50 text-xs">поездок</span>
          </div>
          <div className="glass-card px-3 py-2 rounded-xl flex items-center gap-2">
            <Calendar size={14} className="text-primary-container/70" />
            <span className="text-white/50 text-xs">с {memberSince}</span>
          </div>
        </div>

        {/* Contacts */}
        <div className="glass-panel rounded-2xl p-5 mb-4">
          <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-2 mb-3">
            <Shield size={13} />
            Контакты
          </h3>

          {!currentUserId ? (
            <div className="flex items-center gap-2 text-white/40 text-sm py-1">
              <LogIn size={14} />
              <span>Войдите, чтобы видеть контакты</span>
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/10">
              {/* Телефон, WhatsApp и MAX скрыты на время модерации Platega —
                  для связи доступен только Telegram. */}
              {telegramHandle !== null && (
                canSeeContact(profile.show_telegram) ? (
                  <ContactRow icon={<span className="text-[10px] font-bold leading-none">TG</span>} label="Telegram">
                    <a href={`https://t.me/${telegramHandle}`} target="_blank" rel="noopener noreferrer" className="text-[#00f0ff] hover:underline">
                      @{telegramHandle}
                    </a>
                  </ContactRow>
                ) : (
                  <HiddenContact label="Telegram" />
                )
              )}

              {!hasSharedRide && (
                <p className="text-white/30 text-xs pt-3">
                  Скрытые контакты откроются после совместной завершённой поездки
                </p>
              )}
            </div>
          )}
        </div>

        {/* Кнопка «Написать» убрана вместе с внутренним чатом (10.08.2026).
            Связь между участниками — через контакты, которые открываются
            после завершения аукциона. */}
        {!isOwnProfile && !currentUserId && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/login')}
            className="w-full btn-mesh py-3 rounded-xl font-semibold flex items-center justify-center gap-2 mb-6"
          >
            <LogIn size={18} />Войти для связи
          </motion.button>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {(['rides', 'reviews'] as UserProfileTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-primary-container/20 text-primary-container border border-primary-container/40'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {tab === 'rides' ? `Поездки (${rides.length})` : `Отзывы (${reviews.length})`}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'rides' && (
            <motion.div
              key="rides"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              {rides.length === 0 ? (
                <div className="glass-card rounded-2xl p-8 text-center text-white/40">Нет активных поездок</div>
              ) : (
                rides.map((ride) => (
                  <motion.div
                    key={ride.id}
                    whileHover={{ scale: 1.01 }}
                    onClick={() => navigate(`/trips/${ride.id}`)}
                    className="glass-card rounded-2xl p-4 cursor-pointer hover:border-primary-container/40 transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        ride.type === 'offer'
                          ? 'bg-primary-container/20 text-primary-container'
                          : 'bg-secondary-container/20 text-secondary-container'
                      }`}>
                        {ride.type === 'offer' ? 'Везу' : 'Еду'}
                      </span>
                      {ride.border_crossing && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">Граница</span>
                      )}
                      <span className="text-primary-container font-bold">{ride.current_price} ₽</span>
                    </div>
                    <div className="flex items-center gap-2 text-white font-medium">
                      <MapPin size={14} className="text-primary-container/70 flex-shrink-0" />
                      <span className="truncate">{ride.origin} → {ride.destination}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-white/50 text-sm">
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        {formatDate(ride.departure_date)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {ride.departure_time?.slice(0, 5)}
                      </span>
                    </div>
                  </motion.div>
                ))
              )}
            </motion.div>
          )}

          {activeTab === 'reviews' && (
            <motion.div
              key="reviews"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              {reviews.length === 0 ? (
                <div className="glass-card rounded-2xl p-8 text-center text-white/40">Пока нет отзывов</div>
              ) : (
                reviews.map((review) => (
                  <div key={review.id} className="glass-card rounded-2xl p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-container/30 to-secondary-container/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {review.reviewer?.avatar_url ? (
                          <img src={review.reviewer.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User size={16} className="text-primary-container" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{review.reviewer?.full_name ?? 'Аноним'}</p>
                        <div className="flex gap-0.5 mt-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} size={12} className={i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-white/20'} />
                          ))}
                        </div>
                      </div>
                      <span className="text-white/30 text-xs flex-shrink-0">{formatDate(review.created_at)}</span>
                    </div>
                    {review.comment && (
                      <p className="text-white/70 text-sm leading-relaxed">{review.comment}</p>
                    )}
                  </div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ContactRow({
  icon, label, children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 text-sm">
      <span className="text-primary-container w-5 flex-shrink-0 flex justify-center">{icon}</span>
      <span className="text-white/50 w-20 flex-shrink-0">{label}</span>
      <span className="text-white">{children}</span>
    </div>
  );
}

function HiddenContact({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 text-sm text-white/30">
      <Shield size={14} className="w-5 flex-shrink-0" />
      <span className="w-20 flex-shrink-0">{label}</span>
      <span>скрыто</span>
    </div>
  );
}
