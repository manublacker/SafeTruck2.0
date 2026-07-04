/**
 * independent.ts — flujo de camionero independiente (sin empresa).
 *
 * El backend modela al independiente como "empresa de uno": una fila en
 * drivers con user_id = app_user_id = su propio usuario. Con eso el resto de
 * la app (viajes personales, camión asignado, suscripción propia) funciona
 * igual que para un conductor de empresa.
 *
 * Orden del onboarding:
 *   1. setupIndependentAccount()  — crea el auto-vínculo (no requiere plan)
 *   2. pago del plan 'individual' — startMobileCheckout() de billing.ts
 *   3. confirmSubscription()      — activa la suscripción sin esperar el webhook
 *   4. createMyTruck() + assignTruckToSelf() — requieren suscripción activa
 */
import { apiRequest } from './assignedTrips'

export const INDEPENDENT_PLAN = 'individual'

export interface IndependentSetupResult {
  success: boolean
  driver_id: number
}

/** Convierte la cuenta en independiente. Idempotente; 409 si ya tiene empresa. */
export async function setupIndependentAccount(input?: {
  full_name?: string
  telefono?: string | null
}): Promise<IndependentSetupResult> {
  return apiRequest<IndependentSetupResult>('/api/auth/independent-setup', {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  })
}

export interface NewTruckInput {
  name: string
  patente?: string | null
  modelo?: string | null
  max_weight_kg: number
  max_height_m: number
  max_width_m: number
  max_length_m: number
}

/** Crea el camión propio (requiere suscripción activa: llamar después de pagar). */
export async function createMyTruck(input: NewTruckInput): Promise<{ id: number }> {
  return apiRequest<{ id: number }>('/api/trucks', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** Asigna el camión al propio conductor (driver_id del setup). */
export async function assignTruckToSelf(truckId: number, driverId: number): Promise<void> {
  await apiRequest('/api/truck-drivers', {
    method: 'POST',
    body: JSON.stringify({ truck_id: truckId, driver_id: driverId }),
  })
}

export interface SubscriptionRow {
  plan: string
  status: string
  current_period_end: string | null
}

/**
 * Confirmación síncrona post-checkout: el backend busca el pago en MercadoPago
 * y activa la suscripción sin depender del webhook. Devuelve la suscripción
 * vigente (o null). Sirve también para chequear si ya hay plan activo antes
 * de mandar al usuario a pagar de nuevo.
 */
export async function confirmSubscription(plan?: string): Promise<SubscriptionRow | null> {
  const res = await apiRequest<{ subscription: SubscriptionRow | null }>('/api/billing/confirm', {
    method: 'POST',
    body: JSON.stringify(plan ? { plan } : {}),
  })
  return res.subscription ?? null
}

export function hasActivePlan(sub: SubscriptionRow | null): boolean {
  return sub?.status === 'active'
}
