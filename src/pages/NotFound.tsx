import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';

export function NotFound() {
  /*
    Запрет на индексацию этой страницы.

    Зачем это нужно. Обычный сайт на несуществующий адрес отвечает кодом 404 —
    и поисковик такой адрес просто не берёт в индекс. Здесь одностраничное
    приложение: сервер на любой путь отдаёт index.html с кодом 200 «всё
    хорошо», а решение «такой страницы нет» принимает уже сам браузер, когда
    отработает разметку. Для поисковика это «мягкий 404»: формально страница
    существует и отвечает успешно, а значит любой мусорный адрес — опечатка в
    чужой ссылке, старый адрес, подставленный кем-то хвост — может осесть в
    индексе как настоящая страница сайта. Вдобавок скрипт канонического адреса
    честно проставит такому мусору канонический тег на самого себя.

    Тег robots=noindex решает это на стороне браузера: поисковик разметку
    выполняет, тег видит и страницу в индекс не берёт. Убирается при уходе со
    страницы — иначе запрет остался бы висеть на следующей открытой странице,
    ведь <head> в одностраничном приложении общий для всех маршрутов.
  */
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, follow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

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

        {/*
          Второй ряд ссылок. Раньше со страницы 404 уйти можно было ровно одной
          кнопкой — на главную. Человек, попавший сюда по битой ссылке, терял
          вообще всю навигацию: ни ленты, ни своих поездок, ни профиля.
          Полноценное меню сюда не ставим (страница открывается и неавторизованным),
          но основные разделы перечисляем.
        */}
        <nav aria-label="Основные разделы" className="mt-8 pt-6 border-t border-outline-variant/20">
          <p className="text-xs text-outline mb-3">Может быть, вам сюда:</p>
          <div className="flex items-center justify-center gap-x-5 gap-y-2 flex-wrap text-sm">
            <Link to="/" className="text-on-surface-variant hover:text-on-surface transition-colors">Лента</Link>
            <Link to="/my-trips" className="text-on-surface-variant hover:text-on-surface transition-colors">Мои поездки</Link>
            <Link to="/ratings" className="text-on-surface-variant hover:text-on-surface transition-colors">Рейтинги</Link>
            <Link to="/profile" className="text-on-surface-variant hover:text-on-surface transition-colors">Профиль</Link>
            <Link to="/about" className="text-on-surface-variant hover:text-on-surface transition-colors">О проекте</Link>
          </div>
        </nav>
      </motion.div>
    </div>
  );
}
