import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Users, Car, Trophy, Star, ShieldCheck } from 'lucide-react';
import { InfoLayout, Section } from '../components/layout/InfoLayout';
import { SITE } from '../lib/siteInfo';

const FAQ_ITEMS = [
  {
    q: 'Что такое APSNY-TRANSFER?',
    a: 'Это онлайн-агрегатор трансферов между Абхазией и Россией. Пассажиры и водители размещают поездки и через аукцион находят лучшую цену, после чего напрямую договариваются о деталях.',
  },
  {
    q: 'Как работает аукцион?',
    a: 'Есть два сценария. «Я ВЕЗУ» — водитель публикует предложение, пассажиры повышают ставку за место. «Я ЕДУ» — пассажир публикует запрос, водители торгуются на понижение цены. Победитель определяется по таймеру или при досрочном закрытии создателем.',
  },
  {
    q: 'Когда открываются контакты?',
    a: 'Телефон, Telegram и WhatsApp скрыты до конца аукциона. Как только определён победитель, контакты открываются второй стороне сделки — дальше вы созваниваетесь и договариваетесь сами.',
  },
  {
    q: 'Сколько стоит пользоваться сервисом?',
    a: 'Регистрация и просмотр поездок бесплатны. Сервис взимает фиксированную плату за публикацию поездки — это и есть платная услуга площадки. Плата за сам проезд устанавливается между пассажиром и водителем напрямую.',
  },
  {
    q: 'Как оставить отзыв?',
    a: 'После завершённой поездки пассажир может поставить водителю оценку и комментарий. Это формирует рейтинг водителя и помогает другим пассажирам выбирать надёжных перевозчиков.',
  },
  {
    q: 'Как зарегистрироваться?',
    a: 'Нажмите «Войти», заполните контакты и пароль, выберите роль: пассажир или водитель. Водитель может добавить автомобиль в профиле.',
  },
];

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="font-medium text-on-surface">{q}</span>
        <ChevronDown
          size={18}
          className={`text-on-surface-variant shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <p className="px-5 pb-4 text-sm">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Step({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-10 h-10 rounded-xl bg-[#00f0ff]/10 border border-[#00f0ff]/25 flex items-center justify-center text-[#00f0ff] shrink-0">
        {icon}
      </div>
      <div>
        <div className="font-semibold text-on-surface">{title}</div>
        <div className="text-sm">{text}</div>
      </div>
    </div>
  );
}

export function About() {
  return (
    <InfoLayout title="О проекте" subtitle={SITE.tagline}>
      <p>
        <span className="text-on-surface font-medium">{SITE.name}</span> — это онлайн-площадка, которая
        помогает быстро и выгодно организовать трансфер между Абхазией и Россией (Сухум, Гагра, Пицунда,
        Новый Афон ↔ Сочи, Адлер, Краснодар и другие города). Сервис сводит пассажиров и водителей и
        через прозрачный аукцион помогает им найти честную цену за поездку. Сами перевозки Сервис не
        осуществляет — это информационный посредник.
      </p>

      <Section title="Как это работает">
        <Step
          icon={<Car size={18} />}
          title="1. Создайте поездку"
          text="Водитель размещает предложение «Я ВЕЗУ», пассажир — запрос «Я ЕДУ». Указываются маршрут, дата, время, число мест и стартовая цена."
        />
        <Step
          icon={<Users size={18} />}
          title="2. Аукцион и ставки"
          text="Вторая сторона делает ставки: водители — на понижение цены, пассажиры — на повышение. Всё видно в реальном времени."
        />
        <Step
          icon={<Trophy size={18} />}
          title="3. Победитель и контакты"
          text="По завершении аукциона определяется лучшая цена. Контакты сторон открываются друг другу — вы созваниваетесь и договариваетесь о деталях."
        />
        <Step
          icon={<Star size={18} />}
          title="4. Поездка и отзыв"
          text="После поездки создатель отмечает её завершённой, а пассажир оценивает водителя. Так формируется рейтинг надёжных перевозчиков."
        />
      </Section>

      <Section title="Платная услуга">
        <p>
          Регистрация, просмотр ленты и участие в аукционе — бесплатны. Сервис взимает фиксированную
          плату за публикацию поездки: это плата за размещение объявления на площадке и проведение
          аукциона. Стоимость отображается до оплаты. Плата за сам проезд (если она есть) — это
          договорённость между пассажиром и водителем напрямую; Сервис её не получает.
        </p>
      </Section>

      <Section title="Безопасность и доверие">
        <div className="flex gap-3">
          <ShieldCheck size={20} className="text-[#00e290] shrink-0 mt-0.5" />
          <p>
            Контакты скрыты до завершения аукциона и открываются только участникам сделки. Рейтинги и
            отзывы помогают выбирать проверенных водителей. Подробнее — в{' '}
            <Link to="/privacy" className="text-[#00f0ff] hover:underline">Политике конфиденциальности</Link>{' '}
            и <Link to="/terms" className="text-[#00f0ff] hover:underline">Условиях использования</Link>.
          </p>
        </div>
      </Section>

      <Section title="Частые вопросы">
        <div className="space-y-2">
          {FAQ_ITEMS.map((item) => (
            <FaqRow key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </Section>

      <div className="pt-2">
        <Link to="/login" className="inline-flex px-6 py-3 rounded-xl btn-mesh font-bold text-white">
          Начать — это бесплатно
        </Link>
      </div>
    </InfoLayout>
  );
}
