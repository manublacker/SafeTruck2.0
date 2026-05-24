-- =============================================================================
-- 001_init_fleet.sql
--
-- Cierra el desfasaje entre el código backend (commit 056fe7b) y el schema
-- actual de Supabase:
--
--   1. Backfill de public.users desde auth.users (estaban faltando 8 de 10).
--      trucks.user_id tiene FK a public.users(id); sin row el INSERT da 500.
--   2. Trigger AFTER INSERT en auth.users para mantenerlo en sync.
--   3. Crea las tablas drivers y truck_drivers (no existían).
--
-- Idempotente: se puede correr múltiples veces sin romper.
-- =============================================================================

-- 1. Backfill de public.users -------------------------------------------------
INSERT INTO public.users (id, email, full_name, company)
SELECT
  au.id,
  au.email,
  COALESCE(NULLIF(TRIM(au.raw_user_meta_data->>'full_name'), ''), au.email) AS full_name,
  NULLIF(TRIM(au.raw_user_meta_data->>'company'), '') AS company
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 2. Trigger para auto-crear public.users en nuevos signups -------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, company)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), NEW.email),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'company'), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 3. Tabla drivers ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drivers (
  id                   SERIAL      PRIMARY KEY,
  user_id              UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  nombre               TEXT        NOT NULL,
  telefono             TEXT,
  licencia             TEXT,
  categoria_licencia   TEXT,
  vencimiento_licencia DATE,
  estado               TEXT        NOT NULL DEFAULT 'Activo',
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drivers_user_active
  ON public.drivers (user_id) WHERE is_active = TRUE;

-- 4. Tabla truck_drivers ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.truck_drivers (
  truck_id   INTEGER NOT NULL REFERENCES public.trucks(id)  ON DELETE CASCADE,
  driver_id  INTEGER NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (truck_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_truck_drivers_truck
  ON public.truck_drivers (truck_id);
