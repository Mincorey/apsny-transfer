import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Star, X, Send, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ReviewModalProps {
  rideId: string;
  targetId: string;
  targetName: string;
  onClose: () => void;
  onDone: () => void;
}

const ratingLabels = ['', 'Плохо', 'Ниже среднего', 'Нормально', 'Хорошо', 'Отлично'];

export function ReviewModal({ rideId, targetId, targetName, onClose, onDone }: ReviewModalProps) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    if (rating === 0) {
      setError('Выберите оценку от 1 до 5 звёзд');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('submit_review', {
        p_ride_id: rideId,
        p_target_id: targetId,
        p_rating: rating,
        p_comment: comment.trim() || null,
      });
      if (rpcError) throw rpcError;
      setSuccess(true);
      setTimeout(onDone, 1500);
    } catch (err: any) {
      setError(err.message ?? 'Ошибка при отправке отзыва');
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-sm glass-card rounded-3xl p-6 relative"
      >
        <button
          onClick={onClose}
          aria-label="Закрыть окно отзыва"
          className="absolute top-4 right-4 p-1.5 rounded-xl text-outline hover:text-on-surface hover:bg-white/5 transition-all"
        >
          <X size={18} />
        </button>

        <AnimatePresence mode="wait">
          {success ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-8 text-center"
            >
              <CheckCircle size={52} className="text-green-400" />
              <div className="text-xl font-bold font-display">Отзыв отправлен!</div>
              <div className="text-sm text-on-surface-variant">Спасибо за оценку поездки</div>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="text-lg font-display font-bold mb-1">Оценить поездку</div>
              <div className="text-sm text-on-surface-variant mb-6">
                Ваш отзыв о{' '}
                <span className="text-on-surface font-medium">{targetName}</span>
              </div>

              {/* Stars */}
              <div className="flex gap-2 justify-center mb-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onMouseEnter={() => setHovered(star)}
                    onMouseLeave={() => setHovered(0)}
                    onClick={() => { setRating(star); setError(null); }}
                    className="transition-transform hover:scale-115 active:scale-95"
                  >
                    <Star
                      size={38}
                      className={
                        star <= (hovered || rating)
                          ? 'text-yellow-400 fill-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]'
                          : 'text-outline'
                      }
                    />
                  </button>
                ))}
              </div>

              <div className="h-5 text-center text-sm text-on-surface-variant mb-4">
                {rating > 0 && ratingLabels[rating]}
              </div>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Комментарий (необязательно)..."
                className="w-full input-glass rounded-xl p-3 text-sm resize-none h-24 mb-4"
                maxLength={500}
              />

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-red-400 text-sm mb-3"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl border border-outline-variant/50 text-on-surface-variant text-sm hover:bg-white/5 transition-colors"
                >
                  Позже
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || rating === 0}
                  className="flex-1 py-3 rounded-xl btn-mesh text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Send size={14} />
                      Отправить
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body
  );
}
