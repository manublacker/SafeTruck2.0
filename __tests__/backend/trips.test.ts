/**
 * Tests de la lógica pura de viajes (`src/backend/lib/trips.ts`).
 *
 * Cubre: validación de estados, mapeo estado→timestamp, redondeo para columnas
 * INTEGER, extracción de distancia/duración desde objetos de ruta (formato motor
 * y formato móvil), origen del viaje y detección de viajes personales
 * abandonados / ubicaciones frescas.
 */
import {
  TRIP_STATUSES,
  ASSIGNABLE_STATUSES,
  isValidTripStatus,
  isAssignableStatus,
  timestampFieldForStatus,
  roundOrNull,
  distanceMetersFromRoute,
  durationMinutesFromRoute,
  tripSourceOf,
  isPersonalTrip,
  isAbandonedPersonalTrip,
  isFreshLocation,
  type TripStatus,
} from '../../src/backend/lib/trips'

describe('trips.ts — constantes de estados', () => {
  it('TRIP_STATUSES contiene exactamente los cinco estados del dominio', () => {
    expect(TRIP_STATUSES).toEqual([
      'pending',
      'accepted',
      'in_progress',
      'completed',
      'cancelled',
    ])
  })

  it('TRIP_STATUSES no tiene duplicados', () => {
    expect(new Set(TRIP_STATUSES).size).toBe(TRIP_STATUSES.length)
  })

  it('ASSIGNABLE_STATUSES es un subconjunto de TRIP_STATUSES', () => {
    for (const s of ASSIGNABLE_STATUSES) {
      expect(TRIP_STATUSES).toContain(s)
    }
  })

  it('ASSIGNABLE_STATUSES excluye "pending" (no se puede volver a pendiente)', () => {
    expect(ASSIGNABLE_STATUSES).not.toContain('pending')
  })

  it('ASSIGNABLE_STATUSES contiene accepted, in_progress, completed y cancelled', () => {
    expect(ASSIGNABLE_STATUSES).toEqual([
      'accepted',
      'in_progress',
      'completed',
      'cancelled',
    ])
  })

  it('la única diferencia entre TRIP_STATUSES y ASSIGNABLE_STATUSES es "pending"', () => {
    const diff = TRIP_STATUSES.filter((s) => !ASSIGNABLE_STATUSES.includes(s))
    expect(diff).toEqual(['pending'])
  })
})

describe('trips.ts — isValidTripStatus', () => {
  it.each(TRIP_STATUSES)('acepta el estado válido "%s"', (status) => {
    expect(isValidTripStatus(status)).toBe(true)
  })

  it('rechaza un string que no es un estado', () => {
    expect(isValidTripStatus('en_camino')).toBe(false)
    expect(isValidTripStatus('finished')).toBe(false)
    expect(isValidTripStatus('PENDING')).toBe(false)
    expect(isValidTripStatus('')).toBe(false)
  })

  it('es sensible a mayúsculas/minúsculas', () => {
    expect(isValidTripStatus('Pending')).toBe(false)
    expect(isValidTripStatus('COMPLETED')).toBe(false)
    expect(isValidTripStatus('In_Progress')).toBe(false)
  })

  it('rechaza valores no-string', () => {
    expect(isValidTripStatus(null)).toBe(false)
    expect(isValidTripStatus(undefined)).toBe(false)
    expect(isValidTripStatus(0)).toBe(false)
    expect(isValidTripStatus(1)).toBe(false)
    expect(isValidTripStatus(true)).toBe(false)
    expect(isValidTripStatus(false)).toBe(false)
    expect(isValidTripStatus({})).toBe(false)
    expect(isValidTripStatus([])).toBe(false)
    expect(isValidTripStatus(['pending'])).toBe(false)
    expect(isValidTripStatus({ status: 'pending' })).toBe(false)
  })

  it('rechaza strings con espacios alrededor', () => {
    expect(isValidTripStatus(' pending')).toBe(false)
    expect(isValidTripStatus('pending ')).toBe(false)
    expect(isValidTripStatus(' pending ')).toBe(false)
  })

  it('funciona como type guard estrechando el tipo', () => {
    const value: unknown = 'in_progress'
    if (isValidTripStatus(value)) {
      // Dentro de este bloque, value es TripStatus.
      const narrowed: TripStatus = value
      expect(narrowed).toBe('in_progress')
    } else {
      throw new Error('debería haber sido válido')
    }
  })
})

