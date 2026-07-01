-- =============================================================================
-- 003_maintenance.sql
--
-- Módulo de Mantenimiento y Vencimientos.
--
-- Crea la tabla maintenance_records: el HISTORIAL de servicios/reparaciones de
-- cada camión (un camión tiene muchos registros). No altera ninguna tabla
-- existente: trucks ya tiene fecha_service / proximo_service / km_actual y
-- drivers ya tiene vencimiento_licencia, así que las alertas se calculan sobre
-- columnas que ya existen. 100% aditivo.
--
-- Idempotente: se puede correr múltiples veces sin romper (IF NOT EXISTS).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.maintenance_records (
  id             SERIAL      PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  truck_id       INTEGER     NOT NULL REFERENCES public.trucks(id) ON DELETE CASCADE,
  -- Tipo de intervención. Se valida también en el backend (ALLOWED_TIPOS).
  tipo           TEXT        NOT NULL DEFAULT 'service',
  fecha          DATE        NOT NULL,
  km_al_service  INTEGER,
  costo          NUMERIC,
  taller         TEXT,
  notas          TEXT,
  -- Próximo mantenimiento sugerido (por fecha y/o por kilómetros).
  proximo_km     INTEGER,
  proximo_fecha  DATE,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Los listados filtran por dueño y por camión, y ordenan por fecha.
CREATE INDEX IF NOT EXISTS idx_maintenance_user_active
  ON public.maintenance_records (user_id) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_maintenance_truck
  ON public.maintenance_records (truck_id) WHERE is_active = TRUE;
