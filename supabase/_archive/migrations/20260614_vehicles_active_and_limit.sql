-- Активное авто водителя + лимит на количество авто (макс. 3).
-- 2026-06-14

-- 1. Колонка активного авто
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

-- 2. Каждому водителю отметим самое старое авто активным,
--    если у него ещё нет активного.
WITH ranked AS (
  SELECT id, driver_id,
         ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY created_at ASC) AS rn
  FROM public.vehicles
), need_active AS (
  SELECT driver_id FROM public.vehicles
  GROUP BY driver_id
  HAVING bool_or(is_active) = false
)
UPDATE public.vehicles v
SET is_active = true
FROM ranked r
WHERE v.id = r.id
  AND r.rn = 1
  AND v.driver_id IN (SELECT driver_id FROM need_active);

-- 3. Только одно активное авто на водителя.
CREATE OR REPLACE FUNCTION public.enforce_single_active_vehicle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active THEN
    UPDATE public.vehicles
       SET is_active = false
     WHERE driver_id = NEW.driver_id
       AND id <> NEW.id
       AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_active_vehicle ON public.vehicles;
CREATE TRIGGER trg_single_active_vehicle
AFTER INSERT OR UPDATE OF is_active ON public.vehicles
FOR EACH ROW
WHEN (NEW.is_active = true)
EXECUTE FUNCTION public.enforce_single_active_vehicle();

-- 4. Не более 3 авто на водителя.
CREATE OR REPLACE FUNCTION public.enforce_vehicle_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt integer;
BEGIN
  SELECT count(*) INTO cnt FROM public.vehicles WHERE driver_id = NEW.driver_id;
  IF cnt >= 3 THEN
    RAISE EXCEPTION 'VEHICLE_LIMIT_REACHED'
      USING HINT = 'Можно добавить не более 3 автомобилей';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_limit ON public.vehicles;
CREATE TRIGGER trg_vehicle_limit
BEFORE INSERT ON public.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_vehicle_limit();

-- 5. Триггерные функции не должны быть вызываемы через REST API.
REVOKE EXECUTE ON FUNCTION public.enforce_single_active_vehicle() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_vehicle_limit() FROM PUBLIC, anon, authenticated;