describe('trips.ts — isAssignableStatus', () => {
  it.each(ASSIGNABLE_STATUSES)('acepta el estado asignable "%s"', (status) => {
    expect(isAssignableStatus(status)).toBe(true)
  })

  it('rechaza "pending" aunque sea un estado válido de viaje', () => {
    expect(isValidTripStatus('pending')).toBe(true)
    expect(isAssignableStatus('pending')).toBe(false)
  })

  it('rechaza estados inexistentes', () => {
    expect(isAssignableStatus('finished')).toBe(false)
    expect(isAssignableStatus('paused')).toBe(false)
    expect(isAssignableStatus('')).toBe(false)
  })

  it('rechaza valores no-string', () => {
    expect(isAssignableStatus(null)).toBe(false)
    expect(isAssignableStatus(undefined)).toBe(false)
    expect(isAssignableStatus(42)).toBe(false)
    expect(isAssignableStatus({})).toBe(false)
    expect(isAssignableStatus(['accepted'])).toBe(false)
  })

  it('todo estado asignable es también un estado válido', () => {
    for (const s of ASSIGNABLE_STATUSES) {
      expect(isValidTripStatus(s)).toBe(true)
    }
  })
})

describe('trips.ts — timestampFieldForStatus', () => {
  it('mapea "accepted" → accepted_at', () => {
    expect(timestampFieldForStatus('accepted')).toBe('accepted_at')
  })

  it('mapea "in_progress" → started_at', () => {
    expect(timestampFieldForStatus('in_progress')).toBe('started_at')
  })

  it('mapea "completed" → completed_at', () => {
    expect(timestampFieldForStatus('completed')).toBe('completed_at')
  })

  it('devuelve null para "pending" (no marca timestamp)', () => {
    expect(timestampFieldForStatus('pending')).toBeNull()
  })

  it('devuelve null para "cancelled" (no marca timestamp)', () => {
    expect(timestampFieldForStatus('cancelled')).toBeNull()
  })

  it('cada estado que marca timestamp usa un campo distinto', () => {
    const fields = [
      timestampFieldForStatus('accepted'),
      timestampFieldForStatus('in_progress'),
      timestampFieldForStatus('completed'),
    ]
    expect(new Set(fields).size).toBe(3)
  })

  it('todos los campos terminan en "_at"', () => {
    for (const status of ['accepted', 'in_progress', 'completed'] as TripStatus[]) {
      expect(timestampFieldForStatus(status)).toMatch(/_at$/)
    }
  })
})

describe('trips.ts — roundOrNull', () => {
  it('redondea hacia arriba en .5', () => {
    expect(roundOrNull(16.5)).toBe(17)
    expect(roundOrNull(0.5)).toBe(1)
    expect(roundOrNull(2.5)).toBe(3)
  })

  it('redondea decimales hacia el entero más cercano', () => {
    expect(roundOrNull(16.8)).toBe(17)
    expect(roundOrNull(16.4)).toBe(16)
    expect(roundOrNull(16.49999)).toBe(16)
    expect(roundOrNull(16.50001)).toBe(17)
  })

  it('deja enteros intactos', () => {
    expect(roundOrNull(0)).toBe(0)
    expect(roundOrNull(1)).toBe(1)
    expect(roundOrNull(1000)).toBe(1000)
    expect(roundOrNull(-5)).toBe(-5)
  })

  it('redondea negativos', () => {
    expect(roundOrNull(-16.8)).toBe(-17)
    expect(roundOrNull(-16.4)).toBe(-16)
    // Math.round(-0.5) === -0 en JS
    expect(roundOrNull(-2.5)).toBe(-2)
  })

  it('devuelve null para null', () => {
    expect(roundOrNull(null)).toBeNull()
  })

  it('devuelve null para undefined', () => {
    expect(roundOrNull(undefined)).toBeNull()
  })

  it('devuelve null para NaN', () => {
    expect(roundOrNull(NaN)).toBeNull()
  })

  it('trata 0 como valor válido, no como null (== null es solo null/undefined)', () => {
    expect(roundOrNull(0)).toBe(0)
    expect(roundOrNull(0)).not.toBeNull()
  })

  it('maneja números muy grandes', () => {
    expect(roundOrNull(999999.6)).toBe(1000000)
  })

  it('maneja Infinity devolviendo Infinity (no es NaN ni null)', () => {
    expect(roundOrNull(Infinity)).toBe(Infinity)
    expect(roundOrNull(-Infinity)).toBe(-Infinity)
  })
})

