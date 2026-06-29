import { describe, it, expect } from 'vitest'
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

describe('estados de viaje', () => {
  it('TRIP_STATUSES tiene los 5 estados', () => {
    expect(TRIP_STATUSES).toEqual([
      'pending',
      'accepted',
      'in_progress',
      'completed',
      'cancelled',
    ])
  })

  it('ASSIGNABLE_STATUSES no incluye pending', () => {
    expect(ASSIGNABLE_STATUSES).not.toContain('pending')
    expect(ASSIGNABLE_STATUSES).toHaveLength(4)
  })

  describe('isValidTripStatus', () => {
    it('acepta todos los estados válidos', () => {
      for (const s of TRIP_STATUSES) {
        expect(isValidTripStatus(s)).toBe(true)
      }
    })

    it('rechaza estados desconocidos', () => {
      expect(isValidTripStatus('finished')).toBe(false)
      expect(isValidTripStatus('PENDING')).toBe(false)
      expect(isValidTripStatus('')).toBe(false)
    })

    it('rechaza valores que no son string', () => {
      expect(isValidTripStatus(null)).toBe(false)
      expect(isValidTripStatus(undefined)).toBe(false)
      expect(isValidTripStatus(3)).toBe(false)
      expect(isValidTripStatus({})).toBe(false)
    })
  })

  describe('isAssignableStatus', () => {
    it('acepta accepted/in_progress/completed/cancelled', () => {
      expect(isAssignableStatus('accepted')).toBe(true)
      expect(isAssignableStatus('in_progress')).toBe(true)
      expect(isAssignableStatus('completed')).toBe(true)
      expect(isAssignableStatus('cancelled')).toBe(true)
    })

    it('rechaza pending (no se "cambia" a pending)', () => {
      expect(isAssignableStatus('pending')).toBe(false)
    })

    it('rechaza basura', () => {
      expect(isAssignableStatus('xxx')).toBe(false)
      expect(isAssignableStatus(null)).toBe(false)
    })
  })
})

describe('timestampFieldForStatus', () => {
  it('mapea cada estado a su timestamp', () => {
    expect(timestampFieldForStatus('accepted')).toBe('accepted_at')
    expect(timestampFieldForStatus('in_progress')).toBe('started_at')
    expect(timestampFieldForStatus('completed')).toBe('completed_at')
  })

  it('no setea timestamp para pending ni cancelled', () => {
    expect(timestampFieldForStatus('pending')).toBeNull()
    expect(timestampFieldForStatus('cancelled')).toBeNull()
  })
})

describe('roundOrNull', () => {
  it('redondea al entero más cercano', () => {
    expect(roundOrNull(16.8)).toBe(17)
    expect(roundOrNull(16.2)).toBe(16)
    expect(roundOrNull(16.5)).toBe(17)
    expect(roundOrNull(0.4)).toBe(0)
  })

  it('deja los enteros como están', () => {
    expect(roundOrNull(20)).toBe(20)
    expect(roundOrNull(0)).toBe(0)
  })

  it('maneja negativos', () => {
    expect(roundOrNull(-3.2)).toBe(-3)
  })

  it('null / undefined / NaN devuelven null', () => {
    expect(roundOrNull(null)).toBeNull()
    expect(roundOrNull(undefined)).toBeNull()
    expect(roundOrNull(NaN)).toBeNull()
  })
})

describe('distanceMetersFromRoute', () => {
  it('usa distanceM del motor (redondeado)', () => {
    expect(distanceMetersFromRoute({ distanceM: 1234.6 })).toBe(1235)
  })

  it('cae a total_distance_km de la app (×1000, redondeado)', () => {
    expect(distanceMetersFromRoute({ total_distance_km: 20.5 })).toBe(20500)
    expect(distanceMetersFromRoute({ total_distance_km: 1.2345 })).toBe(1235)
  })

  it('prefiere distanceM cuando vienen los dos', () => {
    expect(distanceMetersFromRoute({ distanceM: 500, total_distance_km: 99 })).toBe(500)
  })

  it('devuelve null si no hay datos ni ruta', () => {
    expect(distanceMetersFromRoute(null)).toBeNull()
    expect(distanceMetersFromRoute(undefined)).toBeNull()
    expect(distanceMetersFromRoute({})).toBeNull()
  })
})

