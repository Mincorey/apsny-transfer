import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Route, LogIn, Car, Users } from 'lucide-react';
import { Footer } from './Footer';

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 md:px-12 h-16 bg-surface/80 backdrop-blur-2xl border-b border-white/5 shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
        <Link to="/login" className="flex items-center gap-2">
          <img src="/icons/icon-192.png" alt="" className="w-7 h-7 rounded-lg" />
          <span className="font-display text-lg font-bold text-[#00f0ff] tracking-tight">APSNY-TRANSFER</span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link
            to="/rides/passenger"
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-bold uppercase tracking-wider transition-all border ${
              pathname === '/rides/passenger'
                ? 'border-[#00f0ff]/70 text-[#00f0ff] bg-[#00f0ff]/15'
                : 'border-[#00f0ff]/25 text-[#00f0ff]/60 hover:border-[#00f0ff]/50 hover:text-[#00f0ff] hover:bg-[#00f0ff]/10'
            }`}
          >
            <Users size={13} />
            Я ЕДУ
          </Link>
          <Link
            to="/rides/driver"
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-bold uppercase tracking-wider transition-all border ${
              pathname === '/rides/driver'
                ? 'border-[#7701d0]/70 text-[#b47aff] bg-[#7701d0]/15'
                : 'border-[#7701d0]/25 text-[#b47aff]/60 hover:border-[#7701d0]/50 hover:text-[#b47aff] hover:bg-[#7701d0]/10'
            }`}
          >
            <Car size={13} />
            Я ВЕЗУ
          </Link>
        </nav>

        <Link
          to="/login"
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-surface-container hover:bg-white/10 border border-white/10 transition-colors"
        >
          <LogIn size={15} />
          Войти
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-8 pt-24 pb-12">
        {children}
      </main>

      <Footer />
    </div>
  );
}
