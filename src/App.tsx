/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { MainLayout } from './components/layout/MainLayout';
import { PublicLayout } from './components/layout/PublicLayout';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { Session } from '@supabase/supabase-js';

const Auth = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Auth })));
const Feed = lazy(() => import('./pages/Feed').then((m) => ({ default: m.Feed })));
const CreateTrip = lazy(() => import('./pages/CreateTrip').then((m) => ({ default: m.CreateTrip })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const TripDetail = lazy(() => import('./pages/TripDetail').then((m) => ({ default: m.TripDetail })));
const UserProfile = lazy(() => import('./pages/UserProfile').then((m) => ({ default: m.UserProfile })));
const Ratings = lazy(() => import('./pages/Ratings').then((m) => ({ default: m.Ratings })));
const MyTrips = lazy(() => import('./pages/MyTrips').then((m) => ({ default: m.MyTrips })));
const About = lazy(() => import('./pages/About').then((m) => ({ default: m.About })));
const Payment = lazy(() => import('./pages/Payment').then((m) => ({ default: m.Payment })));
const Receipt = lazy(() => import('./pages/Receipt').then((m) => ({ default: m.Receipt })));
const PaidServices = lazy(() => import('./pages/PaidServices').then((m) => ({ default: m.PaidServices })));
const Contacts = lazy(() => import('./pages/Contacts').then((m) => ({ default: m.Contacts })));
const Privacy = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./pages/Terms').then((m) => ({ default: m.Terms })));
const Offer = lazy(() => import('./pages/Offer').then((m) => ({ default: m.Offer })));
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));

/**
 * Держит <link rel="canonical"> в актуальном состоянии при переходах.
 *
 * В обычном сайте канонический адрес пишется в разметку каждой страницы.
 * Здесь одностраничное приложение: index.html один на все маршруты, и без
 * этого компонента тег навсегда остался бы со значением главной — то есть
 * сообщал бы поисковику, что /trips/123, /about и /offer это одна и та же
 * страница. Внутренние разделы выпали бы из индекса.
 *
 * Адрес берётся из location.origin, а не зашит константой: после переезда
 * на собственный домен (MOVING_CHECKLIST.md) править ничего не придётся.
 * Обратная сторона такого решения — если сайт останется доступен сразу по
 * двум адресам (домен vercel и свой домен), каждый из них будет считать
 * каноническим себя. На время переезда со старого адреса нужен редирект,
 * а не два живых зеркала.
 */
function Canonical() {
  const { pathname } = useLocation();

  useEffect(() => {
    const path = pathname.replace(/\/+$/, '') || '/';
    let el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!el) {
      el = document.createElement('link');
      el.rel = 'canonical';
      document.head.appendChild(el);
    }
    el.href = window.location.origin + path;
  }, [pathname]);

  return null;
}

function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-primary-container border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <PageLoader />;
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Canonical />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public standalone routes */}
              <Route path="/trips/:id" element={<TripDetail />} />
              <Route path="/about" element={<About />} />
              <Route path="/payment" element={<Payment />} />
              <Route path="/receipt/:rideId" element={<Receipt />} />
              <Route path="/paid-services" element={<PaidServices />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/offer" element={<Offer />} />
              <Route
                path="/rides/passenger"
                element={<PublicLayout><Feed feedType="offer" /></PublicLayout>}
              />
              <Route
                path="/rides/driver"
                element={<PublicLayout><Feed feedType="request" /></PublicLayout>}
              />
              {/*
                Главная страница.

                До 12.08.2026 адрес «/» был доступен только тем, кто вошёл, а
                гостя мгновенно перебрасывало на «/login». Выглядело безобидно,
                но означало, что у сайта нет главной страницы: поисковый робот —
                всегда гость, он приходил на «/», получал переадресацию и
                индексировал содержимое под адресом «/login». При этом
                sitemap.xml подавал «/» с наивысшим приоритетом, а страница
                входа — это как раз посадочная страница со всей рекламой
                сервиса. То есть главная у сайта была, но под чужим именем.

                Теперь «/» отдаёт гостю ту же самую посадочную страницу (форма
                входа на ней же, ниже по прокрутке), а вошедшему — ленту. Для
                пользователя ничего не изменилось, для поисковика появилась
                нормальная главная. Разбор — в ПРОВЕРИТЬ.md, раздел C2-бис.
              */}
              <Route
                path="/"
                element={session ? <MainLayout /> : <Auth />}
              >
                <Route index element={<Feed />} />
              </Route>

              {/*
                Старый адрес входа. Оставлен живым и ведёт на «/»: на него
                ссылались одиннадцать мест в коде, он мог осесть в закладках и
                в индексе поисковика. Отдавать по нему ту же страницу, что и по
                «/», нельзя — это два адреса с одинаковым содержимым, и
                поисковик считает такое дублем.
              */}
              <Route path="/login" element={<Navigate to="/" replace />} />

              {/* Authenticated routes (MainLayout) */}
              <Route element={session ? <MainLayout /> : <Navigate to="/" replace />}>
                <Route path="/create" element={<CreateTrip />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/users/:id" element={<UserProfile />} />
                <Route path="/ratings" element={<Ratings />} />
                <Route path="/my-trips" element={<MyTrips />} />
              </Route>

              {/* 404 for all unmatched paths */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <PWAInstallPrompt />
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}
