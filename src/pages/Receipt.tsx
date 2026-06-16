import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Printer, ReceiptText, Loader2, AlertCircle } from 'lucide-react';
import { SITE } from '../lib/siteInfo';

interface ReceiptData {
  ride_id: string;
  origin: string;
  destination: string;
  departure_date: string;
  departure_time: string;
  amount: number;
  operation_id: string | null;
  label: string;
  paid_at: string;
}

type Phase = 'loading' | 'ready' | 'notfound' | 'unauth';

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtDepart(dateStr: string, timeStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const date = new Date(y, mo - 1, d).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  return `${date}, ${timeStr.slice(0, 5)}`;
}

export function Receipt() {
  const { rideId } = useParams<{ rideId: string }>();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<ReceiptData | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setPhase('unauth'); return; }
      if (!rideId) { setPhase('notfound'); return; }

      const { data: rows, error } = await supabase.rpc('get_ride_receipt', { p_ride_id: rideId });
      if (error || !rows || (rows as ReceiptData[]).length === 0) {
        setPhase('notfound');
        return;
      }
      setData((rows as ReceiptData[])[0]);
      setPhase('ready');
    })();
  }, [rideId]);

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary-container animate-spin" />
      </div>
    );
  }

  if (phase === 'unauth') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="glass-panel rounded-3xl p-8 max-w-md w-full text-center space-y-4">
          <AlertCircle size={40} className="text-on-surface-variant mx-auto" />
          <h1 className="text-xl font-bold">Нужен вход</h1>
          <p className="text-on-surface-variant text-sm">Квитанция доступна только владельцу поездки.</p>
          <button onClick={() => navigate('/login')} className="px-6 py-3 rounded-xl btn-mesh font-bold text-white">
            Войти
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'notfound' || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="glass-panel rounded-3xl p-8 max-w-md w-full text-center space-y-4">
          <ReceiptText size={40} className="text-on-surface-variant mx-auto" />
          <h1 className="text-xl font-bold">Квитанция не найдена</h1>
          <p className="text-on-surface-variant text-sm">
            По этой поездке нет подтверждённой оплаты публикации.
          </p>
          <button onClick={() => navigate('/my-trips')} className="px-6 py-3 rounded-xl btn-mesh font-bold text-white">
            К моим поездкам
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* Печатаем только саму квитанцию */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .receipt-sheet { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="max-w-xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 no-print">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-on-surface-variant hover:text-on-surface text-sm transition-colors"
          >
            <ArrowLeft size={16} /> Назад
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl btn-mesh text-white text-sm font-bold"
          >
            <Printer size={15} /> Печать / Сохранить PDF
          </button>
        </div>

        <div className="receipt-sheet glass-panel rounded-2xl p-8 space-y-6">
          {/* Шапка */}
          <div className="flex items-center gap-3 pb-4 border-b border-outline-variant/20">
            <img src="/icons/icon-192.png" alt="" className="w-10 h-10 rounded-lg" />
            <div>
              <div className="font-display font-bold text-lg">{SITE.name}</div>
              <div className="text-xs text-on-surface-variant">{SITE.tagline}</div>
            </div>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center gap-2 text-primary-container">
              <ReceiptText size={20} />
              <h1 className="text-xl font-display font-bold">Квитанция об оплате</h1>
            </div>
            <p className="text-xs text-on-surface-variant mt-1">
              Подтверждение оплаты услуги публикации объявления
            </p>
          </div>

          {/* Сумма */}
          <div className="flex items-baseline justify-center gap-2 py-4 rounded-xl bg-primary-container/10 border border-primary-container/30">
            <span className="text-3xl font-display font-bold text-primary-container">
              {Number(data.amount).toLocaleString('ru-RU')}&nbsp;₽
            </span>
            <span className="text-sm text-on-surface-variant">оплачено</span>
          </div>

          {/* Детали */}
          <dl className="space-y-3 text-sm">
            <Row label="Услуга">Публикация объявления о поездке</Row>
            <Row label="Маршрут">{data.origin} → {data.destination}</Row>
            <Row label="Поездка (отправление)">{fmtDepart(data.departure_date, data.departure_time)}</Row>
            <Row label="Дата и время оплаты">{fmtDateTime(data.paid_at)}</Row>
            <Row label="Идентификатор операции">{data.operation_id || '—'}</Row>
            <Row label="Метка платежа">{data.label}</Row>
            <Row label="Получатель">Сервис «{SITE.name}»</Row>
            <Row label="Способ оплаты">Банковская карта (платёжная система ЮMoney)</Row>
          </dl>

          <div className="pt-4 border-t border-outline-variant/20 text-[11px] leading-relaxed text-on-surface-variant">
            Документ является подтверждением оплаты услуги публикации объявления на сервисе {SITE.name}
            и не является фискальным чеком. Сервис предоставляет информационную площадку и не является
            перевозчиком. По вопросам оплаты и возврата: {SITE.email}.
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-on-surface-variant shrink-0">{label}</dt>
      <dd className="text-on-surface font-medium text-right break-words">{children}</dd>
    </div>
  );
}
