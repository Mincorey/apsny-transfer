-- Аудит 29.09.2026, пункт В-1, шаг 1 из 2.
--
-- Госномер автомобиля должен видеть только сам владелец. Сейчас он читается
-- кем угодно, даже без входа: GET /rest/v1/vehicles?select=license_plate.
-- Закрываем так же, как 13.06 закрыли телефоны: права на колонку снимаем,
-- а владельцу отдаём его машины через функцию.
--
-- Шаг 1 (этот файл) только ДОБАВЛЯЕТ функцию и ничего не ломает — его можно
-- применять до выкладки нового фронтенда. Шаг 2 (права) — после выкладки,
-- иначе у водителей на старой версии сайта перестанет открываться профиль.

create or replace function public.get_my_vehicles()
returns setof public.vehicles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Без входа auth.uid() пустой, условие не выполнится ни для одной строки.
  select v.*
  from public.vehicles v
  where v.driver_id = auth.uid()
  order by v.created_at;
$$;

revoke all on function public.get_my_vehicles() from public, anon;
grant execute on function public.get_my_vehicles() to authenticated;
