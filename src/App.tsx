/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { MainLayout } from './components/layout/MainLayout';
import { PublicLayout } from './components/layout/PublicLayout';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Session } from '@supabase/supabase-js';

// Маршрутный code-splitting: каждая страница грузится отдельным чанком по мере
// перехода — меньше вес первой загрузки на мобильном/медленном интернете.
// Страницы — именованные экспорты, поэтому маппим их в default для React.lazy.
const Auth = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Auth })));
const Feed = lazy(() => import('./pages/Feed').then((m) => ({ default: m.Feed })));
const CreateTrip = lazy(() => import('./pages/CreateTrip').then((m) => ({ default: m.CreateTrip })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Messages = lazy(() => import('./pages/Messages').then((m) => ({ default: m.Messages })));
const Chat = lazy(() => import('./pages/Chat').then((m) => ({ default: m.Chat })));
const TripDetail = lazy(() => import('./pages/TripDetail').then((m) => ({ default: m.TripDetail })));
const UserProfile = lazy(() => import('./pages/UserProfile').then((m) => ({ default: m.UserProfile })));
const Ratings = lazy(() => import('./pages/Ratings').then((m) => ({ default: m.Ratings })));
const MyTrips = lazy(() => import('./pages/MyTrips').then((m) => ({ default: m.MyTrips })));
const Conversations = lazy(() => import('./pages/Conversations').then((m) => ({ default: m.Conversations })));
const DirectChat = lazy(() => import('./pages/DirectChat').then((m) => ({ default: m.DirectChat })));
const About = lazy(() => import('./pages/About').then((m) => ({ default: m.About })));
const Contacts = lazy(() => import('./pages/Contacts').then((m) => ({ default: m.Contacts })));
const Privacy = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./pages/Terms').then((m) => ({ default: m.Terms })));
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));

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
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public standalone routes */}
              <Route path="/trips/:id" element={<TripDetail />} />
              <Route path="/about" element={<About />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route
                path="/rides/passenger"
                element={<PublicLayout><Feed feedType="offer" /></PublicLayout>}
              />
              <Route
                path="/rides/driver"
                element={<PublicLayout><Feed feedType="request" /></PublicLayout>}
              />
              <Route
                path="/login"
                element={!session ? <Auth /> : <Navigate to="/" replace />}
              />

              {/* Authenticated routes (MainLayout) */}
              <Route element={session ? <MainLayout /> : <Navigate to="/login" replace />}>
                <Route path="/" element={<Feed />} />
                <Route path="/create" element={<CreateTrip />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/messages/:rideId" element={<Chat />} />
                <Route path="/conversations" element={<Conversations />} />
                <Route path="/conversations/:conversationId" element={<DirectChat />} />
                <Route path="/users/:id" element={<UserProfile />} />
                <Route path="/ratings" element={<Ratings />} />
                <Route path="/my-trips" element={<MyTrips />} />
              </Route>

              {/* 404 for all unmatched paths (authenticated and unauthenticated) */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}
