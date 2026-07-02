// Helpers PUROS de presentación de viajes (estados, duración, distancia, CSV,
// origen). Sin React ni dependencias externas, para reusarlos entre la tabla del
// historial (`TripHistoryView`) y el modal de detalle (`TripDetailModal`) — antes
// estaban duplicados — y para poder testearlos en aislamiento.

import type { AssignedTrip } from '@/services/api'

export type TripStatus =
  | 'pending'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

/** Etiqueta legible de cada estado. */
export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  in_progress: 'En curso',
  completed: 'Completado',
  cancelled: 'Cancelado',
}

/** Etiqueta del estado (cae al valor crudo si es uno desconocido). */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

/** Clase CSS del badge según el estado (los colores viven en admin.css). */
export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'st-badge st-badge-encurso'
    case 'accepted':
      return 'st-badge st-badge-aceptado'
    case 'completed':
      return 'st-badge st-badge-completado'
    case 'cancelled':
      return 'st-badge st-badge-cancelado'
    default:
      return 'st-badge st-badge-pendiente' // pending
  }
}

export type TripSource = 'company' | 'personal'

/** Origen del viaje, con default 'company'. */
export function tripSource(t: { trip_source?: string | null }): TripSource {
  return t.trip_source === 'personal' ? 'personal' : 'company'
}

export const SOURCE_LABELS: Record<TripSource, string> = {
  company: 'Empresa',
  personal: 'Personal',
}

interface DurationInput {
  started_at?: string | null
  completed_at?: string | null
  duration_min?: number | null
}

/**
 * Minutos de duración del viaje: la duración REAL (`completed_at - started_at`) si
 * existe; si no, la estimada de la ruta (`duration_min`). `null` si no hay forma
 * de saberla.
 */
export function durationMinutes(t: DurationInput): number | null {
  if (t.started_at && t.completed_at) {
    const s = new Date(t.started_at).getTime()
    const e = new Date(t.completed_at).getTime()
    if (!isNaN(s) && !isNaN(e) && e > s) return Math.round((e - s) / 60000)
  }
  return t.duration_min != null ? Math.round(t.duration_min) : null
}

/** Duración formateada en una sola cadena: "45 min", "1 h", "2 h 15 min", "—". */
export function formatDuration(t: DurationInput): string {
  const minutes = durationMinutes(t)
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Duración separada en número + unidad, para resaltar el número (tarjeta). */
export function durationParts(t: DurationInput): { value: string; unit: string } {
  const minutes = durationMinutes(t)
  if (minutes == null) return { value: '—', unit: '' }
  if (minutes < 60) return { value: String(minutes), unit: 'min' }
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? { value: String(h), unit: 'h' } : { value: `${h} h ${m}`, unit: 'min' }
}

/** Distancia (en metros) separada en número + unidad: 20500 → { "20.5", "km" }. */
export function distanceParts(m: number | null | undefined): { value: string; unit: string } {
  if (m == null) return { value: '—', unit: '' }
  if (m >= 1000) return { value: (m / 1000).toFixed(1), unit: 'km' }
  return { value: String(Math.round(m)), unit: 'm' }
}

/** Escapa un valor para CSV (separador ';', compatible con Excel en español). */
export function csvEscape(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

interface DateInput {
  completed_at?: string | null
  started_at?: string | null
  scheduled_at?: string | null
  created_at?: string | null
}

/**
 * Fecha representativa del viaje, en orden de prioridad: cuándo terminó, o
 * empezó, o estaba agendado, o se creó. `null` si ninguna es válida.
 */
export function tripDate(t: DateInput): Date | null {
  const iso = t.completed_at ?? t.started_at ?? t.scheduled_at ?? t.created_at
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Igualdad de dos viajes por los campos que las vistas observan. Se usa con
 * `reconcileById` para conservar la referencia de un viaje que no cambió. `path`
 * queda fuera: se fija al crear el viaje y no interviene en la tabla ni en el
 * panel de próximos.
 */
export function sameAssignedTrip(a: AssignedTrip, b: AssignedTrip): boolean {
  return (
    a.status === b.status &&
    a.driver_id === b.driver_id &&
    a.driver_nombre === b.driver_nombre &&
    a.truck_id === b.truck_id &&
    a.truck_patente === b.truck_patente &&
    a.origin_label === b.origin_label &&
    a.destination_label === b.destination_label &&
    a.origin_lat === b.origin_lat &&
    a.origin_lon === b.origin_lon &&
    a.destination_lat === b.destination_lat &&
    a.destination_lon === b.destination_lon &&
    a.distance_m === b.distance_m &&
    a.duration_min === b.duration_min &&
    a.scheduled_at === b.scheduled_at &&
    a.started_at === b.started_at &&
    a.completed_at === b.completed_at &&
    a.trip_source === b.trip_source &&
    a.created_at === b.created_at
  )
}