describe('trips.ts — distanceMetersFromRoute', () => {
  it('devuelve null para route null', () => {
    expect(distanceMetersFromRoute(null)).toBeNull()
  })

  it('devuelve null para route undefined', () => {
    expect(distanceMetersFromRoute(undefined)).toBeNull()
  })

  it('usa distanceM (formato motor de ruteo) cuando está presente', () => {
    expect(distanceMetersFromRoute({ distanceM: 1500 })).toBe(1500)
  })

  it('redondea distanceM con decimales', () => {
    expect(distanceMetersFromRoute({ distanceM: 1500.7 })).toBe(1501)
    expect(distanceMetersFromRoute({ distanceM: 1500.2 })).toBe(1500)
  })

  it('convierte total_distance_km (formato móvil) a metros', () => {
    expect(distanceMetersFromRoute({ total_distance_km: 1.5 })).toBe(1500)
    expect(distanceMetersFromRoute({ total_distance_km: 10 })).toBe(10000)
  })

  it('redondea la conversión km→m', () => {
    expect(distanceMetersFromRoute({ total_distance_km: 1.2345 })).toBe(1235)
  })

  it('prioriza distanceM sobre total_distance_km', () => {
    expect(
      distanceMetersFromRoute({ distanceM: 2000, total_distance_km: 99 }),
    ).toBe(2000)
  })

  it('cae a total_distance_km si distanceM es null', () => {
    expect(
      distanceMetersFromRoute({ distanceM: null, total_distance_km: 3 }),
    ).toBe(3000)
  })

  it('devuelve null si ningún campo de distancia está presente', () => {
    expect(distanceMetersFromRoute({})).toBeNull()
    expect(distanceMetersFromRoute({ estimatedDurationMin: 10 })).toBeNull()
  })

  it('devuelve null si ambos campos son null', () => {
    expect(
      distanceMetersFromRoute({ distanceM: null, total_distance_km: null }),
    ).toBeNull()
  })

  it('trata distanceM = 0 como valor presente (0 metros)', () => {
    expect(distanceMetersFromRoute({ distanceM: 0 })).toBe(0)
  })

  it('trata total_distance_km = 0 como valor presente', () => {
    expect(distanceMetersFromRoute({ total_distance_km: 0 })).toBe(0)
  })
})

