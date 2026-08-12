import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Bell, Gavel, Trophy, XCircle, Star, CheckCheck, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Notification, NotificationType } from '../lib/supabase';

/**
 * Лента уведомлений.
 *
 * Зачем страница появилась. Уведомления в базе копились с самого начала —
 * ставка на вашу поездку, победа в аукционе, проигрыш, отмена поездки,
 * полученный отзыв. Но увидеть их можно было только всплывающей плашкой в
 * углу экрана, и только если вы в этот момент были на сайте. Плашка гасла
 * через несколько секунд — и всё, событие исчезало навсегда. Человек,
 * закрывший вкладку на час, не узнавал, что на его поездку сделали ставку.
 *
 * Данные для страницы уже были, не хватало только самой страницы.
 */

const ICONS: Record<NotificationType, typeof Bell> = {
  new_bid: Gavel,
  auction_won: Trophy,
  auction_lost: XCircle,
  ride_cancelled: XCircle,
  review_received: Star,
};

// Цвет — вспомогательный сигнал, не единственный. Смысл всегда продублирован
// значком и текстом: на цвет нельзя опираться как на единственный способ
// передать информацию (люди с нарушением цветовосприятия его не считают).
const COLORS: Record<NotificationType, string> = {
  new_bid: 'text-[#b47aff] bg-[#7701d0]/15 border-[#b47aff]/30',
  auction_won: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  auction_lost: 'text-on-surface-variant bg-surface-container-high border-outline-variant/40',
  ride_cancelled: 'text-red-400 bg-red-500/10 border-red-500/30',
  review_received: 'text-[#00e290] bg-[#00e290]/10 border-[#00e290]/30',
};

const TYPE_LABEL: Record<NotificationType, string> = {
  new_bid: 'Новая ставка',
  auction_won: 'Аукцион выигран',
  auction_lost: 'Аукцион проигран',
  ride_cancelled: 'Поездка отменена',
  review_received: 'Новый отзыв',
};

/** «5 минут назад», «вчера», «12 августа» — привычнее, чем сырая дата. */
function whenLabel(iso: string): string {
  const then = new Date(iso);
  const diffMin = Math.floor((Date.now() - then.getTime()) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'вчера';
  if (diffD < 7) return `${diffD} дн назад`;
  return then.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (err) setError('Не удалось загрузить уведомления. Попробуйте обновить страницу.');
    else setItems((data ?? []) as Notification[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const unread = items.filter(n => !n.is_read).length;

  async function markAllRead() {
    if (unread === 0 || marking) return;
    setMarking(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', session.user.id)
        .eq('is_read', false);
      setItems(prev => prev.map(n => ({ ...n, is_read: true })));
    }
    setMarking(false);
  }

  // Открытое уведомление гасим сразу: раньше счётчик и бейдж в шапке висели
  // вечно, если человек читал уведомления по одному, а не кнопкой «Прочитать все».
  const markOneRead = useCallback(async (id: string) => {
    setItems(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
    const { error: err } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('is_read', false);
    // Если запись не прошла — возвращаем метку, чтобы интерфейс не врал.
    if (err) setItems(prev => prev.map(n => (n.id === id ? { ...n, is_read: false } : n)));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-display font-bold">Уведомления</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {unread > 0
              ? `${unread} ${unread === 1 ? 'непрочитанное' : unread < 5 ? 'непрочитанных' : 'непрочитанных'}`
              : 'Всё прочитано'}
          </p>
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/40 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50"
          >
            <CheckCheck size={16} aria-hidden="true" />
            Прочитать все
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка уведомлений">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-surface-container/40 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <Bell size={44} className="text-outline" aria-hidden="true" />
          <p className="text-on-surface-variant">Уведомлений пока нет</p>
          <p className="text-sm text-outline max-w-xs">
            Здесь появятся ставки на ваши поездки, итоги аукционов и полученные отзывы.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((n, i) => {
            const Icon = ICONS[n.type] ?? Bell;
            const Card = (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.03 }}
                className={`p-4 rounded-2xl border flex items-start gap-4 transition-colors ${
                  n.is_read
                    ? 'bg-surface-container/30 border-outline-variant/25'
                    : 'bg-surface-container-high/60 border-primary-container/30'
                } ${n.ride_id ? 'hover:bg-surface-container-high' : ''}`}
              >
                <div className={`w-11 h-11 shrink-0 rounded-xl border flex items-center justify-center ${COLORS[n.type] ?? COLORS.auction_lost}`}>
                  <Icon size={20} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-on-surface">{n.title}</span>
                    {/* Признак «не прочитано» — не только точкой: точку
                        скринридер не видит, поэтому рядом стоит слово,
                        спрятанное от глаз, но читаемое вслух. */}
                    {!n.is_read && (
                      <>
                        <span className="w-2 h-2 rounded-full bg-primary-container shrink-0" aria-hidden="true" />
                        <span className="sr-only">не прочитано</span>
                      </>
                    )}
                  </div>
                  {n.body && (
                    <p className="text-sm text-on-surface-variant mt-0.5 leading-snug">{n.body}</p>
                  )}
                  <div className="text-xs text-outline mt-1.5">
                    {TYPE_LABEL[n.type] ?? 'Событие'} · {whenLabel(n.created_at)}
                  </div>
                </div>
                {n.ride_id && <ArrowRight size={18} className="text-outline shrink-0 mt-3" aria-hidden="true" />}
              </motion.div>
            );

            return (
              <li key={n.id}>
                {/* Уведомления о поездке ведут на её карточку; те, что без
                    поездки (например, отзыв), можно только отметить прочитанными. */}
                {n.ride_id ? (
                  <Link
                    to={`/trips/${n.ride_id}`}
                    onClick={() => { if (!n.is_read) markOneRead(n.id); }}
                    className="block rounded-2xl outline-offset-2"
                  >
                    {Card}
                  </Link>
                ) : !n.is_read ? (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Отметить прочитанным: ${n.title}`}
                    onClick={() => markOneRead(n.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); markOneRead(n.id); } }}
                    className="block rounded-2xl outline-offset-2 cursor-pointer"
                  >
                    {Card}
                  </div>
                ) : Card}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
