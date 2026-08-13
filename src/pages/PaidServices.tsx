import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  CreditCard,
  CheckCircle2,
  ShieldCheck,
  Receipt,
  RefreshCcw,
  Mail,
} from 'lucide-react';
import { SITE, mailtoUrl } from '../lib/siteInfo';
import { PUBLICATION_PRICE } from '../lib/publishRide';

const STEPS = [
  {
    n: '1',
    t: 'Регистрация',
    d: 'Услуга доступна только зарегистрированным пользователям. Зарегистрируйтесь и выберите роль — водитель или пассажир.',
  },
  {
    n: '2',
    t: 'Создание поездки',
    d: 'Заполните маршрут (например, Сочи → Сухум), дату и время отправления, начальную цену и количество мест.',
  },
  {
    n: '3',
    t: `Публикация — ${PUBLICATION_PRICE} ₽ (сейчас бесплатно)`,
    d: `За размещение объявления предусмотрена фиксированная плата ${PUBLICATION_PRICE} ₽. Оплата производится онлайн банковской картой или через СБП с помощью платёжной системы ЮMoney. На время подключения ЮMoney публикация временно бесплатна: плата не взимается, платёжные данные не запрашиваются.`,
  },
  {
    n: '4',
    t: 'Публикация и аукцион',
    d: 'После публикации поездка появляется в общей ленте и становится доступной для ставок других участников.',
  },
];

function InfoCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card rounded-2xl p-5 space-y-2">
      <div className="flex items-center gap-3">
        <div className="text-primary-container shrink-0">{icon}</div>
        <div className="font-display font-semibold text-on-surface text-sm">{title}</div>
      </div>
      <p className="text-sm text-on-surface-variant leading-relaxed">{children}</p>
    </div>
  );
}

export function PaidServices() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-on-surface-variant hover:text-on-surface mb-8 transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          Назад
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="space-y-8"
        >
          {/* Header */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl sm:text-4xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-container to-secondary-container">
              Платные услуги
            </h1>
            <p className="text-on-surface-variant">
              Описание платной услуги сервиса {SITE.name} и порядок оплаты
            </p>
          </div>

          {/* What the service is */}
          <div className="glass-panel rounded-2xl p-6 space-y-3">
            <h2 className="text-xl font-display font-semibold text-on-surface">
              О сервисе
            </h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {SITE.name} — это онлайн-площадка для организации совместных поездок по
              маршрутам Россия ↔ Абхазия. Сервис сводит между собой водителей и пассажиров:
              одни размещают объявления о поездках, другие участвуют в аукционе и
              договариваются о цене напрямую. Сам сервис не оказывает услуги перевозки и
              не является перевозчиком — он предоставляет информационную площадку для
              размещения объявлений и проведения аукциона между пользователями.
            </p>
          </div>

          {/* The paid service */}
          <div className="glass-panel rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <CreditCard size={24} className="text-primary-container shrink-0" />
              <h2 className="text-xl font-display font-semibold text-on-surface">
                За что взимается плата
              </h2>
            </div>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Единственная платная услуга на сайте — <strong className="text-on-surface">платная
              публикация объявления о поездке</strong>. За размещение одной созданной поездки в
              общей ленте сервиса взимается фиксированная плата:
            </p>
            <div className="flex items-baseline justify-center gap-2 py-4 rounded-xl bg-primary-container/10 border border-primary-container/30">
              <span className="text-4xl font-display font-bold text-primary-container">100&nbsp;₽</span>
              <span className="text-sm text-on-surface-variant">за одну публикацию</span>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl bg-[#00e290]/10 border border-[#00e290]/30 px-4 py-3 text-sm text-[#00e290]">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <span>
                Сейчас публикация поездок <strong>временно бесплатна</strong> — на период
                подключения платёжной системы ЮMoney. Плата не взимается и платёжные данные
                не запрашиваются. Плата 100&nbsp;₽ начнёт взиматься после подключения, о чём
                мы сообщим заранее.
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                'Плата взимается за публикацию каждого отдельного объявления о поездке.',
                'Услуга доступна как водителям (объявления «Я ВЕЗУ»), так и пассажирам (объявления «Я ЕДУ»).',
                'Воспользоваться услугой могут только зарегистрированные и авторизованные пользователи.',
                `Стоимость фиксированная — ${PUBLICATION_PRICE} ₽ за одно объявление, независимо от маршрута и даты.`,
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-on-surface-variant leading-relaxed">
                  <CheckCircle2 size={16} className="text-primary-container shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* How it works */}
          <div>
            <h2 className="text-xl font-display font-semibold text-on-surface mb-4">
              Как происходит оплата
            </h2>
            <div className="space-y-3">
              {STEPS.map(({ n, t, d }) => (
                <div key={n} className="glass-panel rounded-xl px-4 py-3 flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary-container/20 border border-primary-container/30 flex items-center justify-center shrink-0 text-primary-container font-display font-bold text-sm">
                    {n}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-on-surface">{t}</div>
                    <div className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">{d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoCard icon={<Receipt size={20} />} title="Способ оплаты">
              Оплата производится онлайн банковской картой или через СБП с помощью
              платёжной системы ЮMoney. Реквизиты вводятся на стороне платёжной
              системы и сервису не передаются.
            </InfoCard>
            <InfoCard icon={<ShieldCheck size={20} />} title="Безопасность">
              Все платежи проходят по защищённому соединению. {SITE.name} не хранит
              реквизиты банковских карт пользователей.
            </InfoCard>
            <InfoCard icon={<CheckCircle2 size={20} />} title="Что вы получаете">
              Ваше объявление о поездке публикуется в ленте сервиса и становится
              доступным для участия в аукционе другим пользователям.
            </InfoCard>
            <InfoCard icon={<RefreshCcw size={20} />} title="Возврат средств">
              Если по техническим причинам объявление не было опубликовано, оплата
              возвращается в полном объёме. Запрос на возврат направляйте на электронную
              почту поддержки.
            </InfoCard>
          </div>

          {/* Contact */}
          <div className="glass-panel rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <div className="font-display font-semibold text-on-surface">Вопросы по оплате?</div>
              <div className="text-sm text-on-surface-variant mt-0.5">
                Напишите нам — поможем с оплатой и возвратом
              </div>
            </div>
            <a
              href={mailtoUrl}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-card border border-primary-container/30 text-primary-container text-sm font-medium hover:bg-primary-container/10 transition-colors"
            >
              <Mail size={15} />
              {SITE.email}
            </a>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