describe('trips.ts — durationMinutesFromRoute', () => {
  it('devuelve null para route null/undefined', () => {
    expect(durationMinutesFromRoute(null)).toBeNull()
    expect(durationMinutesFromRoute(undefined)).toBeNull()
  })

  it('usa estimatedDurationMin (formato motor) cuando está presente', () => {
    expect(durationMinutesFromRoute({ estimatedDurationMin: 25 })).toBe(25)
  })

  it('redondea estimatedDurationMin', () => {
    expect(durationMinutesFromRoute({ estimatedDurationMin: 25.6 })).toBe(26)
    expect(durationMinutesFromRoute({ estimatedDurationMin: 25.3 })).toBe(25)
  })

  it('usa total_duration_min (formato móvil) como fallback', () => {
    expect(durationMinutesFromRoute({ total_duration_min: 40 })).toBe(40)
  })

  it('prioriza estimatedDurationMin sobre total_duration_min', () => {
    expect(
      durationMinutesFromRoute({
        estimatedDurationMin: 12,
        total_duration_min: 99,
      }),
    ).toBe(12)
  })

  it('cae a total_duration_min si estimatedDurationMin es null', () => {
    expect(
      durationMinutesFromRoute({
        estimatedDurationMin: null,
        total_duration_min: 7,
      }),
    ).toBe(7)
  })

  it('devuelve null si ningún campo de duración está presente', () => {
    expect(durationMinutesFromRoute({})).toBeNull()
    expect(durationMinutesFromRoute({ distanceM: 500 })).toBeNull()
  })

  it('trata duración 0 como valor presente', () => {
    expect(durationMinutesFromRoute({ estimatedDurationMin: 0 })).toBe(0)
    expect(durationMinutesFromRoute({ total_duration_min: 0 })).toBe(0)
  })

  it('no confunde distancia con duración', () => {
    expect(
      durationMinutesFromRoute({ distanceM: 5000, total_duration_min: 30 }),
    ).toBe(30)
  })
})

describe('trips.ts — tripSourceOf', () => {
  it('devuelve "personal" cuando trip_source es "personal"', () => {
    expect(tripSourceOf({ trip_source: 'personal' })).toBe('personal')
  })

  it('devuelve "company" cuando trip_source es "company"', () => {
    expect(tripSourceOf({ trip_source: 'company' })).toBe('company')
  })

  it('default a "company" cuando trip_source falta', () => {
    expect(tripSourceOf({})).toBe('company')
  })

  it('default a "company" cuando trip_source es null', () => {
    expect(tripSourceOf({ trip_source: null })).toBe('company')
  })

  it('default a "company" para cualquier valor que no sea exactamente "personal"', () => {
    expect(tripSourceOf({ trip_source: 'PERSONAL' })).toBe('company')
    expect(tripSourceOf({ trip_source: 'personal ' })).toBe('company')
    expect(tripSourceOf({ trip_source: 'empresa' })).toBe('company')
    expect(tripSourceOf({ trip_source: '' })).toBe('company')
  })

  it('sólo devuelve "company" o "personal"', () => {
    const result = tripSourceOf({ trip_source: 'lo-que-sea' })
    expect(['company', 'personal']).toContain(result)
  })
})

describe('trips.ts — isPersonalTrip', () => {
  it('es true para viajes personales', () => {
    expect(isPersonalTrip({ trip_source: 'personal' })).toBe(true)
  })

  it('es false para viajes de empresa', () => {
    expect(isPersonalTrip({ trip_source: 'company' })).toBe(false)
  })

  it('es false por default (sin trip_source)', () => {
    expect(isPersonalTrip({})).toBe(false)
  })

  it('es false para null', () => {
    expect(isPersonalTrip({ trip_source: null })).toBe(false)
  })

  it('es consistente con tripSourceOf', () => {
    const trips = [
      { trip_source: 'personal' },
      { trip_source: 'company' },
      { trip_source: null },
      {},
    ]
    for (const t of trips) {
      expect(isPersonalTrip(t)).toBe(tripSourceOf(t) === 'personal')
    }
  })
})

