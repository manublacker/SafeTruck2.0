-- 005_plan_individual_checks.sql
--
-- Los CHECK constraints de plan en Supabase solo admiten
-- 'starter' | 'pro' | 'enterprise'. Sin esto, el upsert que activa la
-- suscripción de un camionero independiente (billing.ts, plan 'individual')
-- falla con "violates check constraint st_subscriptions_plan_check", y el
-- espejo en profiles.plan falla igual.
--
-- ⚠️ Correr en SUPABASE (SQL editor), no en Aiven. Idempotente.

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS st_subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT st_subscriptions_plan_check
  CHECK (plan IN ('individual', 'starter', 'pro', 'enterprise'));

-- mp_plan guarda el mismo slug; si tenía un check análogo, lo alineamos.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS st_subscriptions_mp_plan_check;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS st_profiles_plan_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT st_profiles_plan_check
  CHECK (plan IS NULL OR plan IN ('individual', 'starter', 'pro', 'enterprise'));
