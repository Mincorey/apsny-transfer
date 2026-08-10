import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Mail, Lock, Phone, User as UserIcon, ArrowRight, Shield, Route,
  Zap, TrendingUp, Map, Car, Star, CheckCircle, Clock, Users,
  MapPin, MessageCircle, ChevronRight, Menu, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Footer } from '../components/layout/Footer';
import { normalizeWaDigits, waDisplay } from '../lib/contacts';

function CounterValue({ value }: { value: string }) {
  const [displayValue, setDisplayValue] = useState('0');
  const numValue = parseInt(value) || 0;

  useEffect(() => {
    if (numValue === 0 || isNaN(numValue)) {
      setDisplayValue(value);
      return;
    }

    let current = 0;
    const duration = 1000;
    const start = Date.now();

    const animate = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      current = Math.floor(numValue * progress);
      setDisplayValue(current.toString());

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [numValue, value]);

  return <>{displayValue}{value.includes('+') ? '+' : ''}</>;
}

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  x: (i * 37 + 13) % 100,
  y: (i * 53 + 7) % 100,
  size: (i % 3) + 1.5,
  duration: 3 + (i % 4),
  delay: i * 0.35,
}));

const HOW_IT_WORKS = [
  {
    icon: UserIcon,
    colorClass: 'text-primary-fixed',
    bgClass: 'bg-primary-container/10',
    borderClass: 'border-primary-container/30',
    title: 'Выберите роль',
    desc: 'Вы пассажир или водитель? Создайте аккаунт и укажите роль — это определит ваши возможности на платформе.',
  },
  {
    icon: Route,
    colorClass: 'text-secondary-fixed',
    bgClass: 'bg-secondary-container/10',
    borderClass: 'border-secondary-container/30',
    title: 'Создайте поездку',
    desc: 'Укажите маршрут, дату, количество мест и стартовую цену. Пассажиры публикуют запросы, водители — предложения.',
  },
  {
    icon: Zap,
    colorClass: 'text-tertiary-fixed-dim',
    bgClass: 'bg-tertiary-container/10',
    borderClass: 'border-tertiary-container/30',
    title: 'Аукцион начался',
    desc: 'Водители делают ставки на пассажирские запросы. Выбирайте лучшее предложение по цене и рейтингу.',
  },
  {
    icon: CheckCircle,
    colorClass: 'text-primary-container',
    bgClass: 'bg-primary-container/10',
    borderClass: 'border-primary-container/30',
    title: 'В путь!',
    desc: 'Победитель аукциона получает контакты другой стороны. Всё прозрачно и безопасно.',
  },
];

const POPULAR_ROUTES = [
  { from: 'Сочи, Аэропорт', to: 'Сухум' },
  { from: 'Гагра', to: 'Сухум, Аэропорт' },
  { from: 'Сухум', to: 'Сочи, МореМолл' },
  { from: 'Гагра', to: 'Сухум' },
];

const DEFAULT_STATS = [
  { value: '—', label: 'Поездок завершено', icon: Route },
  { value: '—', label: 'Пользователей', icon: Users },
  { value: '—', label: 'Городов', icon: MapPin },
  { value: '—', label: 'Средний рейтинг', icon: Star },
];

// Кэш статистики лендинга: показываем мгновенно из localStorage, обновляем по сети
// не чаще раза в час. Снимает 4 агрегатных запроса с каждого анонимного захода.
const STATS_CACHE_KEY = 'apsny_landing_stats_v1';
const STATS_TTL_MS = 60 * 60 * 1000; // 1 час

type StatsRaw = { completedCount: number; userCount: number; cityCount: number; avgRating: string };

function buildStats(r: StatsRaw) {
  return [
    { value: `${r.completedCount}+`, label: 'Поездок завершено', icon: Route },
    { value: `${r.userCount}+`, label: 'Пользователей', icon: Users },
    { value: r.cityCount > 0 ? r.cityCount.toString() : '—', label: 'Городов', icon: MapPin },
    { value: r.avgRating, label: 'Средний рейтинг', icon: Star },
  ];
}

