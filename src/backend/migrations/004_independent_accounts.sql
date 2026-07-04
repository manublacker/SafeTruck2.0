-- 004_independent_accounts.sql
--
-- Soporte de cuentas de camionero independiente ("empresa de uno").
--
-- El modelo no necesita tablas nuevas: el independiente es una fila de
-- drivers con user_id = app_user_id = su propio usuario, creada por
-- POST /api/auth/independent-setup. Lo único que falta en el esquema es el
-- marcador explícito de rol en profiles.
--
-- ⚠️ Esta migración corre en SUPABASE (SQL editor del dashboard), no en Aiven:
-- profiles vive en Supabase. En Aiven no hay cambios (users.role y
-- drivers.app_user_id ya existen en producción).
--
-- Nota: la app móvil ya intentaba escribir profiles.role = 'driver' en el
-- registro (app/auth/register.tsx); sin esta columna ese upsert venía
-- fallando silenciosamente, así que esto también arregla ese bug latente.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text;
