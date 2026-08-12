import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { MapPin, Calendar, Clock, Zap, CheckCircle2, Car } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DatePicker } from '../components/ui/DatePicker';
import { TimePicker } from '../components/ui/TimePicker';
import { useToast } from '../context/ToastContext';
import { PUBLICATION_PRICE } from '../lib/publishRide';
import { parseISODate, plural, pluralSeats } from '../lib/utils';

const BID_STEPS = [50, 100, 150, 200];
const AUCTION_DURATIONS = [1, 3, 6, 12, 24];

const ABKHAZIA_CITIES = ['сухум', 'гагра', 'пицунда', 'новый афон', 'гудаута', 'очамчира', 'гал', 'ткварчели'];
const RUSSIA_CITIES = ['сочи', 'адлер', 'краснодар', 'москва', 'санкт-петербург', 'новороссийск', 'анапа'];

function detectBorderCrossing(origin: string, dest: string): boolean {
  const o = origin.toLowerCase().trim();
  const d = dest.toLowerCase().trim();
  const oAbkh = ABKHAZIA_CITIES.some(c => o.includes(c));
  const dAbkh = ABKHAZIA_CITIES.some(c => d.includes(c));
  const oRus = RUSSIA_CITIES.some(c => o.includes(c));
  const dRus = RUSSIA_CITIES.some(c => d.includes(c));
  return (oAbkh && dRus) || (oRus && dAbkh);
}

const AMENITIES = [
  { id: 'ac',        label: 'Кондиционер',     icon: '❄️' },
  { id: 'drinks',    label: 'Напитки',          icon: '🥤' },
  { id: 'music',     label: 'Ваша музыка',      icon: '🎵' },
  { id: 'wifi',      label: 'Wi-Fi',            icon: '📶' },
  { id: 'nosmoking', label: 'Некурящий',        icon: '🚭' },
  { id: 'luggage',   label: 'Место для багажа', icon: '🧳' },
];

interface Vehicle {
  id: string;
  make_model: string;
  license_plate: string;
  capacity: number;
  is_active?: boolean;
}

function auctionLabel(h: number): string {
  if (h === 1) return '1 час';
  if (h < 5) return `${h} часа`;
  return `${h} часов`;
}

