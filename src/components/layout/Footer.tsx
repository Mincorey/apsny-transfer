import React from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../../lib/siteInfo';

const links = [
  { to: '/about', label: 'О проекте' },
  { to: '/paid-services', label: 'Платные услуги' },
  { to: '/contacts', label: 'Контакты' },
  { to: '/privacy', label: 'Политика конфиденциальности' },
  { to: '/terms', label: 'Условия использования' },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-white/5 mt-16 bg-surface/40">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
          <div className="max-w-xs">
            <Link to="/" className="flex items-center gap-2 mb-3">
              <img src="/icons/icon-192.png" alt="" className="w-6 h-6 rounded-md" />
              <span className="font-display text-base font-bold text-[#00f0ff] tracking-tight">
                {SITE.name}
              </span>
            </Link>
            <p className="text-sm text-on-surface-variant leading-relaxed">{SITE.tagline}.</p>
          </div>

          <nav className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-2">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-8 pt-6 border-t border-white/5 text-xs text-outline">
          © {year} {SITE.name}. Все права защищены.
        </div>
      </div>
    </footer>
  );
}
