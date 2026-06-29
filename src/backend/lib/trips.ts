// Helpers PUROS de la lógica de viajes (sin DB ni red), para poder testearlos en
// aislamiento y reutilizarlos desde las rutas de `assigned-trips`. Acá vive la
// lógica de negocio "fina": estados válidos, qué timestamp setear, cómo sacar la
// distancia/duración de un objeto de ruta y cuándo un viaje personal está
// abandonado.

export type TripStatus =
  | 'pending'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

/** Todos los estados posibles de un viaje. */
export const TRIP_STATUSES: TripStatus[] = [
  'pending',
  'accepted',
  'in_progress',
  'completed',
  'cancelled',
]

/** Estados a los que se puede CAMBIAR un viaje vía `PATCH /:id/status`. */
export const ASSIGNABLE_STATUSES: TripStatus[] = [
  'accepted',
  'in_progress',
  'completed',
  'cancelled',
]

/** True si `status` es uno de los estados válidos de un viaje. */
export function isValidTripStatus(status: unknown): status is TripStatus {
  return typeof status === 'string' && (TRIP_STATUSES as string[]).includes(status)
}

/** True si `status` es un estado al que se permite cambiar un viaje. */
export function isAssignableStatus(status: unknown): status is TripStatus {
  return typeof status === 'string' && (ASSIGNABLE_STATUSES as string[]).includes(status)
}

/**
 * Campo de timestamp que hay que setear al pasar a cada estado (o `null` si ese
 * estado no marca ningún timestamp). Ej: pasar a `in_progress` setea `started_at`.
 */
export function timestampFieldForStatus(
  status: TripStatus,
): 'accepted_at' | 'started_at' | 'completed_at' | null {
  switch (status) {
    case 'accepted':
      return 'accepted_at'
    case 'in_progress':
      return 'started_at'
    case 'completed':
      return 'completed_at'
    default:
      return null
  }
}

/**
 * Redondea a entero. Las columnas `distance_m` y `duration_min` son INTEGER, así
 * que un valor con decimales (ej. 16.8) rompería el INSERT. `null`/`undefined`/
 * `NaN` pasan como `null`.
 */
export function roundOrNull(n: number | null | undefined): number | null {
  if (n == null || Number.isNaN(n)) return null
  return Math.round(n)
}

interface RouteLike {
  distanceM?: number | null
  estimatedDurationMin?: number | null
  total_distance_km?: number | null
  total_duration_min?: number | null
}

/**
 * Distancia en METROS a partir de un objeto de ruta. Acepta el formato del motor
 * de ruteo (`distanceM`) o el de la app móvil (`total_distance_km`). Siempre
 * devuelve un entero (o `null`).
 */
export function distanceMetersFromRoute(route: RouteLike | null | undefined): number | null {
  if (route == null) return null
  if (route.distanceM != null) return roundOrNull(route.distanceM)
  if (route.total_distance_km != null) return roundOrNull(route.total_distance_km * 1000)
  return null
}

/**
 * Duración en MINUTOS a partir de un objeto de ruta. Acepta `estimatedDurationMin`
 * (motor) o `total_duration_min` (móvil). Siempre entero (o `null`).
 */
export function durationMinutesFromRoute(route: RouteLike | null | undefined): number | null {
  if (route == null) return null
  if (route.estimatedDurationMin != null) return roundOrNull(route.estimatedDurationMin)
  if (route.total_duration_min != null) return roundOrNull(route.total_duration_min)
  return null
}

/** Origen del viaje, con default `'company'` si no está seteado. */
export function tripSourceOf(trip: { trip_source?: string | null }): 'company' | 'personal' {
  return trip.trip_source === 'personal' ? 'personal' : 'company'
}

/** True si el viaje lo armó el conductor (no la empresa). */
export function isPersonalTrip(trip: { trip_source?: string | null }): boolean {
  return tripSourceOf(trip) === 'personal'
}

/**
 * ¿Un viaje personal en curso está "abandonado"? Un viaje personal manda ubicación
 * seguido mientras está activo; si la última ubicación es más vieja que
 * `maxAgeMs` (default 2 min), se considera abandonado y se puede auto-completar.
 *
 * @param lastLocationAt `updated_at` de la última ubicación del conductor, o
 *                       `null` si no hay ninguna fila viva.
 */
export function isAbandonedPersonalTrip(
  trip: { status: TripStatus; trip_source?: string | null },
  lastLocationAt: Date | null,
  now: Date,
  maxAgeMs: number = 2 * 60 * 1000,
): boolean {
  if (!isPersonalTrip(trip)) return false
  if (trip.status !== 'in_progress') return false
  if (lastLocationAt == null) return true
  return now.getTime() - lastLocationAt.getTime() > maxAgeMs
}

/**
 * Una ubicación se considera "fresca" (visible en el Live Map) si se actualizó
 * dentro de los últimos `maxAgeMs` (default 5 min).
 */
export function isFreshLocation(
  updatedAt: Date | null | undefined,
  now: Date,
  maxAgeMs: number = 5 * 60 * 1000,
): boolean {
  if (updatedAt == null) return false
  return now.getTime() - updatedAt.getTime() <= maxAgeMs
}
