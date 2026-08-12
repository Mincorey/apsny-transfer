import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { compressImage } from '../lib/imageOptimization';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import {
  User, Phone, Mail, Car, Plus, LogOut, Star, Camera,
  Edit2, Check, X, MapPin, Shield, MessageSquare, ChevronRight,
  Trash2, ImageOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LogoutModal } from '../components/layout/Sidebar';
import { Modal } from '../components/ui/Modal';
import { normalizeWaDigits, waDisplay } from '../lib/contacts';
import { formatPhone, pluralSeats, pluralTrips } from '../lib/utils';
import { DriverLeaderboard } from '../components/ui/DriverLeaderboard';

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: 'passenger' | 'driver';
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

interface Vehicle {
  id: string;
  make_model: string;
  license_plate: string;
  capacity: number;
  photo_url: string | null;
  is_active: boolean;
}

const MAX_VEHICLES = 3;

// Извлекает путь объекта внутри бакета avatars из публичного URL,
// чтобы можно было удалить старое фото из хранилища.
function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = '/avatars/';
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length).split('?')[0] ?? null;
}

interface MyRide {
  id: string;
  type: 'request' | 'offer';
  origin: string;
  destination: string;
  departure_date: string;
  current_price: number;
  status: string;
}

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: { full_name: string; avatar_url: string | null } | null;
}

type ProfileTab = 'profile' | 'trips' | 'reviews' | 'vehicles' | 'ratings';
type RideStatus = 'active' | 'completed' | 'cancelled';

function applyTelegramMask(raw: string): string {
  if (!raw) return '';
  const stripped = raw.replace(/@/g, '').trim();
  return stripped ? '@' + stripped : '';
}

function applyMaxMask(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits ? '+' + digits : '';
}