describe('durationMinutesFromRoute', () => {
  it('usa estimatedDurationMin del motor (redondeado)', () => {
    expect(durationMinutesFromRoute({ estimatedDurationMin: 16.8 })).toBe(17)
  })

  it('cae a total_duration_min de la app (redondeado) — el bug que rompía el INSERT', () => {
    expect(durationMinutesFromRoute({ total_duration_min: 16.8 })).toBe(17)
    expect(durationMinutesFromRoute({ total_duration_min: 2 })).toBe(2)
  })

  it('devuelve null sin datos', () => {
    expect(durationMinutesFromRoute(null)).toBeNull()
    expect(durationMinutesFromRoute({})).toBeNull()
  })
})

describe('tripSourceOf / isPersonalTrip', () => {
  it('personal cuando trip_source === personal', () => {
    expect(tripSourceOf({ trip_source: 'personal' })).toBe('personal')
    expect(isPersonalTrip({ trip_source: 'personal' })).toBe(true)
  })

  it('company por defecto', () => {
    expect(tripSourceOf({ trip_source: 'company' })).toBe('company')
    expect(tripSourceOf({})).toBe('company')
    expect(tripSourceOf({ trip_source: null })).toBe('company')
    expect(tripSourceOf({ trip_source: undefined })).toBe('company')
    expect(isPersonalTrip({})).toBe(false)
  })

  it('cualquier valor raro cae a company', () => {
    expect(tripSourceOf({ trip_source: 'otra-cosa' })).toBe('company')
  })
})

describe('isAbandonedPersonalTrip', () => {
  const now = new Date('2026-06-29T12:00:00Z')
  const personalInProgress = { status: 'in_progress' as TripStatus, trip_source: 'personal' }

  it('abandonado si la última ubicación es de hace más de 2 min', () => {
    const old = new Date(now.getTime() - 3 * 60 * 1000) // hace 3 min
    expect(isAbandonedPersonalTrip(personalInProgress, old, now)).toBe(true)
  })

  it('NO abandonado si la ubicación es fresca (< 2 min)', () => {
    const fresh = new Date(now.getTime() - 30 * 1000) // hace 30 s
    expect(isAbandonedPersonalTrip(personalInProgress, fresh, now)).toBe(false)
  })

  it('abandonado si NO hay ninguna ubicación', () => {
    expect(isAbandonedPersonalTrip(personalInProgress, null, now)).toBe(true)
  })

  it('NO aplica a viajes de empresa', () => {
    const company = { status: 'in_progress' as TripStatus, trip_source: 'company' }
    expect(isAbandonedPersonalTrip(company, null, now)).toBe(false)
  })

  it('NO aplica si el viaje no está in_progress', () => {
    const completed = { status: 'completed' as TripStatus, trip_source: 'personal' }
    expect(isAbandonedPersonalTrip(completed, null, now)).toBe(false)
  })

  it('respeta un umbral custom', () => {
    const at = new Date(now.getTime() - 90 * 1000) // hace 90 s
    expect(isAbandonedPersonalTrip(personalInProgress, at, now, 60 * 1000)).toBe(true)
    expect(isAbandonedPersonalTrip(personalInProgress, at, now, 120 * 1000)).toBe(false)
  })
})

describe('isFreshLocation', () => {
  const now = new Date('2026-06-29T12:00:00Z')

  it('fresca dentro de los 5 min', () => {
    expect(isFreshLocation(new Date(now.getTime() - 60 * 1000), now)).toBe(true)
    expect(isFreshLocation(new Date(now.getTime() - 4 * 60 * 1000), now)).toBe(true)
  })

  it('vieja después de 5 min', () => {
    expect(isFreshLocation(new Date(now.getTime() - 6 * 60 * 1000), now)).toBe(false)
  })

  it('null no es fresca', () => {
    expect(isFreshLocation(null, now)).toBe(false)
    expect(isFreshLocation(undefined, now)).toBe(false)
  })

  it('respeta un umbral custom', () => {
    const at = new Date(now.getTime() - 90 * 1000)
    expect(isFreshLocation(at, now, 60 * 1000)).toBe(false)
    expect(isFreshLocation(at, now, 120 * 1000)).toBe(true)
  })
})