describe('trips.ts — isAbandonedPersonalTrip', () => {
  const now = new Date('2026-07-01T12:00:00.000Z')

  it('es false para viajes de empresa (no aplica el concepto)', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'company' }
    expect(isAbandonedPersonalTrip(trip, null, now)).toBe(false)
  })

  it('es false para viajes personales que no están en progreso', () => {
    const base = { trip_source: 'personal' }
    expect(
      isAbandonedPersonalTrip({ ...base, status: 'pending' }, null, now),
    ).toBe(false)
    expect(
      isAbandonedPersonalTrip({ ...base, status: 'accepted' }, null, now),
    ).toBe(false)
    expect(
      isAbandonedPersonalTrip({ ...base, status: 'completed' }, null, now),
    ).toBe(false)
    expect(
      isAbandonedPersonalTrip({ ...base, status: 'cancelled' }, null, now),
    ).toBe(false)
  })

  it('es true para un viaje personal en progreso sin ninguna ubicación', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }
    expect(isAbandonedPersonalTrip(trip, null, now)).toBe(true)
  })

  it('es false si la última ubicación es reciente (dentro de 2 min)', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }
    const lastLoc = new Date(now.getTime() - 60 * 1000) // hace 1 min
    expect(isAbandonedPersonalTrip(trip, lastLoc, now)).toBe(false)
  })

  it('es true si la última ubicación es más vieja que 2 min (default)', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }
    const lastLoc = new Date(now.getTime() - 3 * 60 * 1000) // hace 3 min
    expect(isAbandonedPersonalTrip(trip, lastLoc, now)).toBe(true)
  })

  it('en el borde exacto de 2 min NO se considera abandonado (usa > estricto)', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }
    const lastLoc = new Date(now.getTime() - 2 * 60 * 1000) // exactamente 2 min
    expect(isAbandonedPersonalTrip(trip, lastLoc, now)).toBe(false)
  })

  it('un milisegundo pasado el umbral sí es abandonado', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }
    const lastLoc = new Date(now.getTime() - (2 * 60 * 1000 + 1))
    expect(isAbandonedPersonalTrip(trip, lastLoc, now)).toBe(true)
  })

  it('respeta un maxAgeMs custom', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }
    const lastLoc = new Date(now.getTime() - 30 * 1000) // hace 30 s
    // Con umbral de 10 s, 30 s es viejo → abandonado.
    expect(isAbandonedPersonalTrip(trip, lastLoc, now, 10 * 1000)).toBe(true)
    // Con umbral de 60 s, 30 s es reciente → no abandonado.
    expect(isAbandonedPersonalTrip(trip, lastLoc, now, 60 * 1000)).toBe(false)
  })

  it('un viaje de empresa nunca es abandonado, sin importar la ubicación', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'company' }
    const veryOld = new Date(now.getTime() - 999 * 60 * 1000)
    expect(isAbandonedPersonalTrip(trip, veryOld, now)).toBe(false)
    expect(isAbandonedPersonalTrip(trip, null, now)).toBe(false)
  })
})

describe('trips.ts — isFreshLocation', () => {
  const now = new Date('2026-07-01T12:00:00.000Z')

  it('es false para updatedAt null/undefined', () => {
    expect(isFreshLocation(null, now)).toBe(false)
    expect(isFreshLocation(undefined, now)).toBe(false)
  })

  it('es true para una ubicación de hace 1 minuto (default 5 min)', () => {
    const updated = new Date(now.getTime() - 60 * 1000)
    expect(isFreshLocation(updated, now)).toBe(true)
  })

  it('es true justo en el borde de 5 minutos (usa <= inclusivo)', () => {
    const updated = new Date(now.getTime() - 5 * 60 * 1000)
    expect(isFreshLocation(updated, now)).toBe(true)
  })

  it('es false apenas pasa los 5 minutos', () => {
    const updated = new Date(now.getTime() - (5 * 60 * 1000 + 1))
    expect(isFreshLocation(updated, now)).toBe(false)
  })

  it('es true para una ubicación en el mismo instante que now', () => {
    expect(isFreshLocation(new Date(now.getTime()), now)).toBe(true)
  })

  it('respeta un maxAgeMs custom', () => {
    const updated = new Date(now.getTime() - 90 * 1000) // hace 90 s
    expect(isFreshLocation(updated, now, 60 * 1000)).toBe(false)
    expect(isFreshLocation(updated, now, 120 * 1000)).toBe(true)
  })

  it('una ubicación en el futuro se considera fresca (diferencia negativa <= maxAge)', () => {
    const future = new Date(now.getTime() + 10 * 1000)
    expect(isFreshLocation(future, now)).toBe(true)
  })

  it('es complementaria conceptualmente al abandono para viajes activos', () => {
    // Una ubicación de hace 10 min no es fresca.
    const updated = new Date(now.getTime() - 10 * 60 * 1000)
    expect(isFreshLocation(updated, now)).toBe(false)
  })
})
