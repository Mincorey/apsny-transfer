import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Route, ArrowLeft } from 'lucide-react';
import { Footer } from './Footer';

/**
 * Обёртка для публичных информационных/юридических страниц
 * (О проекте, Контакты, Политика, Условия): шапка с логотипом и кнопкой
 * «Назад», контейнер контента и общий футер. Доступна без авторизации —
 * модераторы платёжной системы и поисковики видят страницы напрямую.
 */
export function InfoLayout({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col">
      <header className="sticky top-0 z-40 flex justify-between items-center px-4 md:px-8 h-16 bg-surface/80 backdrop-blur-2xl border-b border-white/5">
        <Link to="/" className="flex items-center gap-2">
          <img src="/icons/icon-192.png" alt="" className="w-6 h-6 rounded-md" />
          <span className="font-display text-base font-bold text-[#00f0ff] tracking-tight">APSNY-TRANSFER</span>
        </Link>
        <button
          onClick={() => (window.history.length > 2 ? navigate(-1) : navigate('/'))}
          className="flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={16} />
          Назад
        </button>
      </header>

      <main className="flex-1 w-full">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
          <h1 className="text-3xl font-display font-bold mb-2">{title}</h1>
          {subtitle && <p className="text-on-surface-variant mb-8">{subtitle}</p>}
          {!subtitle && <div className="mb-8" />}
          <div className="space-y-6 leading-relaxed text-on-surface-variant">
            {children}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

/** Заголовок раздела внутри инфо-страницы. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold text-on-surface">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
