-- Аудит 29.09.2026, пункт В-1, шаг 2 из 2.
--
-- ПРИМЕНЯТЬ ТОЛЬКО ПОСЛЕ ВЫКЛАДКИ ФРОНТЕНДА, в котором Profile.tsx и
-- CreateTrip.tsx читают машины через get_my_vehicles() (шаг 1). Старый
-- фронтенд делает select('*') по vehicles и после этого файла получит
-- «permission denied».
--
-- Что делаем:
--   • снимаем табличный SELECT и возвращаем его по списку колонок — всем,
--     кроме license_plate. Номер остаётся доступен только владельцу через
--     get_my_vehicles();
--   • у anon забираем INSERT и UPDATE: их и так гасили политики (без входа
--     auth.uid() пустой), но права без смысла — это мусор, который однажды
--     сработает не так, как ждёшь.
-- INSERT/UPDATE/DELETE у authenticated не трогаем: владелец добавляет и
-- правит свои машины, границы задают политики vehicles_*_own.

revoke all on public.vehicles from anon;
revoke select on public.vehicles from authenticated;

grant select (id, driver_id, make_model, capacity, photo_url, is_active, created_at)
  on public.vehicles to anon, authenticated;

-- Проверка (должно вернуть false, true, true):
--   select has_column_privilege('anon', 'public.vehicles', 'license_plate', 'select'),
--          has_column_privilege('anon', 'public.vehicles', 'make_model',    'select'),
--          has_function_privilege('authenticated', 'public.get_my_vehicles()', 'execute');
