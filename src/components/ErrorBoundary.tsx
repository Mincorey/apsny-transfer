import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Глобальный перехватчик рантайм-ошибок React. Без него любое необработанное
 * исключение в рендере обрушивает весь экран в белый. Здесь показываем
 * аккуратный экран с предложением перезагрузить.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary поймал ошибку:', error, info);
    }
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.assign('/');
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/25 flex items-center justify-center text-3xl">
            ⚠️
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-display font-bold text-on-surface">Что-то пошло не так</h1>
            <p className="text-sm text-on-surface-variant max-w-sm">
              Произошла непредвиденная ошибка. Попробуйте обновить страницу — обычно это помогает.
            </p>
          </div>
          <button
            onClick={this.handleReload}
            className="px-6 py-3 rounded-xl btn-mesh font-bold text-white"
          >
            Обновить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