function applyPhoneMask(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const normalized = digits[0] === '8' || digits[0] === '7'
    ? '7' + digits.slice(1)
    : '7' + digits;
  const d = normalized.slice(0, 11);
  let result = '+7';
  if (d.length <= 1) return result;
  result += ' (' + d.slice(1, Math.min(d.length, 4));
  if (d.length <= 4) return result;
  result += ') ' + d.slice(4, Math.min(d.length, 7));
  if (d.length <= 7) return result;
  result += '-' + d.slice(7, Math.min(d.length, 9));
  if (d.length <= 9) return result;
  result += '-' + d.slice(9, 11);
  return result;
}

function applyTelegramMask(raw: string): string {
  if (!raw) return '';
  const stripped = raw.replace(/@/g, '').trim();
  return stripped ? '@' + stripped : '';
}

export function Auth() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [telegram, setTelegram] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [role, setRole] = useState<'passenger' | 'driver'>('passenger');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [stats, setStats] = useState(DEFAULT_STATS);

  const authRef = useRef<HTMLDivElement>(null);

  const fetchStats = async () => {
    try {
      const [completedRes, usersRes, ridesRes, ratingRes] = await Promise.all([
        supabase.from('rides').select('id', { count: 'exact' }).eq('status', 'completed'),
        supabase.from('users').select('id', { count: 'exact' }),
        supabase.from('rides').select('destination'),
        supabase.from('users').select('rating').gt('rating', 0),
      ]);

      const completedCount = completedRes.count || 0;
      const userCount = usersRes.count || 0;
      const cities = new Set(ridesRes.data?.map(r => r.destination) || []);
      const cityCount = cities.size;

      const ratings = ratingRes.data?.map((u: { rating: number }) => Number(u.rating)) ?? [];
      const avgRating = ratings.length > 0
        ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
        : '—';

      const raw: StatsRaw = { completedCount, userCount, cityCount, avgRating };
      setStats(buildStats(raw));
      try {
        localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ ts: Date.now(), raw }));
      } catch { /* localStorage недоступен — не критично */ }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to fetch stats:', err);
      // Не сбрасываем на DEFAULT: на экране уже либо кэш, либо стартовые значения.
    }
  };

  useEffect(() => {
    // Сначала показываем статистику из кэша (мгновенно, без «прочерков»),
    // по сети обновляем только если кэша нет или он устарел (> 1 часа).
    let cached: { ts: number; raw: StatsRaw } | null = null;
    try {
      const stored = localStorage.getItem(STATS_CACHE_KEY);
      if (stored) cached = JSON.parse(stored);
    } catch { /* игнорируем */ }

    if (cached?.raw) {
      setStats(buildStats(cached.raw));
      if (Date.now() - cached.ts > STATS_TTL_MS) fetchStats();
    } else {
      fetchStats();
    }
  }, []);

  const scrollToAuth = () => {
    setMobileMenuOpen(false);
    // Кнопки «Я ЕДУ»/«Я ВЕЗУ» сначала переключают форму в режим регистрации
    // (setIsLogin(false) добавляет поля), из-за чего раскладка меняется уже после
    // клика. Поэтому скролл откладываем на следующий кадр + небольшую паузу —
    // иначе первый клик скроллит по старой высоте и визуально «не срабатывает».
    requestAnimationFrame(() => {
      setTimeout(() => {
        authRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              phone,
              role,
              telegram: telegram ? telegram.replace('@', '') : null,
              whatsapp: whatsapp || null,
            },
          },
        });
        if (error) throw error;

        // Профиль создаётся БД-триггером handle_new_user из метаданных выше —
        // надёжно при любой настройке подтверждения email. Этот insert оставлен
        // необязательным «fallback» на случай, если триггер не отработал: если
        // сессия уже есть (подтверждение email выключено), он создаст профиль.
        // Его ошибка НЕ срывает регистрацию.
        //
        // Здесь именно insert, а не upsert. Колонки email, role, rating и
        // trips_count закрыты от прямой записи клиентом (см. миграцию
        // 20260810_fix_1_2_users_update_grants.sql — защита от накрутки рейтинга),
        // а upsert разворачивается в INSERT ... ON CONFLICT DO UPDATE и требует
        // прав UPDATE на все перечисленные колонки — то есть падал бы всегда.
        // Обновлять уже существующий профиль при регистрации и не требуется:
        // если он есть, insert вернёт ошибку дубликата ключа, и она проглатывается.
        if (data.user) {
          const { error: insertError } = await supabase.from('users').insert({
            id: data.user.id,
            email: data.user.email,
            full_name: fullName,
            phone,
            role,
            telegram: telegram ? telegram.replace('@', '') : null,
            whatsapp: whatsapp || null,
          });
          if (insertError) {
            if (import.meta.env.DEV) console.warn('Профиль уже создан триггером; клиентский insert пропущен:', insertError.message);
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка при авторизации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-background text-on-surface overflow-x-hidden selection:bg-primary-container selection:text-on-primary-container min-h-screen">

      {/* Header */}
      <header className="fixed top-0 w-full z-50 flex justify-center items-center px-6 md:px-12 h-20 bg-surface/80 backdrop-blur-2xl shadow-[0_8px_32px_0_rgba(0,219,233,0.15)] transition-all">
        <div className="w-full max-w-7xl flex justify-between items-center">
          <div className="flex items-center gap-2">
            <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
            <span className="font-display text-xl font-bold text-primary-fixed-dim tracking-tight">APSNY-TRANSFER</span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-3">
          <button
            onClick={() => { setIsLogin(false); setRole('passenger'); scrollToAuth(); }}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold uppercase tracking-widest transition-all duration-200 border border-[#00f0ff]/40 text-[#00f0ff] bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 hover:border-[#00f0ff]/80 hover:shadow-[0_0_16px_rgba(0,240,255,0.3)]"
          >
            <UserIcon size={15} />
            Я ЕДУ
          </button>
          <button
            onClick={() => { setIsLogin(false); setRole('driver'); scrollToAuth(); }}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold uppercase tracking-widest transition-all duration-200 border border-[#7701d0]/50 text-[#b47aff] bg-[#7701d0]/10 hover:bg-[#7701d0]/20 hover:border-[#7701d0]/90 hover:shadow-[0_0_16px_rgba(119,1,208,0.4)]"
          >
            <Car size={15} />
            Я ВЕЗУ
          </button>
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={scrollToAuth}
            className="hidden md:block px-6 py-2.5 rounded-lg bg-surface-container hover:bg-white/10 text-on-surface font-semibold transition-colors border border-white/10"
          >
            Войти
          </button>
          {/* Hamburger (mobile) */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-white/5 transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Открыть меню"
          >
            <AnimatePresence mode="wait" initial={false}>
              {mobileMenuOpen ? (
                <motion.span
                  key="x"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ display: 'block' }}
                >
                  <X size={24} />
                </motion.span>
              ) : (
                <motion.span
                  key="menu"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ display: 'block' }}
                >
                  <Menu size={24} />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
            className="fixed top-20 left-0 w-full z-40 bg-surface/95 backdrop-blur-2xl border-b border-white/10 flex flex-col px-6 py-4 gap-1 md:hidden shadow-2xl"
          >
            <button
              onClick={() => { setIsLogin(false); setRole('passenger'); scrollToAuth(); setMobileMenuOpen(false); }}
              className="flex items-center gap-3 py-3 px-4 font-bold uppercase tracking-widest rounded-xl transition-all border border-[#00f0ff]/40 text-[#00f0ff] bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20"
            >
              <UserIcon size={18} />
              Я ЕДУ — Пассажир
            </button>
            <button
              onClick={() => { setIsLogin(false); setRole('driver'); scrollToAuth(); setMobileMenuOpen(false); }}
              className="flex items-center gap-3 py-3 px-4 font-bold uppercase tracking-widest rounded-xl transition-all border border-[#7701d0]/50 text-[#b47aff] bg-[#7701d0]/10 hover:bg-[#7701d0]/20"
            >
              <Car size={18} />
              Я ВЕЗУ — Водитель
            </button>
            <div className="border-t border-white/10 my-2" />
            <button
              onClick={scrollToAuth}
              className="py-3 px-4 text-left font-semibold text-on-surface-variant rounded-xl hover:bg-white/5 transition-colors"
            >
              Войти в аккаунт
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center pt-20 px-6 md:px-16 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background z-10"></div>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary-container/10 via-transparent to-transparent z-10"></div>
          <div className="absolute inset-0 w-full h-full bg-[url('https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=3283&auto=format&fit=crop')] bg-cover bg-center opacity-10"></div>

          {/* Animated particles */}
          {PARTICLES.map((p) => (
            <motion.div
              key={p.id}
              className="absolute rounded-full bg-primary-fixed z-10 pointer-events-none"
              style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size * 2, height: p.size * 2 }}
              animate={{ y: [0, -28, 0], opacity: [0.12, 0.5, 0.12] }}
              transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
            />
          ))}

          {/* Animated SVG route lines */}
          <svg
            className="absolute inset-0 w-full h-full z-10 opacity-[0.07] pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <motion.path
              d="M 0 65 Q 25 25 55 50 T 100 35"
              stroke="#00f0ff"
              strokeWidth="0.3"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 4, repeat: Infinity, repeatType: 'loop', ease: 'linear', repeatDelay: 1 }}
            />
            <motion.path
              d="M 0 80 Q 35 40 65 60 T 100 25"
              stroke="#7701d0"
              strokeWidth="0.3"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 5, repeat: Infinity, repeatType: 'loop', ease: 'linear', repeatDelay: 0.5, delay: 1.5 }}
            />
            <motion.path
              d="M 10 40 Q 45 10 70 45 T 95 70"
              stroke="#00e290"
              strokeWidth="0.2"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 6, repeat: Infinity, repeatType: 'loop', ease: 'linear', repeatDelay: 0.8, delay: 3 }}
            />
          </svg>
        </div>

        <div className="relative z-10 w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center pt-10">
          <div className="lg:col-span-7 flex flex-col items-start gap-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card border-primary/30 text-primary-fixed-dim text-xs font-semibold uppercase tracking-widest"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-fixed opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-fixed"></span>
              </span>
              Активные аукционы
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-5xl md:text-7xl font-display font-bold leading-tight"
            >
              Динамические трансферы <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-fixed to-secondary-fixed">
                по вашей цене.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-lg text-on-surface-variant max-w-2xl leading-relaxed"
            >
              Ультрасовременная платформа междугородней логистики. Делайте ставки на премиальные маршруты, монетизируйте пустые обратные рейсы и ощутите истинную эффективность транспорта через прозрачные аукционы.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-wrap items-center gap-4 mt-4"
            >
              <button
                onClick={() => { setIsLogin(false); setRole('passenger'); scrollToAuth(); }}
                className="px-8 py-4 rounded-xl bg-gradient-to-r from-primary-container to-surface-tint text-on-primary-container font-bold hover:shadow-[0_0_30px_rgba(0,240,255,0.4)] transition-all duration-300 active:scale-95 flex items-center gap-2"
              >
                Я ЕДУ
                <ArrowRight size={20} />
              </button>
              <button
                onClick={() => { setIsLogin(false); setRole('driver'); scrollToAuth(); }}
                className="px-8 py-4 rounded-xl glass-card hover:bg-white/10 text-on-surface font-bold transition-all duration-300 active:scale-95 border border-white/20 flex items-center gap-2"
              >
                <Car size={20} />
                Я ВЕЗУ
              </button>
              <button
                onClick={() => navigate('/rides/passenger')}
                className="px-6 py-3 text-sm text-on-surface-variant hover:text-primary-fixed-dim font-medium transition-colors flex items-center gap-1.5 hover:underline underline-offset-4"
              >
                Смотреть поездки
                <ChevronRight size={15} />
              </button>
            </motion.div>
          </div>

          <div className="lg:col-span-5 relative perspective-1000 hidden md:block">
            <div className="absolute -inset-4 bg-primary-container/20 blur-3xl rounded-full z-0"></div>
            <div className="relative z-10 glass-panel rounded-2xl p-8 glow-primary transform rotate-y-[-10deg] rotate-x-[5deg] hover:rotate-0 transition-transform duration-700 flex flex-col gap-6 border border-white/10">
              <div className="flex justify-between items-center border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-surface-container-high flex items-center justify-center border border-white/10">
                    <Route className="text-primary-fixed-dim" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Сухум → Сочи</h3>
                    <p className="text-xs text-on-surface-variant uppercase tracking-widest mt-1">Экспресс маршрут</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-tertiary-fixed-dim animate-pulse font-mono tracking-widest">00:45 СЕК</p>
                </div>
              </div>

              <div className="bg-surface-container-low/50 rounded-xl p-5 border border-white/5">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-sm text-on-surface-variant">Текущая ставка</span>
                  <span className="text-3xl font-display font-bold text-primary">3 500 ₽</span>
                </div>
                <div className="relative h-2 bg-surface-container-highest rounded-full mt-6">
                  <div className="absolute left-0 top-0 h-full w-[65%] bg-gradient-to-r from-primary-fixed-dim/20 to-primary-container rounded-full"></div>
                  <div className="absolute left-[65%] top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-[0_0_10px_#00f0ff]"></div>
                </div>
                <div className="flex justify-between mt-3 text-xs text-outline font-mono">
                  <span>Старт: 2000 ₽</span>
                  <span>Прямой: 5000 ₽</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 px-6 md:px-16">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6 }}
            className="mb-16 text-center max-w-3xl mx-auto"
          >
            <h2 className="text-4xl font-display font-bold mb-6">Как это работает</h2>
            <p className="text-lg text-on-surface-variant">Четыре шага от регистрации до успешной поездки</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.5, delay: i * 0.12 }}
                className={`relative glass-panel rounded-3xl p-8 border ${step.borderClass} hover:scale-[1.02] transition-transform duration-300`}
              >
                <div className={`text-5xl font-display font-bold ${step.colorClass} opacity-25 absolute top-5 right-6 select-none`}>
                  {i + 1}
                </div>
                <div className={`w-14 h-14 rounded-2xl ${step.bgClass} border ${step.borderClass} flex items-center justify-center mb-6`}>
                  <step.icon className={`${step.colorClass} w-7 h-7`} />
                </div>
                <h3 className="text-lg font-bold mb-3">{step.title}</h3>
                <p className="text-on-surface-variant text-sm leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Popular Routes */}
      <section className="py-24 px-6 md:px-16 bg-surface-container-lowest/50 border-y border-white/5">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-16 text-center max-w-3xl mx-auto"
          >
            <h2 className="text-4xl font-display font-bold mb-6">Популярные маршруты</h2>
            <p className="text-lg text-on-surface-variant">Самые востребованные направления между Абхазией и Россией</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {POPULAR_ROUTES.map((route, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.96 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.4, delay: i * 0.07 }}
                className="glass-panel rounded-2xl p-6 border border-white/10"
              >
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary-fixed flex-shrink-0"></div>
                  <span className="font-bold text-on-surface">{route.from}</span>
                  <ArrowRight size={16} className="text-primary-fixed-dim flex-shrink-0" />
                  <span className="font-bold text-on-surface">{route.to}</span>
                  <div className="w-2.5 h-2.5 rounded-full bg-secondary-fixed flex-shrink-0"></div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Intelligence Meets Motion */}
      <section className="py-24 px-6 md:px-16 max-w-7xl mx-auto">
        <div className="mb-16 text-center max-w-3xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-4xl font-display font-bold mb-6"
          >
            Интеллект в движении
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-lg text-on-surface-variant"
          >
            Наша система аукционов находит идеальное равновесие между спросом и предложением.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 auto-rows-[minmax(300px,_auto)]">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="md:col-span-8 glass-panel rounded-3xl p-10 relative overflow-hidden group hover:bg-surface-container-high/40 transition-colors duration-500"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-secondary-container/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 group-hover:bg-secondary-container/20 transition-all duration-700"></div>
            <UserIcon className="text-secondary-fixed w-10 h-10 mb-6" />
            <h3 className="text-2xl font-bold mb-4">Для пассажиров: устанавливайте свою цену</h3>
            <p className="text-lg text-on-surface-variant max-w-xl">
              Хватит платить по наценкам. Предложите свою идеальную цену за маршрут. Водители согласятся на ваше предложение, гарантируя премиальную поездку по справедливой рыночной цене.
            </p>
            <div className="mt-8 flex gap-4">
              <div className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs uppercase tracking-widest font-semibold">Прозрачно</div>
              <div className="px-4 py-2 rounded-lg bg-secondary-container text-on-secondary-container text-xs uppercase tracking-widest font-semibold">Рыночный подход</div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="md:col-span-4 glass-panel rounded-3xl p-10 relative overflow-hidden group hover:bg-surface-container-high/40 transition-colors duration-500"
          >
            <div className="absolute bottom-0 right-0 w-48 h-48 bg-primary-container/10 rounded-full blur-3xl translate-y-1/4 translate-x-1/4 group-hover:bg-primary-container/20 transition-all duration-700"></div>
            <Shield className="text-primary-fixed w-10 h-10 mb-6" />
            <h3 className="text-2xl font-bold mb-4">Водителям: ноль пустых пробегов</h3>
            <p className="text-on-surface-variant">
              Превращайте пустые километры в прибыль. Просматривайте активные запросы пассажиров и мгновенно делайте ставки.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="md:col-span-5 glass-panel rounded-3xl p-10 flex flex-col justify-between overflow-hidden relative"
          >
            <div>
              <TrendingUp className="text-tertiary-fixed-dim w-10 h-10 mb-6" />
              <h3 className="text-xl font-bold mb-3">Аналитика в реальном времени</h3>
              <p className="text-on-surface-variant">Оценка глубины рынка и модели ценообразования на основе исторических данных о маршрутах.</p>
            </div>
            <div className="mt-8 relative h-32 w-full flex items-end justify-between px-4">
              <div className="w-[12%] bg-tertiary-fixed-dim/20 rounded-t-md h-[30%]"></div>
              <div className="w-[12%] bg-tertiary-fixed-dim/40 rounded-t-md h-[60%]"></div>
              <div className="w-[12%] bg-tertiary-fixed-dim/20 rounded-t-md h-[40%]"></div>
              <div className="w-[12%] bg-tertiary-fixed-dim/80 rounded-t-md h-[90%] shadow-[0_0_20px_rgba(0,226,144,0.4)]"></div>
              <div className="absolute bottom-0 left-0 w-full h-[1px] bg-tertiary-fixed-dim/40"></div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="md:col-span-7 glass-panel rounded-3xl relative overflow-hidden min-h-[300px]"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-surface to-surface-container opacity-90 z-10"></div>
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdHRlcm4geD0iMCIgeT0iMCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSJub25lIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiIHN0cm9rZS13aWR0aD0iMSI+PHBhdGggZD0iTTAgNDBMNDAgNDBMMDAgMCIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-50 z-10"></div>
            <div className="relative z-20 p-10 h-full flex flex-col justify-center">
              <Map className="text-secondary-fixed w-10 h-10 mb-6" />
              <h3 className="text-3xl font-bold mb-4">Междугородняя сеть</h3>
              <p className="text-lg text-on-surface-variant max-w-md">
                В настоящее время работаем на основных маршрутах с ежемесячным запуском новых зон покрытия.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-24 px-6 md:px-16">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="glass-panel rounded-3xl p-12 md:p-16 border border-white/10 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary-container/5 via-transparent to-transparent pointer-events-none"></div>
            <h2 className="text-3xl font-display font-bold text-center mb-12">Платформа в цифрах</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="text-center"
                >
                  <stat.icon className="w-8 h-8 text-primary-fixed-dim mx-auto mb-4 opacity-70" />
                  <div className="text-4xl md:text-5xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-fixed to-secondary-fixed mb-2">
                    <CounterValue value={stat.value} />
                  </div>
                  <div className="text-sm text-on-surface-variant">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Auth Form */}
      <section ref={authRef} className="py-24 px-4 flex justify-center items-center relative overflow-hidden border-t border-white/5 bg-surface-container-lowest/50">
        <div className="absolute top-1/2 left-1/4 w-96 h-96 bg-primary-container/10 rounded-full blur-[120px] pointer-events-none -translate-y-1/2"></div>
        <div className="absolute top-1/2 right-1/4 w-96 h-96 bg-secondary-container/10 rounded-full blur-[120px] pointer-events-none -translate-y-1/2"></div>

        <div className="w-full max-w-lg z-10">
          <div className="text-center mb-10">
            <h2 className="text-4xl font-display font-bold mb-3">
              {isLogin ? 'С возвращением!' : 'Инициализация профиля'}
            </h2>
            <p className="text-on-surface-variant text-lg">
              {isLogin ? 'Войдите, чтобы продолжить работу с платформой' : 'Присоединяйтесь к ультрасовременной логистической сети'}
            </p>
          </div>

          <motion.div
            className="glass-panel p-8 md:p-10 rounded-3xl border border-white/10 glow-primary bg-surface/60"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-error/10 border border-error/30 text-error text-sm font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <AnimatePresence mode="popLayout">
                {!isLogin && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-6"
                  >
                    {/* Role selection */}
                    <div className="space-y-4">
                      <label className="text-xs font-semibold text-primary uppercase tracking-widest pl-1 border-b border-white/10 pb-2 block">Роль</label>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          type="button"
                          onClick={() => setRole('passenger')}
                          className={`p-4 flex flex-col items-center gap-3 rounded-2xl border transition-all duration-300 ${
                            role === 'passenger'
                              ? 'border-primary-container bg-primary-container/10 text-primary-container shadow-[0_0_20px_rgba(0,240,255,0.15)]'
                              : 'border-white/10 text-on-surface-variant hover:bg-white/5 hover:border-white/20'
                          }`}
                        >
                          <UserIcon size={24} />
                          <span className="font-bold text-sm uppercase tracking-wider">Пассажир</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRole('driver')}
                          className={`p-4 flex flex-col items-center gap-3 rounded-2xl border transition-all duration-300 ${
                            role === 'driver'
                              ? 'border-primary-container bg-primary-container/10 text-primary-container shadow-[0_0_20px_rgba(0,240,255,0.15)]'
                              : 'border-white/10 text-on-surface-variant hover:bg-white/5 hover:border-white/20'
                          }`}
                        >
                          <Car size={24} />
                          <span className="font-bold text-sm uppercase tracking-wider">Водитель</span>
                        </button>
                      </div>
                    </div>

                    {/* Full name */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-widest pl-1">ФИО</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <UserIcon size={20} className="text-outline" />
                        </div>
                        <input
                          type="text"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          className="w-full pl-12 pr-4 py-3.5 rounded-xl input-glass text-on-surface placeholder:text-outline font-medium transition-all"
                          placeholder="Иван Иванов"
                          required={!isLogin}
                        />
                      </div>
                    </div>

                    {/* Phone */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-widest pl-1">Телефон</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <Phone size={20} className="text-outline" />
                        </div>
                        <input
                          type="tel"
                          inputMode="tel"
                          value={phone}
                          onChange={(e) => setPhone(applyPhoneMask(e.target.value))}
                          className="w-full pl-12 pr-4 py-3.5 rounded-xl input-glass text-on-surface placeholder:text-outline font-medium transition-all"
                          placeholder="+7 (900) 000-00-00"
                          required={!isLogin}
                        />
                      </div>
                    </div>

                    {/* Telegram */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-widest pl-1">
                        Telegram{' '}
                        <span className="text-outline normal-case tracking-normal font-normal">— необязательно</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <MessageCircle size={20} className="text-outline" />
                        </div>
                        <input
                          type="text"
                          value={telegram}
                          onChange={(e) => setTelegram(applyTelegramMask(e.target.value))}
                          className="w-full pl-12 pr-4 py-3.5 rounded-xl input-glass text-on-surface placeholder:text-outline font-medium transition-all"
                          placeholder="@username"
                        />
                      </div>
                    </div>

                    {/* WhatsApp */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-widest pl-1">
                        WhatsApp{' '}
                        <span className="text-outline normal-case tracking-normal font-normal">— необязательно</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <Phone size={20} className="text-outline" />
                        </div>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={waDisplay(whatsapp)}
                          onChange={(e) => setWhatsapp(normalizeWaDigits(e.target.value))}
                          className="w-full pl-12 pr-4 py-3.5 rounded-xl input-glass text-on-surface placeholder:text-outline font-medium transition-all"
                          placeholder="wa.me/7XXXXXXXXXX"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Email */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-widest pl-1">Email</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Mail size={20} className="text-outline" />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 rounded-xl input-glass text-on-surface placeholder:text-outline font-medium transition-all"
                    placeholder="почта@network.com"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-widest pl-1">Ключ доступа (Пароль)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock size={20} className="text-outline" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 rounded-xl input-glass text-on-surface placeholder:text-outline font-medium transition-all"
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 mt-6 rounded-xl btn-mesh font-bold text-white flex items-center justify-center gap-2 text-lg"
              >
                {loading ? (
                  <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  isLogin ? 'Авторизация' : 'Зарегистрироваться'
                )}
              </button>
            </form>

            <div className="mt-8 text-center pt-6 border-t border-white/5">
              <p className="text-on-surface-variant mb-2 text-sm">
                {isLogin ? 'Нет аккаунта в сети?' : 'Уже зарегистрированы?'}
              </p>
              <button
                onClick={() => { setIsLogin(!isLogin); setError(null); }}
                className="text-primary-container hover:text-primary transition-colors font-bold uppercase tracking-widest text-sm"
              >
                {isLogin ? 'Создать профиль' : 'ВОЙТИ'}
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