export function Profile() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vehiclePhotoRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [myRides, setMyRides] = useState<MyRide[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile');
  const [ridesTab, setRidesTab] = useState<RideStatus>('active');

  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({ full_name: '', telegram: '', whatsapp: '', max: '' });
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [newVehicle, setNewVehicle] = useState({
    make_model: '', license_plate: '', capacity: 4,
  });
  const [vehiclePhotoFile, setVehiclePhotoFile] = useState<File | null>(null);
  const [vehiclePhotoPreview, setVehiclePhotoPreview] = useState<string | null>(null);

  // Управление существующими авто
  const editPhotoRef = useRef<HTMLInputElement>(null);
  const [editPhotoVehicleId, setEditPhotoVehicleId] = useState<string | null>(null);
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);
  const [activeBusyId, setActiveBusyId] = useState<string | null>(null);
  const [deleteVehicle, setDeleteVehicle] = useState<Vehicle | null>(null);
  const [removePhotoVehicle, setRemovePhotoVehicle] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState(false);
  const atVehicleLimit = vehicles.length >= MAX_VEHICLES;

  const fetchAll = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Контакты (phone/telegram/whatsapp/max/email) недоступны для прямого
      // чтения с клиента (P1) — собственный профиль берём через RPC.
      const { data: profileData } = await supabase.rpc('get_my_profile');

      if (profileData) {
        setProfile(profileData);
        setEditData({
          full_name: profileData.full_name,
          telegram: profileData.telegram ? applyTelegramMask(profileData.telegram) : '',
          whatsapp: profileData.whatsapp ? profileData.whatsapp.replace(/\D/g, '') : '',
          max: profileData.max ? profileData.max.replace(/\D/g, '') : '',
        });

        const ridesPromise = supabase
          .from('rides')
          .select('id, type, origin, destination, departure_date, current_price, status')
          .eq('creator_id', user.id)
          .order('created_at', { ascending: false });

        if (profileData.role === 'driver') {
          const [{ data: vData }, { data: reviewsData }, { data: ridesData }] = await Promise.all([
            supabase.from('vehicles').select('*').eq('driver_id', user.id),
            supabase
              .from('reviews')
              .select('id, rating, comment, created_at, reviewer:users!reviewer_id(full_name, avatar_url)')
              .eq('target_id', user.id)
              .order('created_at', { ascending: false }),
            ridesPromise,
          ]);
          if (vData) setVehicles(vData);
          if (reviewsData) setReviews(reviewsData as unknown as Review[]);
          if (ridesData) setMyRides(ridesData);
        } else {
          const { data: ridesData } = await ridesPromise;
          if (ridesData) setMyRides(ridesData);
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  // Эффект стоит ПОСЛЕ объявления fetchAll намеренно. fetchAll — это const,
  // то есть до этой строки переменная в «мёртвой зоне»: сейчас всё работает
  // только потому, что эффект выполняется после первого рендера. Линтер
  // (react-hooks/immutability) на такое обращение ругается справедливо.
  useEffect(() => {
    fetchAll();
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', 'Файл слишком большой', 'Максимальный размер аватара — 5 МБ');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setAvatarUploading(true);
    try {
      const compressed = await compressImage(file, { maxSize: 512, quality: 0.8 });
      const ext = compressed.type === 'image/jpeg' ? 'jpg' : (compressed.name.split('.').pop() || 'jpg');
      const path = `${profile.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, compressed, { upsert: true, contentType: compressed.type });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', profile.id);
      setProfile((prev) => prev ? { ...prev, avatar_url: publicUrl } : prev);
    } catch (err: any) {
      showToast('error', 'Ошибка загрузки', err.message || 'Не удалось загрузить аватар');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleVehiclePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', 'Файл слишком большой', 'Максимальный размер фото — 5 МБ');
      e.target.value = '';
      return;
    }
    if (vehiclePhotoPreview) URL.revokeObjectURL(vehiclePhotoPreview);
    setVehiclePhotoFile(file);
    setVehiclePhotoPreview(URL.createObjectURL(file));
  };

  const handlePrivacyToggle = async (field: 'show_phone' | 'show_telegram' | 'show_whatsapp' | 'show_max') => {
    if (!profile) return;
    const newValue = !profile[field];
    const { error } = await supabase.from('users').update({ [field]: newValue }).eq('id', profile.id);
    if (error) {
      showToast('error', 'Ошибка', 'Не удалось изменить настройку приватности');
    } else {
      setProfile((prev) => prev ? { ...prev, [field]: newValue } : prev);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile) return;
    if (!editData.full_name.trim()) {
      showToast('error', 'Укажите имя', 'Имя не может быть пустым');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('users').update({
        full_name: editData.full_name,
        telegram: editData.telegram ? editData.telegram.replace(/@/g, '').trim() || null : null,
        whatsapp: editData.whatsapp ? editData.whatsapp.replace(/\D/g, '') || null : null,
        max: editData.max ? editData.max.replace(/\D/g, '') || null : null,
      }).eq('id', profile.id);
      if (error) throw error;
      setProfile((prev) => prev ? {
        ...prev,
        full_name: editData.full_name,
        telegram: editData.telegram || null,
        whatsapp: editData.whatsapp || null,
        max: editData.max || null,
      } : prev);
      setEditing(false);
    } catch (err: any) {
      showToast('error', 'Не удалось сохранить профиль', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (!profile) return;
    setEditing(false);
    setEditData({
      full_name: profile.full_name,
      telegram: profile.telegram ? applyTelegramMask(profile.telegram) : '',
      whatsapp: profile.whatsapp ? profile.whatsapp.replace(/\D/g, '') : '',
      max: profile.max ? profile.max.replace(/\D/g, '') : '',
    });
  };

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (vehicles.length >= MAX_VEHICLES) {
      showToast('error', 'Достигнут лимит', `Можно добавить не более ${MAX_VEHICLES} автомобилей`);
      return;
    }
    try {
      let photoUrl: string | null = null;
      if (vehiclePhotoFile) {
        const compressedVehicle = await compressImage(vehiclePhotoFile, { maxSize: 1024, quality: 0.8 });
        const ext = compressedVehicle.type === 'image/jpeg' ? 'jpg' : (compressedVehicle.name.split('.').pop() || 'jpg');
        const path = `${profile.id}/vehicles/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, compressedVehicle, { upsert: true, contentType: compressedVehicle.type });
        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
          photoUrl = publicUrl;
        }
      }
      const { data, error } = await supabase.from('vehicles').insert({
        driver_id: profile.id,
        make_model: newVehicle.make_model,
        license_plate: newVehicle.license_plate,
        capacity: newVehicle.capacity,
        photo_url: photoUrl,
        is_active: vehicles.length === 0, // первое авто сразу активное
      }).select();
      if (error) throw error;
      if (data) {
        setVehicles((prev) => [...prev, data[0] as Vehicle]);
        setShowVehicleForm(false);
        setNewVehicle({ make_model: '', license_plate: '', capacity: 4 });
        setVehiclePhotoFile(null);
        if (vehiclePhotoPreview) URL.revokeObjectURL(vehiclePhotoPreview);
        setVehiclePhotoPreview(null);
      }
    } catch (err: any) {
      const msg = err?.message?.includes('VEHICLE_LIMIT_REACHED')
        ? `Можно добавить не более ${MAX_VEHICLES} автомобилей`
        : err.message;
      showToast('error', 'Не удалось добавить автомобиль', msg);
    }
  };

  // Сделать авто активным (триггер БД снимет активность с остальных)
  const handleSetActiveVehicle = async (vehicleId: string) => {
    if (!profile || activeBusyId) return;
    const target = vehicles.find((v) => v.id === vehicleId);
    if (target?.is_active) {
      showToast('info', 'Уже активно', 'Это авто выбрано как активное. Чтобы сменить, включите другое.');
      return;
    }
    setActiveBusyId(vehicleId);
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({ is_active: true })
        .eq('id', vehicleId);
      if (error) throw error;
      setVehicles((prev) => prev.map((v) => ({ ...v, is_active: v.id === vehicleId })));
    } catch (err: any) {
      showToast('error', 'Ошибка', err.message || 'Не удалось выбрать активное авто');
    } finally {
      setActiveBusyId(null);
    }
  };

  // Заменить/добавить фото существующего авто
  const handleEditPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const vehicleId = editPhotoVehicleId;
    e.target.value = '';
    if (!file || !vehicleId || !profile) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', 'Файл слишком большой', 'Максимальный размер фото — 5 МБ');
      return;
    }
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    setPhotoBusyId(vehicleId);
    try {
      const compressed = await compressImage(file, { maxSize: 1024, quality: 0.8 });
      const ext = compressed.type === 'image/jpeg' ? 'jpg' : (compressed.name.split('.').pop() || 'jpg');
      const path = `${profile.id}/vehicles/${vehicleId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, compressed, { upsert: true, contentType: compressed.type });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error } = await supabase.from('vehicles').update({ photo_url: publicUrl }).eq('id', vehicleId);
      if (error) throw error;
      const oldPath = storagePathFromUrl(vehicle?.photo_url ?? null);
      if (oldPath) await supabase.storage.from('avatars').remove([oldPath]);
      setVehicles((prev) => prev.map((v) => v.id === vehicleId ? { ...v, photo_url: publicUrl } : v));
    } catch (err: any) {
      showToast('error', 'Ошибка загрузки', err.message || 'Не удалось обновить фото');
    } finally {
      setPhotoBusyId(null);
      setEditPhotoVehicleId(null);
    }
  };

  // Удалить только фото авто (после подтверждения в модалке)
  const confirmRemoveVehiclePhoto = async () => {
    const vehicle = removePhotoVehicle;
    if (!vehicle) return;
    setPhotoBusyId(vehicle.id);
    try {
      const { error } = await supabase.from('vehicles').update({ photo_url: null }).eq('id', vehicle.id);
      if (error) throw error;
      const oldPath = storagePathFromUrl(vehicle.photo_url);
      if (oldPath) await supabase.storage.from('avatars').remove([oldPath]);
      setVehicles((prev) => prev.map((v) => v.id === vehicle.id ? { ...v, photo_url: null } : v));
      setRemovePhotoVehicle(null);
    } catch (err: any) {
      showToast('error', 'Ошибка', err.message || 'Не удалось удалить фото');
    } finally {
      setPhotoBusyId(null);
    }
  };

  // Удалить авто целиком
  const confirmDeleteVehicle = async () => {
    if (!deleteVehicle) return;
    setDeleting(true);
    try {
      const removed = deleteVehicle;
      const { error } = await supabase.from('vehicles').delete().eq('id', removed.id);
      if (error) throw error;
      const oldPath = storagePathFromUrl(removed.photo_url);
      if (oldPath) await supabase.storage.from('avatars').remove([oldPath]);
      const rest = vehicles.filter((v) => v.id !== removed.id);
      // Если удалили активное — назначим активным первое из оставшихся
      const first = rest[0];
      if (removed.is_active && first && !rest.some((v) => v.is_active)) {
        await supabase.from('vehicles').update({ is_active: true }).eq('id', first.id);
        rest[0] = { ...first, is_active: true };
      }
      setVehicles(rest);
      setDeleteVehicle(null);
    } catch (err: any) {
      showToast('error', 'Ошибка', err.message || 'Не удалось удалить авто');
    } finally {
      setDeleting(false);
    }
  };

  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const handleLogout = () => setShowLogoutModal(true);

  const confirmLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-primary-container border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-md mx-auto text-center space-y-6 pt-12">
        <div className="w-16 h-16 rounded-full bg-error/10 text-error flex items-center justify-center mx-auto">
          <User size={32} />
        </div>
        <h2 className="text-2xl font-bold">Профиль не найден</h2>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-error bg-error/10 border border-error/20 font-bold"
        >
          <LogOut size={20} /> Выйти
        </button>
      </div>
    );
  }

  const isDriver = profile.role === 'driver';
  const filteredRides = myRides.filter((r) => r.status === ridesTab);

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: 'profile', label: 'Профиль' },
    // «Поездки» в шапке — состоявшиеся (trips_count), здесь — созданные
    // объявления. Числа разные, поэтому и подписи разные.
    { key: 'trips', label: `Мои объявления (${myRides.length})` },
    ...(isDriver ? [
      { key: 'reviews' as ProfileTab, label: `Отзывы (${reviews.length})` },
      { key: 'vehicles' as ProfileTab, label: 'Авто' },
    ] : []),
    { key: 'ratings', label: 'Рейтинги' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Hero Banner */}
      <div className="relative h-32 rounded-3xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#00f0ff]/20 via-[#0a0e1a] to-[#7701d0]/25" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(119,1,208,0.15),transparent_60%)]" />

        {/* Дрейфующие световые сферы (CSS-анимация — цикл всегда активен) */}
        {[
          { c: '#00f0ff', s: 120, l: '8%', t: '-30%', d: 9, delay: 0 },
          { c: '#7701d0', s: 150, l: '62%', t: '-50%', d: 11, delay: 0.6 },
          { c: '#b47aff', s: 90, l: '38%', t: '20%', d: 13, delay: 1.2 },
        ].map((o, i) => (
          <div
            key={`orb-${i}`}
            className="absolute rounded-full blur-2xl hero-orb"
            style={{
              width: o.s, height: o.s, left: o.l, top: o.t,
              background: o.c, opacity: 0.18,
              ['--dur' as any]: `${o.d}s`, animationDelay: `${o.delay}s`,
            }}
          />
        ))}

        {/* Бегущий блик */}
        <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent hero-shine" />

        {/* Парящие частицы */}
        {[...Array(14)].map((_, i) => (
          <div
            key={`p-${i}`}
            className="absolute rounded-full hero-particle"
            style={{
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 100}%`,
              width: i % 4 === 0 ? 3 : 1.5,
              height: i % 4 === 0 ? 3 : 1.5,
              background: i % 3 === 0 ? '#7701d0' : '#00f0ff',
              ['--dur' as any]: `${3 + (i % 6) * 0.7}s`,
              animationDelay: `${(i % 7) * 0.4}s`,
            }}
          />
        ))}

        <button
          onClick={handleLogout}
          className="md:hidden absolute top-4 right-4 flex items-center gap-1.5 px-4 py-2.5 sm:px-3 sm:py-1.5 rounded-xl bg-surface/60 backdrop-blur border border-white/10 text-sm sm:text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <LogOut size={16} className="sm:hidden" />
          <LogOut size={13} className="hidden sm:block" /> Выйти
        </button>
      </div>

      {/* Avatar overlap + name section */}
      <div className="-mt-12 px-4">
        {/* Row 1: avatar (overlaps banner) */}
        <div className="flex items-start">
          <div className="relative shrink-0">
            {/*
              Аватар. Раньше это был <div> с обработчиком клика — то есть
              сменить фото можно было только мышью: с клавиатуры на такой
              элемент не попасть (Tab его не видит), а скринридер объявлял его
              как обычную картинку, без намёка, что это кнопка. Заменено на
              настоящую <button>: Tab доходит, Enter и пробел работают, фокус
              виден, роль объявляется. Внешний вид не изменился.
              Заглушка с первой буквой имени и значок фотоаппарата скрыты от
              скринридера — они дублируют то, что уже сказано в подписи кнопки.
            */}
            <button
              type="button"
              aria-label={profile.avatar_url ? 'Сменить фото профиля' : 'Загрузить фото профиля'}
              className="w-24 h-24 rounded-full border-4 border-[#0a0e1a] overflow-hidden bg-surface-container-high flex items-center justify-center cursor-pointer group"
              onClick={() => fileInputRef.current?.click()}
            >
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-display font-bold text-on-surface-variant" aria-hidden="true">
                  {profile.full_name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" aria-hidden="true">
                {avatarUploading
                  ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Camera size={22} className="text-white" />}
              </div>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>
        </div>

        {/* Row 2: name + badge – clearly below banner */}
        <div className="mt-3 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider border ${
              isDriver
                ? 'bg-[#7701d0]/20 text-[#b47aff] border-[#7701d0]/40'
                : 'bg-[#00f0ff]/20 text-[#00f0ff] border-[#00f0ff]/40'
            }`}>
              {isDriver ? 'Водитель' : 'Пассажир'}
            </span>
            {isDriver && profile.rating > 0 && (
              <span className="flex items-center gap-1 text-sm font-bold text-yellow-400">
                <Star size={13} fill="currentColor" /> {profile.rating.toFixed(1)}
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold truncate mt-1">{profile.full_name}</h2>
          <p className="text-xs text-on-surface-variant mt-0.5">{pluralTrips(profile.trips_count)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all shrink-0 ${
              activeTab === tab.key
                ? 'bg-primary-container/20 text-primary-container border border-primary-container/30'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* TAB: Profile */}
        {activeTab === 'profile' && (
          <motion.div
            key="tab-profile"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {/* Contacts card */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Контакты</h3>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="p-1.5 rounded-lg border border-outline-variant/30 hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <Edit2 size={18} />
                  </button>
                )}
              </div>

              {editing ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="profile-name" className="text-xs text-on-surface-variant mb-1 block">Имя</label>
                    <input
                      id="profile-name"
                      value={editData.full_name}
                      onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
                      className="w-full input-glass px-4 py-2.5 rounded-xl text-sm font-medium"
                      maxLength={100}
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-telegram" className="text-xs text-on-surface-variant mb-1 block">Telegram</label>
                    <input
                      id="profile-telegram"
                      value={editData.telegram}
                      onChange={(e) => setEditData({ ...editData, telegram: applyTelegramMask(e.target.value) })}
                      className="w-full input-glass px-4 py-2.5 rounded-xl text-sm font-medium"
                      placeholder="@username"
                      maxLength={65}
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-whatsapp" className="text-xs text-on-surface-variant mb-1 block">WhatsApp</label>
                    <input
                      id="profile-whatsapp"
                      value={waDisplay(editData.whatsapp)}
                      onChange={(e) => setEditData({ ...editData, whatsapp: normalizeWaDigits(e.target.value) })}
                      className="w-full input-glass px-4 py-2.5 rounded-xl text-sm font-medium"
                      placeholder="wa.me/7XXXXXXXXXX"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-max" className="text-xs text-on-surface-variant mb-1 block">Мессенджер MAX</label>
                    <input
                      id="profile-max"
                      value={editData.max}
                      onChange={(e) => setEditData({ ...editData, max: applyMaxMask(e.target.value) })}
                      className="w-full input-glass px-4 py-2.5 rounded-xl text-sm font-medium"
                      placeholder="+79001234567"
                      inputMode="numeric"
                      maxLength={64}
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleCancelEdit}
                      className="flex-1 py-3 px-4 rounded-xl border border-outline-variant/30 hover:bg-surface-container text-on-surface font-semibold transition-all"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={handleSaveProfile}
                      disabled={saving}
                      className="flex-1 py-3 px-4 rounded-xl bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {saving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin" />
                          Сохранение...
                        </>
                      ) : (
                        <>
                          <Check size={18} />
                          Сохранить
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-outline-variant/10">
                  <InfoRow icon={<Phone size={15} />} label="Телефон" value={formatPhone(profile.phone)} />
                  <InfoRow icon={<Mail size={15} />} label="Email" value={profile.email} />
                  {profile.telegram && (
                    <InfoRow
                      icon={<span className="text-[10px] font-bold leading-none">TG</span>}
                      label="Telegram"
                      value={(() => {
                        const handle = profile.telegram!.replace(/@/g, '');
                        return (
                          <a href={`https://t.me/${handle}`} target="_blank" rel="noopener noreferrer" className="text-[#00f0ff] hover:underline">
                            @{handle}
                          </a>
                        );
                      })()}
                    />
                  )}
                  {profile.whatsapp && (
                    <InfoRow
                      icon={<MessageSquare size={15} />}
                      label="WhatsApp"
                      value={
                        <a href={`https://wa.me/${profile.whatsapp}`} target="_blank" rel="noopener noreferrer" className="text-[#00f0ff] hover:underline">
                          wa.me/{profile.whatsapp}
                        </a>
                      }
                    />
                  )}
                  {profile.max && (
                    <InfoRow
                      icon={<span className="text-[10px] font-bold leading-none">MAX</span>}
                      label="Мессенджер MAX"
                      value={
                        <a href={`https://max.im/${profile.max.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-[#00f0ff] hover:underline">
                          +{profile.max.replace(/\D/g, '')}
                        </a>
                      }
                    />
                  )}
                  {!profile.telegram && !profile.whatsapp && !profile.max && (
                    <p className="text-xs text-on-surface-variant pt-2">
                      Контакты не указаны.{' '}
                      <button onClick={() => setEditing(true)} className="text-[#00f0ff] hover:underline">
                        Добавить →
                      </button>
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Privacy toggles */}
            <div className="glass-panel p-6 rounded-2xl space-y-3">
              <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-2">
                <Shield size={13} /> Приватность
              </h3>
              <p className="text-xs text-on-surface-variant">
                Что видно другим пользователям в вашем профиле и на страницах поездок
              </p>
              <p className="text-xs text-on-surface-variant/70 leading-relaxed">
                После завершения аукциона второй стороне сделки открываются все
                указанные вами контакты — независимо от этих настроек. Иначе
                договориться о поездке было бы невозможно.
              </p>
              <PrivacyToggle
                label="Показывать телефон"
                value={profile.show_phone}
                onToggle={() => handlePrivacyToggle('show_phone')}
              />
              <PrivacyToggle
                label="Показывать Telegram"
                value={profile.show_telegram}
                onToggle={() => handlePrivacyToggle('show_telegram')}
              />
              <PrivacyToggle
                label="Показывать WhatsApp"
                value={profile.show_whatsapp}
                onToggle={() => handlePrivacyToggle('show_whatsapp')}
              />
              <PrivacyToggle
                label="Показывать Мессенджер MAX"
                value={profile.show_max}
                onToggle={() => handlePrivacyToggle('show_max')}
              />
            </div>
          </motion.div>
        )}

        {/* TAB: Trips */}
        {activeTab === 'trips' && (
          <motion.div
            key="tab-trips"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div className="flex gap-2">
              {(['active', 'completed', 'cancelled'] as RideStatus[]).map((s) => {
                const count = myRides.filter((r) => r.status === s).length;
                const labels = { active: 'Активные', completed: 'Завершённые', cancelled: 'Отменённые' };
                return (
                  <button
                    key={s}
                    onClick={() => setRidesTab(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      ridesTab === s
                        ? 'bg-surface-container-high text-on-surface'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {labels[s]} ({count})
                  </button>
                );
              })}
            </div>

            {filteredRides.length === 0 ? (
              <div className="text-center py-12 text-on-surface-variant">
                <MapPin size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Нет поездок в этой категории</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRides.map((ride) => (
                  <motion.button
                    key={ride.id}
                    onClick={() => navigate(`/trips/${ride.id}`)}
                    whileHover={{ scale: 1.01 }}
                    className="w-full glass-card p-4 rounded-2xl flex items-center gap-4 text-left border border-outline-variant/20 hover:border-outline-variant/40 transition-all"
                  >
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <div className="w-2 h-2 rounded-full bg-primary-container" />
                      <div className="w-0.5 h-4 bg-outline-variant/30" />
                      <div className="w-2 h-2 rounded-full bg-secondary-container" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">
                        {ride.origin} → {ride.destination}
                      </div>
                      <div className="text-xs text-on-surface-variant mt-0.5">{ride.departure_date}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-bold text-sm text-primary-container">
                        {ride.current_price.toLocaleString('ru-RU')} ₽
                      </div>
                      <div className={`text-xs mt-0.5 ${ride.type === 'offer' ? 'text-[#00f0ff]/70' : 'text-[#b47aff]/70'}`}>
                        {ride.type === 'offer' ? 'Я ВЕЗУ' : 'Я ЕДУ'}
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-outline shrink-0" />
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* TAB: Reviews */}
        {activeTab === 'reviews' && isDriver && (
          <motion.div
            key="tab-reviews"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {reviews.length === 0 ? (
              <div className="text-center py-12 text-on-surface-variant">
                <Star size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Отзывов пока нет</p>
              </div>
            ) : (
              reviews.map((review) => (
                <div
                  key={review.id}
                  className="glass-card p-5 rounded-2xl border border-outline-variant/20 space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden">
                      {review.reviewer?.avatar_url ? (
                        <img src={review.reviewer.avatar_url} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <span>{review.reviewer?.full_name.charAt(0).toUpperCase() || '?'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">
                        {review.reviewer?.full_name || 'Пользователь'}
                      </div>
                      <div className="text-xs text-on-surface-variant">
                        {new Date(review.created_at).toLocaleDateString('ru-RU', {
                          day: 'numeric', month: 'long', year: 'numeric',
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          size={14}
                          fill={s <= review.rating ? '#facc15' : 'none'}
                          className={s <= review.rating ? 'text-yellow-400' : 'text-outline-variant'}
                        />
                      ))}
                    </div>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-on-surface-variant">{review.comment}</p>
                  )}
                </div>
              ))
            )}
          </motion.div>
        )}

        {/* TAB: Ratings */}
        {activeTab === 'ratings' && (
          <motion.div
            key="tab-ratings"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {/* Рейтинги есть только у водителей: оценку ставит пассажир после
                поездки, обратной оценки нет. Список тот же, что на странице
                «Рейтинги», — один компонент на оба места. */}
            <DriverLeaderboard currentUserId={profile.id} />
          </motion.div>
        )}

        {/* TAB: Vehicles */}
        {activeTab === 'vehicles' && isDriver && (
          <motion.div
            key="tab-vehicles"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <Car size={18} className="text-primary-container" /> Мой транспорт
                <span className="text-xs font-medium text-on-surface-variant">
                  {vehicles.length}/{MAX_VEHICLES}
                </span>
              </h3>
              <button
                onClick={() => {
                  if (atVehicleLimit) {
                    showToast('error', 'Достигнут лимит', `Можно добавить не более ${MAX_VEHICLES} автомобилей`);
                    return;
                  }
                  setShowVehicleForm((v) => !v);
                }}
                disabled={atVehicleLimit}
                title={atVehicleLimit ? `Максимум ${MAX_VEHICLES} автомобиля` : 'Добавить авто'}
                className="p-2 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-primary-container disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={20} />
              </button>
            </div>

            {atVehicleLimit && (
              <p className="text-xs text-on-surface-variant -mt-1">
                Достигнут лимит в {MAX_VEHICLES} автомобиля. Удалите одно, чтобы добавить новое.
              </p>
            )}

            <AnimatePresence>
              {showVehicleForm && (
                <motion.form
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  onSubmit={handleAddVehicle}
                  className="glass-card p-6 rounded-2xl border border-outline-variant/30 space-y-4 overflow-hidden"
                >
                  <h4 className="font-bold">Новый автомобиль</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="vehicle-model" className="text-xs text-on-surface-variant uppercase mb-1 block">Марка и модель</label>
                      <input
                        id="vehicle-model"
                        required
                        value={newVehicle.make_model}
                        onChange={(e) => setNewVehicle({ ...newVehicle, make_model: e.target.value })}
                        className="w-full input-glass px-4 py-2 rounded-xl text-sm"
                        placeholder="Toyota Camry"
                      />
                    </div>
                    <div>
                      <label htmlFor="vehicle-plate" className="text-xs text-on-surface-variant uppercase mb-1 block">Гос. номер</label>
                      <input
                        id="vehicle-plate"
                        required
                        value={newVehicle.license_plate}
                        onChange={(e) => setNewVehicle({ ...newVehicle, license_plate: e.target.value })}
                        className="w-full input-glass px-4 py-2 rounded-xl text-sm"
                        placeholder="А123БВ 123"
                      />
                    </div>
                    <div>
                      <label htmlFor="vehicle-seats" className="text-xs text-on-surface-variant uppercase mb-1 block">Мест</label>
                      <input
                        id="vehicle-seats"
                        required
                        type="number"
                        min="1"
                        max="20"
                        value={newVehicle.capacity}
                        onChange={(e) => setNewVehicle({ ...newVehicle, capacity: parseInt(e.target.value) || 4 })}
                        className="w-full input-glass px-4 py-2 rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      {/* Не <label>: настоящее поле выбора файла спрятано и
                          управляется кнопкой ниже, а <label> обязан указывать
                          на поле — указывать на скрытое бессмысленно. Кнопка
                          «Выбрать фото» подписывает себя сама видимым текстом. */}
                      <span className="text-xs text-on-surface-variant uppercase mb-1 block">Фото</span>
                      <input
                        ref={vehiclePhotoRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleVehiclePhotoSelect}
                      />
                      {vehiclePhotoPreview ? (
                        <div className="relative w-full h-40 rounded-xl overflow-hidden group">
                          <img src={vehiclePhotoPreview} alt="Выбранное фото автомобиля" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            aria-label="Убрать выбранное фото"
                            onClick={() => {
                              if (vehiclePhotoPreview) URL.revokeObjectURL(vehiclePhotoPreview);
                              setVehiclePhotoFile(null);
                              setVehiclePhotoPreview(null);
                              if (vehiclePhotoRef.current) vehiclePhotoRef.current.value = '';
                            }}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => vehiclePhotoRef.current?.click()}
                          className="w-full h-40 rounded-xl input-glass flex flex-col items-center justify-center gap-1.5 text-on-surface-variant hover:text-on-surface hover:border-white/20 transition-colors"
                        >
                          <Camera size={20} />
                          <span className="text-xs">Выбрать фото</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setShowVehicleForm(false);
                        setVehiclePhotoFile(null);
                        if (vehiclePhotoPreview) URL.revokeObjectURL(vehiclePhotoPreview);
                        setVehiclePhotoPreview(null);
                        if (vehiclePhotoRef.current) vehiclePhotoRef.current.value = '';
                      }}
                      className="px-4 py-2 rounded-xl text-sm hover:bg-surface-container font-medium"
                    >
                      Отмена
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl btn-mesh font-bold text-sm text-white"
                    >
                      Сохранить
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>

            {vehicles.length === 0 && !showVehicleForm ? (
              <div className="text-center py-12 border border-dashed border-outline-variant/40 rounded-2xl text-on-surface-variant">
                <Car size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Нет добавленных автомобилей</p>
              </div>
            ) : (
              <div className="space-y-3">
                {vehicles.map((vehicle) => {
                  const photoBusy = photoBusyId === vehicle.id;
                  return (
                  <div
                    key={vehicle.id}
                    className={`glass-card rounded-2xl overflow-hidden border transition-colors ${
                      vehicle.is_active
                        ? 'border-[#00f0ff]/50 shadow-[0_0_20px_-6px_rgba(0,240,255,0.35)]'
                        : 'border-outline-variant/20'
                    }`}
                  >
                    {/* Фото: крупное, сверху на мобильных и слева на десктопе */}
                    <div className="flex flex-col sm:flex-row">
                      <div className="relative w-full h-52 sm:h-auto sm:w-44 sm:shrink-0 bg-surface-container-high overflow-hidden flex items-center justify-center">
                        {vehicle.photo_url ? (
                          <img src={vehicle.photo_url} alt={vehicle.make_model} className="w-full h-full object-cover" />
                        ) : (
                          <Car size={40} className="text-outline" />
                        )}
                        {photoBusy && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                        {vehicle.is_active && (
                          <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#00f0ff] text-[#003] text-[10px] font-bold uppercase tracking-wider">
                            <Check size={11} /> Активное
                          </span>
                        )}
                        {/* Управление фото */}
                        <div className="absolute bottom-2 right-2 flex gap-1.5">
                          <button
                            type="button"
                            disabled={photoBusy}
                            onClick={() => { setEditPhotoVehicleId(vehicle.id); editPhotoRef.current?.click(); }}
                            title={vehicle.photo_url ? 'Изменить фото' : 'Добавить фото'}
                            className="w-8 h-8 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center hover:bg-black/80 transition-colors disabled:opacity-50"
                          >
                            <Camera size={15} />
                          </button>
                          {vehicle.photo_url && (
                            <button
                              type="button"
                              disabled={photoBusy}
                              onClick={() => setRemovePhotoVehicle(vehicle)}
                              title="Удалить фото"
                              className="w-8 h-8 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center hover:bg-error/80 transition-colors disabled:opacity-50"
                            >
                              <ImageOff size={15} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Описание: под фото на мобильных */}
                      <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-bold text-lg truncate">{vehicle.make_model}</div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="uppercase tracking-wider font-mono text-xs px-2 py-0.5 bg-surface-container rounded text-on-surface">
                                {vehicle.license_plate}
                              </span>
                              <span className="text-sm text-on-surface-variant">{pluralSeats(vehicle.capacity)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDeleteVehicle(vehicle)}
                            title="Удалить автомобиль"
                            className="shrink-0 w-9 h-9 rounded-lg border border-outline-variant/30 text-on-surface-variant hover:text-error hover:border-error/40 hover:bg-error/10 transition-colors flex items-center justify-center"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>

                        {/* Переключатель активного авто */}
                        <div className="mt-auto flex items-center justify-between gap-3 pt-3 border-t border-outline-variant/15">
                          <span className="text-sm font-medium">
                            {vehicle.is_active ? 'Активное авто' : 'Сделать активным'}
                          </span>
                          <button
                            type="button"
                            disabled={activeBusyId === vehicle.id}
                            onClick={() => handleSetActiveVehicle(vehicle.id)}
                            aria-pressed={vehicle.is_active}
                            title={vehicle.is_active ? 'Это авто уже активно' : 'Сделать активным'}
                            className={`w-12 h-7 rounded-full transition-all relative shrink-0 cursor-pointer disabled:opacity-60 ${
                              vehicle.is_active ? 'bg-[#00f0ff]' : 'bg-outline-variant/40 hover:bg-outline-variant/60'
                            }`}
                          >
                            <span
                              className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${
                                vehicle.is_active ? 'left-6' : 'left-1'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
            {/* Скрытый input для замены фото существующего авто */}
            <input
              ref={editPhotoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleEditPhotoSelect}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <LogoutModal
        open={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={confirmLogout}
      />

      <Modal
        open={!!deleteVehicle}
        onClose={() => { if (!deleting) setDeleteVehicle(null); }}
        title="Удалить автомобиль?"
        size="sm"
      >
        <p className="text-sm text-on-surface-variant">
          {deleteVehicle?.make_model}
          {deleteVehicle?.license_plate ? ` · ${deleteVehicle.license_plate}` : ''} будет удалён без возможности
          восстановления.
        </p>
        <div className="flex gap-3 pt-5">
          <button
            onClick={() => setDeleteVehicle(null)}
            disabled={deleting}
            className="flex-1 py-3 rounded-xl border border-outline-variant/30 hover:bg-surface-container font-semibold transition-all disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={confirmDeleteVehicle}
            disabled={deleting}
            className="flex-1 py-3 rounded-xl bg-error/15 text-error border border-error/30 hover:bg-error/25 font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {deleting ? (
              <div className="w-4 h-4 border-2 border-error border-t-transparent rounded-full animate-spin" />
            ) : (
              <Trash2 size={16} />
            )}
            Удалить
          </button>
        </div>
      </Modal>

      <Modal
        open={!!removePhotoVehicle}
        onClose={() => { if (photoBusyId !== removePhotoVehicle?.id) setRemovePhotoVehicle(null); }}
        title="Удалить фото автомобиля?"
        size="sm"
      >
        <p className="text-sm text-on-surface-variant">
          Фото {removePhotoVehicle?.make_model || 'автомобиля'} будет удалено. Само авто останется, фото можно
          загрузить заново.
        </p>
        <div className="flex gap-3 pt-5">
          <button
            onClick={() => setRemovePhotoVehicle(null)}
            disabled={photoBusyId === removePhotoVehicle?.id}
            className="flex-1 py-3 rounded-xl border border-outline-variant/30 hover:bg-surface-container font-semibold transition-all disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={confirmRemoveVehiclePhoto}
            disabled={photoBusyId === removePhotoVehicle?.id}
            className="flex-1 py-3 rounded-xl bg-error/15 text-error border border-error/30 hover:bg-error/25 font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {photoBusyId === removePhotoVehicle?.id ? (
              <div className="w-4 h-4 border-2 border-error border-t-transparent rounded-full animate-spin" />
            ) : (
              <ImageOff size={16} />
            )}
            Удалить фото
          </button>
        </div>
      </Modal>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-outline shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-on-surface-variant">{label}</div>
        <div className="font-medium text-sm truncate">{value}</div>
      </div>
    </div>
  );
}

function PrivacyToggle({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm font-medium">{label}</span>
      {/*
        Переключатель нарисован из div-ов, поэтому скринридер сам по себе не
        понимает ни что это выключатель, ни включён он или нет: внутри кнопки
        нет ни текста, ни иконки — только цветной кружок. role="switch"
        объявляет тип элемента, aria-checked передаёт состояние, aria-label
        связывает его с подписью слева.
      */}
      <button
        type="button"
        onClick={onToggle}
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`w-11 h-6 rounded-full transition-all relative shrink-0 ${
          value ? 'bg-[#00f0ff]' : 'bg-outline-variant/40'
        }`}
      >
        <span
          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
            value ? 'left-6' : 'left-1'
          }`}
        />
      </button>
    </div>
  );
}

