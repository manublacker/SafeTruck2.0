-- =============================================================================
-- 005_alert_notifications.sql
--
-- Dedupe de las alertas push de mantenimiento/licencia. Registra cada aviso ya
-- enviado a un conductor para no repetirlo en cada corrida del job diario.
--
-- La clave única (driver, kind, phase, target_date) garantiza como mucho 2
-- pushes por vencimiento: 'warn' (al entrar en los 30 días) y 'overdue' (si se
-- vence). Si el vencimiento cambia (licencia renovada / nuevo service agendado),
-- cambia target_date y vuelve a poder avisar para la fecha nueva.
--
-- Idempotente (IF NOT EXISTS). 100% aditivo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.alert_notifications (
  id                 SERIAL      PRIMARY KEY,
  driver_app_user_id UUID        NOT NULL,
  kind               TEXT        NOT NULL,   -- 'license' | 'service'
  phase              TEXT        NOT NULL,   -- 'warn' | 'overdue'
  target_date        DATE        NOT NULL,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (driver_app_user_id, kind, phase, target_date)
);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_driver
  ON public.alert_notifications (driver_app_user_id);
