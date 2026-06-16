import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';

// Страница, на которую ЮMoney возвращает пользователя после оплаты
// (successURL = /payment?status=pending&label=...&ride=...).
//
// Платёж подтверждается асинхронно: ЮMoney шлёт HTTP-уведомление на Edge
// Function, та публикует поездку (draft → active). Поэтому здесь мы НЕ читаем
// таблицу payments (она закрыта от клиента), а опрашиваем статус самой поездки
// по её id — как только он станет 'active', значит оплата подтверждена.

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 40_000;

type Phase = 'checking' | 'published' | 'timeout';

export function Payment() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rideId = params.get('ride');
  const [phase, setPhase] = useState<Phase>('checking');
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (!rideId) {
      setPhase('timeout');
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const poll = async () => {
      const { data } = await supabase
        .from('rides')
        .select('status')
        .eq('id', rideId)
        .single();

      if (cancelled) return;

      if (data?.status === 'active') {
        setPhase('published');
        setTimeout(() => navigate(`/trips/${rideId}`), 1400);
        return;
      }
      if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
        setPhase('timeout');
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rideId, navigate]);

  return (
    <div className="min-h-screen bg-background text-on-surface flex items-center justify-center px-4">
      <div className="glass-panel rounded-3xl p-8 max-w-md w-full text-center space-y-5">
        {phase === 'checking' && (
          <>
            <Loader2 size={44} className="text-primary-container mx-auto animate-spin" />
            <h1 className="text-xl font-bold">Проверяем оплату…</h1>
            <p className="text-on-surface-variant text-sm">
              Это занимает несколько секунд. Как только платёж подтвердится, поездка
              автоматически опубликуется и аукцион начнётся.
            </p>
          </>
        )}

        {phase === 'published' && (
          <>
            <CheckCircle2 size={44} className="text-[#00e290] mx-auto" />
            <h1 className="text-xl font-bold">Оплата получена!</h1>
            <p className="text-on-surface-variant text-sm">
              Поездка опубликована. Открываем её…
            </p>
          </>
        )}

        {phase === 'timeout' && (
          <>
            <Clock size={44} className="text-on-surface-variant mx-auto" />
            <h1 className="text-xl font-bold">Платёж ещё проверяется</h1>
            <p className="text-on-surface-variant text-sm">
              Иногда подтверждение занимает чуть больше времени. Поездка появится в
              разделе «Мои поездки» сразу после подтверждения оплаты.
            </p>
            <button
              onClick={() => navigate('/my-trips')}
              className="px-6 py-3 rounded-xl btn-mesh font-bold text-white"
            >
              Перейти в «Мои поездки»
            </button>
          </>
        )}
      </div>
    </div>
  );
}
