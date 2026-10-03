-- Аудит 29.09.2026, пункт С-21: журнал запусков pg_cron занимал 79 % базы.
--
-- cron.job_run_details получает строку на каждый запуск каждой задачи.
-- Закрытие аукционов идёт раз в минуту — это 1 440 строк в сутки, и их
-- никто не удалял: на 29.09 было 319 537 строк и 50 МБ из 63 МБ базы.
-- Данных сервиса на этом фоне — килобайты; бэкапы в основном состояли бы
-- из журнала.
--
-- Неделя истории — с запасом для разбора любого сбоя.

select cron.unschedule('cleanup-cron-history')
where exists (select 1 from cron.job where jobname = 'cleanup-cron-history');

select cron.schedule(
  'cleanup-cron-history',
  '30 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);

-- Разовая чистка накопленного. Место освободится для новых строк сразу;
-- чтобы вернуть его файловой системе, можно позже выполнить
-- VACUUM FULL cron.job_run_details (вне транзакции, в SQL Editor).
delete from cron.job_run_details where end_time < now() - interval '7 days';
