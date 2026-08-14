import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CheckCircle2, Loader2, ReceiptText, ArrowRight, ShieldCheck, Info } from 'lucide-react';
import { publishRideFree, PUBLICATION_PRICE, PAYMENT_PROVIDER, PAYMENTS_ENABLED } from '../lib/publishRide';

// Страница оплаты публикации поездки.
//
// Показывает условия платной услуги: что оплачивается, сколько стоит, каким
// способом принимается платёж и что происходит после.
//
// Пока ЮMoney не подключена, публикация бесплатна, и страница говорит об этом
// ПРЯМО. Раньше здесь показывалось «Проверяем оплату…», затем «Оплата
// получена!», а кнопка называлась «Повторить оплату» — при том, что ни один
// рубль не списывался. Это недостоверные сведения об услуге (пункт 2.1 аудита
// от 10.08.2026), и для платёжного модератора такое — основание для отказа.

// Состояние 'info' — для случая, когда адрес открыт без указания поездки.
//
// Раньше страница в этом случае показывала «Поездка не найдена». Для человека,
// пришедшего по прямой ссылке, это тупик, а для проверяющего платёжной системы —
// хуже: в анкете на подключение просят адрес страницы приёма платежей, он
// открывает её и видит ошибку. Теперь без параметра показывается описание
// услуги и тариф, то есть ровно то, что он и должен увидеть.
type Phase = 'loading' | 'info' | 'draft' | 'published' | 'notfound';

