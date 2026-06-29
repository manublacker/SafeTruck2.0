-- Distingue el origen de un viaje:
--   'company'  -> lo asignó la empresa (admin) al conductor   [valor por defecto]
--   'personal' -> lo armó el propio conductor al navegar/simular una ruta suya
--
-- Aditivo y seguro: las filas existentes quedan como 'company'. Postgres agrega
-- la columna con default sin reescribir la tabla. Idempotente (IF NOT EXISTS).
ALTER TABLE assigned_trips
  ADD COLUMN IF NOT EXISTS trip_source TEXT NOT NULL DEFAULT 'company';
