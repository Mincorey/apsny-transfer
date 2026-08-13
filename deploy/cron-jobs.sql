-- Задачи pg_cron. Дампом они НЕ переносятся — расписания живут в служебной
-- базе cron, которой в дампе public-схемы нет. Выполнить после восстановления.
--
-- Расписания и команды сняты с боевой базы 13.08.2026. Проверено там же:
-- у всех четырёх задач ноль неуспешных запусков за всё время
-- (у закрытия аукционов — 131 708 успешных подряд).

create extension if not exists pg_cron;

-- Закрытие истёкших аукционов. Раз в минуту — это и есть тот механизм,
-- который назначает победителя и рассылает уведомления, когда время вышло.
select cron.schedule('close-expired-auctions', '* * * * *',
                     $$select public.close_expired_auctions()$$);

-- Перевод состоявшихся поездок в «завершена» через сутки после выезда.
select cron.schedule('auto-complete-expired-rides', '0 * * * *',
                     $$select public.auto_complete_expired_rides()$$);

-- Чистка старых записей. Без неё таблица уведомлений растёт вечно: на
-- замерах она занимала 43% всей базы.
select cron.schedule('retention-cleanup', '0 3 * * *',
                     $$select public.run_retention_cleanup()$$);

-- Удаление неоплаченных черновиков.
select cron.schedule('cleanup-unpaid-drafts', '7 * * * *',
                     $$select public.cleanup_unpaid_drafts()$$);

-- ВНИМАНИЕ: process_expired_auctions() НЕ восстанавливать. Это был дословный
-- дубль close_expired_auctions, обе задачи запускались одновременно каждую
-- минуту — 115 191 лишний запуск. Функция удалена из базы 10.08.2026
-- (аудит, п. 2.5). Если встретится в старом дампе — не создавать.

select jobid, jobname, schedule, active from cron.job order by jobid;