export function Payment() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rideId = params.get('ride');

  const [phase, setPhase] = useState<Phase>('loading');
  const [publishing, setPublishing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!rideId) {
      setPhase('info');
      return;
    }

    supabase
      .from('rides')
      .select('status')
      .eq('id', rideId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled.current) return;
        if (!data) { setPhase('notfound'); return; }
        setPhase(data.status === 'draft' ? 'draft' : 'published');
      });

    return () => { cancelled.current = true; };
  }, [rideId]);

  const handlePublish = async () => {
    if (!rideId) return;
    setErrorMsg(null);
    setPublishing(true);
    try {
      await publishRideFree(rideId);
      navigate(`/trips/${rideId}`);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Не удалось опубликовать поездку. Попробуйте ещё раз.');
      setPublishing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-on-surface flex items-center justify-center px-4 py-10">
      <div className="glass-panel rounded-3xl p-8 max-w-md w-full space-y-5">

        {phase === 'loading' && (
          <div className="text-center space-y-4 py-6">
            <Loader2 size={40} className="text-primary-container mx-auto animate-spin" />
            <p className="text-on-surface-variant text-sm">Загружаем данные поездки…</p>
          </div>
        )}

        {phase === 'info' && (
          <div className="space-y-5">
            <div className="text-center space-y-2">
              <h1 className="text-xl font-bold">Оплата публикации поездки</h1>
              <p className="text-on-surface-variant text-sm">
                Здесь оплачивается размещение объявления в ленте сервиса
              </p>
            </div>

            <div className="glass-card rounded-2xl p-4 space-y-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-on-surface-variant">Услуга</span>
                <span className="font-medium text-right">Размещение объявления о поездке</span>
              </div>
              <div className="flex items-baseline justify-between gap-3 pt-3 border-t border-outline-variant/20">
                <span className="text-on-surface-variant">Стоимость</span>
                <span className="font-medium text-right">
                  {PUBLICATION_PRICE}&nbsp;₽ за одну публикацию
                  <br />
                  <span className="text-on-surface-variant text-xs">независимо от маршрута и даты</span>
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 pt-3 border-t border-outline-variant/20">
                <span className="text-on-surface-variant">Способ оплаты</span>
                <span className="font-medium text-right">
                  Банковская карта или СБП<br />
                  <span className="text-on-surface-variant text-xs">через {PAYMENT_PROVIDER}</span>
                </span>
              </div>
            </div>

            {!PAYMENTS_ENABLED && (
              <div className="rounded-2xl p-4 bg-[#00e290]/10 border border-[#00e290]/30 space-y-1.5">
                <div className="flex items-center gap-2 text-[#00e290] font-semibold text-sm">
                  <Info size={15} />
                  Сейчас публикация бесплатная
                </div>
                <p className="text-on-surface-variant text-xs leading-relaxed">
                  Приём платежей через {PAYMENT_PROVIDER} находится в процессе подключения.
                  До его завершения объявления размещаются без оплаты — деньги не списываются,
                  вводить платёжные данные не нужно.
                </p>
              </div>
            )}

            <p className="text-on-surface-variant text-sm leading-relaxed">
              Оплата привязана к конкретному объявлению: страница открывается со страницы
              создания поездки или из раздела «Мои поездки», где ждёт неоплаченный черновик.
              Отдельной оплаты «просто так», не привязанной к объявлению, в сервисе нет.
            </p>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => navigate('/create')}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl btn-mesh font-bold text-white"
              >
                Создать поездку <ArrowRight size={16} />
              </button>
              <button
                onClick={() => navigate('/paid-services')}
                className="w-full px-6 py-3 rounded-xl glass-card border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-sm font-semibold transition-colors"
              >
                Подробнее об услуге и возвратах
              </button>
            </div>

            <p className="text-on-surface-variant/60 text-[11px] text-center leading-relaxed">
              Условия услуги —{' '}
              <button onClick={() => navigate('/offer')} className="text-primary-container hover:underline">
                публичная оферта
              </button>{' '}
              и{' '}
              <button onClick={() => navigate('/terms')} className="text-primary-container hover:underline">
                условия использования
              </button>.
            </p>
          </div>
        )}

        {phase === 'notfound' && (
          <div className="text-center space-y-4">
            <h1 className="text-xl font-bold">Поездка не найдена</h1>
            <p className="text-on-surface-variant text-sm">
              Возможно, черновик был удалён. Создайте поездку заново.
            </p>
            <button
              onClick={() => navigate('/create')}
              className="w-full px-6 py-3 rounded-xl btn-mesh font-bold text-white"
            >
              Создать поездку
            </button>
          </div>
        )}

        {phase === 'draft' && (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-xl font-bold">Публикация поездки</h1>
              <p className="text-on-surface-variant text-sm">
                Размещение объявления и запуск аукциона
              </p>
            </div>

            {/* Условия платной услуги — то, что проверяет платёжный модератор */}
            <div className="glass-card rounded-2xl p-4 space-y-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-on-surface-variant">Услуга</span>
                <span className="font-medium text-right">Размещение объявления о поездке</span>
              </div>
              {/*
                Пока приём платежей не подключён, карточка не должна говорить
                двумя голосами: раньше здесь стояло «Стоимость 100 ₽ / Банковская
                карта», а сразу под ней зелёный блок «Сейчас публикация
                бесплатная». Теперь к оплате показано честное «0 ₽», прежний
                тариф — зачёркнутой сноской, а способ оплаты появляется только
                когда деньги действительно берут.
              */}
              <div className="flex items-baseline justify-between gap-3 pt-3 border-t border-outline-variant/20">
                <span className="text-on-surface-variant">К оплате</span>
                {PAYMENTS_ENABLED ? (
                  <span className="text-lg font-bold">{PUBLICATION_PRICE}&nbsp;₽</span>
                ) : (
                  <span className="text-right">
                    <span className="text-lg font-bold text-green-400">0&nbsp;₽</span>{' '}
                    <s className="text-on-surface-variant text-sm">{PUBLICATION_PRICE}&nbsp;₽</s>
                  </span>
                )}
              </div>
              {PAYMENTS_ENABLED && (
                <div className="flex items-baseline justify-between gap-3 pt-3 border-t border-outline-variant/20">
                  <span className="text-on-surface-variant">Способ оплаты</span>
                  <span className="font-medium text-right">
                    Банковская карта или СБП<br />
                    <span className="text-on-surface-variant text-xs">через {PAYMENT_PROVIDER}</span>
                  </span>
                </div>
              )}
            </div>

            {!PAYMENTS_ENABLED && (
              <div className="rounded-2xl p-4 bg-[#00e290]/10 border border-[#00e290]/30 space-y-1.5">
                <div className="flex items-center gap-2 text-[#00e290] font-semibold text-sm">
                  <Info size={15} />
                  Сейчас публикация бесплатная
                </div>
                <p className="text-on-surface-variant text-xs leading-relaxed">
                  Приём платежей через {PAYMENT_PROVIDER} находится в процессе подключения.
                  До его завершения объявления размещаются без оплаты — деньги не списываются,
                  вводить платёжные данные не нужно. Плата {PUBLICATION_PRICE}&nbsp;₽ начнёт
                  взиматься только после подключения, и мы сообщим об этом заранее.
                </p>
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl p-3 bg-error/10 border border-error/30 text-error text-sm">
                {errorMsg}
              </div>
            )}

            <button
              onClick={handlePublish}
              disabled={publishing}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl btn-mesh font-bold text-white disabled:opacity-60"
            >
              {publishing ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>Опубликовать бесплатно <ArrowRight size={16} /></>
              )}
            </button>

            <button
              onClick={() => navigate('/my-trips')}
              className="w-full px-6 py-3 rounded-xl glass-card border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-sm font-semibold transition-colors"
            >
              Позже — в «Мои поездки»
            </button>

            <p className="text-on-surface-variant/60 text-[11px] text-center leading-relaxed">
              Нажимая кнопку, вы соглашаетесь с{' '}
              <button onClick={() => navigate('/offer')} className="text-primary-container hover:underline">
                публичной офертой
              </button>{' '}
              и{' '}
              <button onClick={() => navigate('/terms')} className="text-primary-container hover:underline">
                условиями использования
              </button>.
            </p>
          </>
        )}

        {phase === 'published' && (
          <div className="text-center space-y-5">
            <CheckCircle2 size={44} className="text-[#00e290] mx-auto" />
            <div className="space-y-2">
              <h1 className="text-xl font-bold">Поездка опубликована</h1>
              <p className="text-on-surface-variant text-sm">
                Объявление размещено, аукцион идёт.
                {!PAYMENTS_ENABLED && ' Плата за размещение не взималась.'}
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              {rideId && (
                <button
                  onClick={() => navigate(`/trips/${rideId}`)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl btn-mesh font-bold text-white"
                >
                  Открыть поездку <ArrowRight size={16} />
                </button>
              )}
              {/* Квитанция формируется только по реально оплаченным размещениям.
                  Пока оплата не подключена, показывать эту кнопку незачем. */}
              {PAYMENTS_ENABLED && rideId && (
                <button
                  onClick={() => navigate(`/receipt/${rideId}`)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl glass-card border border-primary-container/30 text-primary-container text-sm font-semibold hover:bg-primary-container/10 transition-colors"
                >
                  <ReceiptText size={16} /> Квитанция об оплате
                </button>
              )}
              <button
                onClick={() => navigate('/my-trips')}
                className="w-full px-6 py-3 rounded-xl glass-card border border-outline-variant/40 text-on-surface-variant hover:text-on-surface text-sm font-semibold transition-colors"
              >
                Перейти в «Мои поездки»
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-1.5 text-on-surface-variant/50 text-[11px] pt-1">
          <ShieldCheck size={12} />
          Платёжные данные вводятся на стороне {PAYMENT_PROVIDER} и сервису не передаются
        </div>
      </div>
    </div>
  );
}