export function CreateTrip() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [role, setRole] = useState<'passenger' | 'driver' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const TOTAL_STEPS = 4;

  const [formData, setFormData] = useState({
    origin: '',
    destination: '',
    date: '',
    time: '',
    seats: 1,
    price: '',
    comment: '',
    bid_step: 50,
    auction_duration: 6,
    vehicle_id: '',
    amenities: [] as string[],
  });

  const borderCrossing = detectBorderCrossing(formData.origin, formData.destination);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        setUserId(user.id);
        const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
        if (data) {
          setRole(data.role as 'passenger' | 'driver');
          if (data.role === 'driver') {
            const { data: vData } = await supabase
              .from('vehicles')
              .select('id, make_model, license_plate, capacity, is_active')
              .eq('driver_id', user.id);
            if (vData) {
              setVehicles(vData);
              const active = vData.find((v: any) => v.is_active);
              if (active) setFormData((prev) => ({ ...prev, vehicle_id: active.id }));
            }
          }
        }
      }
      setLoading(false);
    });
  }, []);

  const canGoNext = (): boolean => {
    if (currentStep === 1) return !!(
      formData.origin.trim() &&
      formData.destination.trim() &&
      formData.origin.trim().toLowerCase() !== formData.destination.trim().toLowerCase()
    );
    if (currentStep === 2) {
      if (!formData.date || !formData.time) return false;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return parseISODate(formData.date) >= today;
    }
    if (currentStep === 3) return !!(formData.price && parseFloat(formData.price) > 0);
    return true;
  };

  const handleNext = () => setCurrentStep(p => Math.min(p + 1, TOTAL_STEPS));
  const handlePrev = () => setCurrentStep(p => Math.max(p - 1, 1));

  function toggleAmenity(id: string) {
    setFormData(prev => ({
      ...prev,
      amenities: prev.amenities.includes(id)
        ? prev.amenities.filter(a => a !== id)
        : [...prev.amenities, id],
    }));
  }

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (!userId) throw new Error('Пользователь не авторизован');
      const isRequest = role === 'passenger';

      // status и auction_end_time здесь НЕ передаём — триггер БД force_ride_draft
      // принудительно ставит status='draft' и обнуляет auction_end_time.
      // Передаём auction_hours, чтобы таймер стартовал в момент публикации (после оплаты).
      const { data: ride, error } = await supabase
        .from('rides')
        .insert({
          creator_id: userId,
          type: isRequest ? 'request' : 'offer',
          origin: formData.origin,
          destination: formData.destination,
          departure_date: formData.date,
          departure_time: formData.time,
          seats: formData.seats,
          border_crossing: borderCrossing,
          comment: formData.comment || null,
          start_price: parseFloat(formData.price),
          current_price: parseFloat(formData.price),
          bid_step: formData.bid_step,
          auction_hours: formData.auction_duration,
          amenities: formData.amenities,
          ...(formData.vehicle_id ? { vehicle_id: formData.vehicle_id } : {}),
        })
        .select('id')
        .single();
      if (error) throw error;

      // Черновик создан. Ведём на страницу оплаты: там показаны условия
      // услуги (тариф, способ оплаты) и кнопка публикации. Пока ЮMoney
      // не подключена, публикация оттуда бесплатная — страница говорит
      // об этом прямо.
      navigate(`/payment?ride=${ride.id}`);
    } catch (error: any) {
      showToast('error', 'Ошибка создания', error.message || 'Не удалось создать поездку');
      setSubmitting(false);
    }
  };

  if (loading) return null;

  const formatDate = (d: string) => {
    if (!d) return '—';
    return parseISODate(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const selectedVehicle = vehicles.find((v) => v.id === formData.vehicle_id);

  return (
    <div className="max-w-2xl mx-auto pb-24 md:pb-0">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-2">Создать поездку</h1>
        <p className="text-on-surface-variant">
          {role === 'passenger' ? 'Создайте запрос — водители предложат лучшую цену' : 'Создайте предложение — пассажиры смогут выкупить места'}
        </p>
      </div>

      <div className="glass-panel p-8 rounded-3xl relative overflow-hidden">
        {/* Progress bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-surface-container-high">
          <motion.div
            className="h-full bg-gradient-to-r from-primary-container to-secondary-container"
            animate={{ width: `${(currentStep / TOTAL_STEPS) * 100}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 mb-8 mt-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i + 1 <= currentStep ? 'bg-primary-container w-8' : 'bg-outline-variant/30 w-4'}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* STEP 1 — Маршрут */}
          {currentStep === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <MapPin className="text-primary-container" /> Маршрут
              </h2>

              <div className="space-y-4 relative">
                <div className="absolute left-6 top-8 bottom-[3.5rem] w-0.5 bg-outline-variant/30 z-0" />

                <div className="space-y-1 relative z-10">
                  <label htmlFor="trip-origin" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1">Пункт отправления</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none" aria-hidden="true">
                      <div className="w-4 h-4 rounded-full border-2 border-primary-container bg-surface flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-container" />
                      </div>
                    </div>
                    <input
                      id="trip-origin"
                      type="text"
                      value={formData.origin}
                      onChange={e => setFormData({ ...formData, origin: e.target.value })}
                      className="w-full pl-12 pr-4 py-4 rounded-2xl input-glass text-lg font-medium text-on-surface placeholder:text-outline transition-all"
                      placeholder="Например, Сухум"
                      autoComplete="off"
                      maxLength={100}
                    />
                  </div>
                </div>

                <div className="space-y-1 relative z-10">
                  <label htmlFor="trip-destination" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1">Пункт назначения</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none" aria-hidden="true">
                      <div className="w-4 h-4 rounded-full border-2 border-secondary-container bg-surface" />
                    </div>
                    <input
                      id="trip-destination"
                      type="text"
                      value={formData.destination}
                      onChange={e => setFormData({ ...formData, destination: e.target.value })}
                      className="w-full pl-12 pr-4 py-4 rounded-2xl input-glass text-lg font-medium text-on-surface placeholder:text-outline transition-all"
                      placeholder="Например, Сочи"
                      autoComplete="off"
                      maxLength={100}
                    />
                  </div>
                </div>
              </div>

              {/* Auto-detected border crossing badge */}
              <AnimatePresence>
                {borderCrossing && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#00e290]/10 border border-[#00e290]/30"
                  >
                    <CheckCircle2 size={16} className="text-[#00e290] shrink-0" />
                    <span className="text-sm text-[#00e290] font-medium">Маршрут включает пересечение границы Россия ↔ Абхазия</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* STEP 2 — Время и детали */}
          {currentStep === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Clock className="text-primary-container" /> Время и детали
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="trip-date" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1">Дата</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none z-10" aria-hidden="true">
                      <Calendar size={18} className="text-primary-container" />
                    </div>
                    <DatePicker id="trip-date" value={formData.date} onChange={d => setFormData({ ...formData, date: d })} placeholder="ДД.ММ.ГГГГ" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="trip-time" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1">Время</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none z-10" aria-hidden="true">
                      <Clock size={18} className="text-primary-container" />
                    </div>
                    <TimePicker id="trip-time" value={formData.time} onChange={t => setFormData({ ...formData, time: t })} placeholder="--:--" />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                {/*
                  Счётчик мест. Поля ввода здесь нет — только две кнопки и
                  число между ними, — поэтому подпись сделана обычным <span>,
                  а группа ссылается на неё через aria-labelledby.
                  role="status" на самом числе нужен, чтобы новое значение
                  проговаривалось вслух после нажатия: иначе незрячий человек
                  жмёт «плюс» и не получает никакого подтверждения, что что-то
                  изменилось. Символ «−» на кнопке — это математический минус,
                  скринридер читает его невнятно, поэтому у обеих кнопок стоит
                  словесная подпись, а сам знак скрыт через aria-hidden.
                */}
                <span id="trip-seats-label" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1 block">Количество мест</span>
                <div className="flex items-center gap-3" role="group" aria-labelledby="trip-seats-label">
                  <button
                    type="button"
                    aria-label="Убрать одно место"
                    onClick={() => setFormData({ ...formData, seats: Math.max(1, formData.seats - 1) })}
                    className="w-11 h-11 rounded-xl border border-outline-variant/40 bg-surface-container/30 hover:bg-surface-container/60 text-xl font-bold transition-all flex items-center justify-center"
                  ><span aria-hidden="true">−</span></button>
                  <div className="flex-1 text-center" role="status">
                    <span className="text-2xl font-bold">{formData.seats}</span>
                    <span className="text-sm text-on-surface-variant ml-2">{plural(formData.seats, 'место', 'места', 'мест')}</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Добавить одно место"
                    onClick={() => setFormData({ ...formData, seats: Math.min(8, formData.seats + 1) })}
                    className="w-11 h-11 rounded-xl border border-outline-variant/40 bg-surface-container/30 hover:bg-surface-container/60 text-xl font-bold transition-all flex items-center justify-center"
                  ><span aria-hidden="true">+</span></button>
                </div>
              </div>

              {/* Amenities (drivers only) */}
              {role === 'driver' && (
                <div className="space-y-2">
                  {/* Удобства — набор независимых переключателей «включено /
                      выключено», поэтому aria-pressed, а не radio: выбрать
                      можно сколько угодно сразу. Значок-эмодзи скрыт от
                      скринридера, иначе он читал бы его название вслух перед
                      каждой подписью. */}
                  <span id="trip-amenities-label" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1 block">Удобства в поездке</span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="group" aria-labelledby="trip-amenities-label">
                    {AMENITIES.map(a => {
                      const active = formData.amenities.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleAmenity(a.id)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                            active
                              ? 'border-[#00f0ff]/50 bg-[#00f0ff]/10 text-[#00f0ff]'
                              : 'border-outline-variant/30 bg-surface-container/20 text-on-surface-variant hover:bg-surface-container/40'
                          }`}
                        >
                          <span className="text-base leading-none" aria-hidden="true">{a.icon}</span>
                          {a.label}
                          {active && <CheckCircle2 size={13} className="ml-auto shrink-0" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="trip-comment" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1">Комментарий (необязательно)</label>
                <textarea
                  id="trip-comment"
                  value={formData.comment}
                  onChange={e => setFormData({ ...formData, comment: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-4 rounded-2xl input-glass font-medium text-on-surface placeholder:text-outline resize-none transition-all"
                  placeholder="Пожелания, особенности маршрута..."
                  maxLength={1000}
                />
              </div>
            </motion.div>
          )}

          {/* STEP 3 — Цена и аукцион */}
          {currentStep === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Zap className="text-primary-container" /> Цена и аукцион
              </h2>

              <div className="space-y-1">
                <label htmlFor="trip-price" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1">Стартовая цена (₽)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none" aria-hidden="true">
                    <span className="text-xl font-bold text-primary-container">₽</span>
                  </div>
                  <input
                    id="trip-price"
                    type="number"
                    value={formData.price}
                    onChange={e => setFormData({ ...formData, price: e.target.value })}
                    className="w-full pl-11 pr-4 py-4 rounded-2xl input-glass text-2xl font-bold text-primary-container placeholder:text-outline/50 transition-all"
                    placeholder="3500"
                  />
                </div>
                <p className="text-sm text-on-surface-variant mt-1 px-1">
                  {role === 'passenger' ? 'Водители будут предлагать меньше.' : 'Пассажиры могут предложить больше.'}
                </p>
              </div>

              <div className="space-y-2">
                {/* Готовые варианты шага — взаимоисключающие, поэтому
                    aria-pressed на каждой кнопке: скринридер сообщает, какая
                    сейчас выбрана. Поле «Свой» рядом — обычный ввод, ему нужна
                    собственная подпись; видимой подписи у него нет (в макете
                    только подсказка внутри поля), поэтому aria-label. */}
                <span id="trip-bidstep-label" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1 block">Минимальный шаг ставки</span>
                <div className="flex gap-2 flex-wrap" role="group" aria-labelledby="trip-bidstep-label">
                  {BID_STEPS.map(bs => (
                    <button key={bs} type="button" aria-pressed={formData.bid_step === bs} onClick={() => setFormData({ ...formData, bid_step: bs })}
                      className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${formData.bid_step === bs ? 'border-[#00f0ff]/70 text-[#00f0ff] bg-[#00f0ff]/15' : 'border-outline-variant/30 text-on-surface-variant hover:border-outline-variant/60'}`}>
                      {bs} ₽
                    </button>
                  ))}
                  <input
                    type="number" min="10"
                    aria-label="Свой шаг ставки в рублях"
                    value={BID_STEPS.includes(formData.bid_step) ? '' : formData.bid_step}
                    onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 10) setFormData({ ...formData, bid_step: v }); }}
                    placeholder="Свой"
                    className="flex-1 min-w-[80px] px-4 py-2 rounded-xl input-glass text-sm font-bold text-on-surface placeholder:text-outline/50"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <span id="trip-duration-label" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1 block">Длительность аукциона</span>
                <div className="flex gap-2 flex-wrap" role="group" aria-labelledby="trip-duration-label">
                  {AUCTION_DURATIONS.map(h => (
                    <button key={h} type="button" aria-pressed={formData.auction_duration === h} onClick={() => setFormData({ ...formData, auction_duration: h })}
                      className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${formData.auction_duration === h ? 'border-[#b47aff]/70 text-[#b47aff] bg-[#7701d0]/15' : 'border-outline-variant/30 text-on-surface-variant hover:border-outline-variant/60'}`}>
                      {auctionLabel(h)}
                    </button>
                  ))}
                </div>
              </div>

              {role === 'driver' && (
                <div className="space-y-2">
                  <span id="trip-vehicle-label" className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider pl-1 block">Автомобиль</span>
                  {vehicles.length > 0 ? (
                    <div className="space-y-2" role="group" aria-labelledby="trip-vehicle-label">
                      {vehicles.map(v => (
                        <button key={v.id} type="button"
                          aria-pressed={formData.vehicle_id === v.id}
                          onClick={() => setFormData({ ...formData, vehicle_id: v.id === formData.vehicle_id ? '' : v.id })}
                          className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all ${formData.vehicle_id === v.id ? 'border-[#00f0ff]/50 bg-[#00f0ff]/10' : 'border-outline-variant/30 bg-surface-container/30 hover:bg-surface-container/50'}`}>
                          <Car size={20} className={formData.vehicle_id === v.id ? 'text-[#00f0ff]' : 'text-outline'} />
                          <div className="text-left">
                            <div className="font-semibold flex items-center gap-2">
                              {v.make_model}
                              {v.is_active && (
                                <span className="px-1.5 py-0.5 rounded-full bg-[#00f0ff]/20 text-[#00f0ff] text-[10px] font-bold uppercase tracking-wider">
                                  Активное
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-on-surface-variant">{v.license_plate} · {pluralSeats(v.capacity)}</div>
                          </div>
                          {formData.vehicle_id === v.id && <CheckCircle2 size={18} className="text-[#00f0ff] ml-auto shrink-0" />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl border border-outline-variant/30 text-sm text-on-surface-variant">
                      У вас нет добавленных автомобилей.{' '}
                      <button type="button" onClick={() => navigate('/profile')} className="text-[#00f0ff] hover:underline">Добавить в профиле →</button>
                    </div>
                  )}
                </div>
              )}

            </motion.div>
          )}

          {/* STEP 4 — Превью */}
          {currentStep === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <CheckCircle2 className="text-[#00e290]" /> Проверьте перед публикацией
              </h2>

              <div className="glass-card rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="w-3 h-3 rounded-full bg-primary-container" />
                    <div className="w-0.5 h-8 bg-outline-variant/50" />
                    <div className="w-3 h-3 rounded-full bg-secondary-container" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="font-semibold">{formData.origin}</div>
                    <div className="font-semibold text-on-surface-variant">{formData.destination}</div>
                  </div>
                  {borderCrossing && (
                    <span className="px-2 py-1 rounded-lg bg-[#00e290]/15 border border-[#00e290]/40 text-[#00e290] text-xs font-bold shrink-0">Переезжаем границу</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-outline-variant/20">
                  <div>
                    <div className="text-xs text-on-surface-variant">Дата и время</div>
                    <div className="font-semibold text-sm">{formatDate(formData.date)}, {formData.time}</div>
                  </div>
                  <div>
                    <div className="text-xs text-on-surface-variant">Мест</div>
                    <div className="font-semibold text-sm">{formData.seats}</div>
                  </div>
                  <div>
                    <div className="text-xs text-on-surface-variant">Стартовая цена</div>
                    <div className="font-semibold text-sm text-primary-container">{parseFloat(formData.price || '0').toLocaleString('ru-RU')} ₽</div>
                  </div>
                  <div>
                    <div className="text-xs text-on-surface-variant">Шаг ставки</div>
                    <div className="font-semibold text-sm">{formData.bid_step} ₽</div>
                  </div>
                  <div>
                    <div className="text-xs text-on-surface-variant">Аукцион</div>
                    <div className="font-semibold text-sm">{auctionLabel(formData.auction_duration)}</div>
                  </div>
                  {selectedVehicle && (
                    <div>
                      <div className="text-xs text-on-surface-variant">Автомобиль</div>
                      <div className="font-semibold text-sm">{selectedVehicle.make_model}</div>
                    </div>
                  )}
                </div>

                {formData.amenities.length > 0 && (
                  <div className="pt-3 border-t border-outline-variant/20">
                    <div className="text-xs text-on-surface-variant mb-2">Удобства</div>
                    <div className="flex flex-wrap gap-2">
                      {formData.amenities.map(id => {
                        const a = AMENITIES.find(x => x.id === id);
                        return a ? (
                          <span key={id} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#00f0ff]/10 border border-[#00f0ff]/20 text-xs text-[#00f0ff]">
                            {a.icon} {a.label}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}

                {formData.comment && (
                  <div className="pt-3 border-t border-outline-variant/20">
                    <div className="text-xs text-on-surface-variant mb-1">Комментарий</div>
                    <div className="text-sm whitespace-pre-wrap">{formData.comment}</div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-between items-center mt-10 pt-6 border-t border-outline-variant/20">
          <button type="button" onClick={handlePrev} disabled={currentStep === 1}
            className={`px-6 py-3 rounded-xl font-medium transition-all ${currentStep === 1 ? 'opacity-0 pointer-events-none' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}`}>
            Назад
          </button>
          {currentStep < TOTAL_STEPS ? (
            <button type="button" onClick={handleNext} disabled={!canGoNext()}
              className="px-8 py-3 rounded-xl btn-mesh font-bold text-white disabled:opacity-50">
              Далее
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={submitting}
              className="px-8 py-3 rounded-xl btn-mesh font-bold text-white disabled:opacity-50 flex items-center gap-2 shadow-[0_0_24px_rgba(0,240,255,0.3)] hover:shadow-[0_0_32px_rgba(0,240,255,0.5)]">
              {submitting ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                /* Тариф показан зачёркнутым: он действует, но пока ЮMoney
                   подключается, размещение бесплатное. Далее — страница
                   с полными условиями услуги. */
                <span className="flex flex-col items-center leading-tight">
                  <span>Опубликовать поездку</span>
                  <span className="text-[10px] font-medium opacity-90">
                    <s>{PUBLICATION_PRICE} ₽</s> сейчас бесплатно
                  </span>
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
