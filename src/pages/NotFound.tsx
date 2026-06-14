import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';

export function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="text-center"
      >
        <div className="text-[128px] font-display font-bold leading-none mb-2 text-transparent bg-clip-text bg-gradient-to-br from-primary-container to-secondary-container select-none">
          404
        </div>
        <h1 className="text-2xl font-display font-semibold text-on-surface mb-2">
          Страница не найдена
        </h1>
        <p className="text-on-surface-variant mb-8 max-w-xs mx-auto text-sm leading-relaxed">
          Похоже, эта страница уехала без вас.
        </p>
        <Link
          to="/"
          className="btn-mesh inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm"
        >
          <ArrowLeft size={16} />
          На главную
        </Link>
      </motion.div>
    </div>
  );
}
