import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CheckCircle2, Clock, Loader2, ReceiptText, ArrowRight, RefreshCcw } from 'lucide-react';
import { publishRideFree } from '../lib/publishRide';

// Страница статуса публикации поездки.
//
// На время подключения Platega публикация бесплатна. Сюда можно попасть со
// старой ссылкой /payment?ride=...; мы опрашиваем статус поездки по её id и,
// как только он становится 'active', показываем, что поездка опубликована.
// Кнопка «Повторить» просто публикует черновик бесплатно через RPC.

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 40_000;

type Phase = 'checking' | 'published' | 'timeout';

export function Payment() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rideId = params.get('ride');
  const [phase, setPhase] = useState<Phase>('checking');
  const [retrying, setRetrying] = useState(false);
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
  }, [rideId]);

  const handleRetry = async () => {
    if (!rideId) return;
    try {
      setRetrying(true);
      // Публикация временно бесплатна (на время подключения Platega).
      await publishRideFree(rideId);
      navigate(`/trips/${rideId}`);
    } catch {
      setRetrying(false);
    }
  };

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
              Поездка опубликована и участвует в аукционе.
            </p>
            <div className="flex flex-col gap-2.5 pt-2">
              {rideId && (
                <button
                  onClick={() => navigate(`/trips/${rideId}`)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl btn-mesh font-bold text-white"
                >
                  Открыть поездку <ArrowRight size={16} />
                </button>
              )}
              {rideId && (
                <button
                  onClick={() => navigate(`/receipt/${rideId}`)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl glass-card border border-primary-container/30 text-primary-container text-sm font-semibold hover:bg-primary-container/10 transition-colors"
                >
                  <ReceiptText size={16} /> Квитанция об оплате
                </button>
              )}
            </div>
          </>
        )}

        {phase === 'timeout' && (
          <>
            <Clock size={44} className="text-on-surface-variant mx-auto" />
            <h1 className="text-xl font-bold">Платёж ещё проверяется</h1>
            <p className="text-on-surface-variant text-sm">
              Иногда подтверждение занимает чуть больше времени. Если вы оплатили — поездка
              появится в «Мои поездки» сразу после подтверждения. Если оплата не прошла —
              можно попробовать ещё раз.
            </p>
            <div className="flex flex-col gap-2.5 pt-2">
              {rideId && (
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl btn-mesh font-bold text-white disabled:opacity-60"
                >
                  {retrying ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <><RefreshCcw size={16} /> Повторить оплату</>
                  )}
                </button>
              )}
              <button
                onClick={() => navigate('/my-trips')}
                className="w-full px-6 py-3 rounded-xl glass-card border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-sm font-semibold transition-colors"
              >
                Перейти в «Мои поездки»
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
