import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { InfoLayout } from '../components/layout/InfoLayout';

/**
 * Смена пароля по ссылке из письма (аудит 29.09.2026, пункт В-9).
 *
 * Ссылку отправляет «Забыли пароль?» на странице входа
 * (resetPasswordForEmail с redirectTo = /reset-password). Открыв её, клиент
 * Supabase сам разбирает токен из адреса и создаёт сессию восстановления
 * (событие PASSWORD_RECOVERY). Пока сессии нет, форма не показывается.
 *
 * Адрес /reset-password должен быть в списке Redirect URLs в настройках
 * Auth (Supabase Dashboard или GOTRUE_URI_ALLOW_LIST на своём сервере),
 * иначе GoTrue отправит человека на Site URL.
 */
export function ResetPassword() {
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        setState((s) => (s === 'done' ? s : 'ready'));
      }
    });
    // Если токена в адресе нет или он истёк — сессия так и не появится.
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && !data.session) setState((s) => (s === 'checking' ? 'invalid' : s));
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Пароль должен быть не короче 8 символов');
      return;
    }
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setState('done');
      window.setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : 'Не удалось сменить пароль');
    } finally {
      setSaving(false);
    }
  };

  return (
    <InfoLayout title="Новый пароль">
      {state === 'checking' && <p>Проверяем ссылку…</p>}

      {state === 'invalid' && (
        <p>
          Ссылка недействительна или устарела. Вернитесь на{' '}
          <a href="/" className="text-primary-container underline">страницу входа</a>, введите email
          и нажмите «Забыли пароль?» ещё раз.
        </p>
      )}

      {state === 'done' && <p className="text-on-surface font-medium">Пароль изменён. Входим…</p>}

      {state === 'ready' && (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          {error && (
            <div className="p-4 rounded-xl bg-error/10 border border-error/30 text-error text-sm font-medium">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="new-password" className="text-sm font-semibold text-on-surface">Новый пароль</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl input-glass text-on-surface"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="new-password-2" className="text-sm font-semibold text-on-surface">Повторите пароль</label>
            <input
              id="new-password-2"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="w-full px-4 py-3 rounded-xl input-glass text-on-surface"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded-xl btn-mesh font-bold text-white"
          >
            {saving ? 'Сохраняем…' : 'Сохранить пароль'}
          </button>
        </form>
      )}
    </InfoLayout>
  );
}
