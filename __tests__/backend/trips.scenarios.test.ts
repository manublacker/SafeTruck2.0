/**
 * Tests de ESCENARIOS y BORDES de la lógica pura de viajes
 * (`src/backend/lib/trips.ts`). Complementa a `trips.test.ts` con grillas
 * exhaustivas de tiempo (abandono / frescura con distintos `maxAgeMs` y offsets
 * en segundos, minutos, bordes exactos y ±1ms), la matriz completa
 * estado×timestamp, parsing de rutas con prioridad de formato motor vs móvil,
 * y una batería grande de redondeo.
 *
 * Todos los cálculos temporales usan un `now` fijo para que las aserciones sean
 * deterministas y concretas.
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

/** Instante fijo de referencia para todos los escenarios temporales. */
const NOW = new Date('2026-07-01T12:00:00.000Z')

/** Construye una fecha desplazada `ms` milisegundos respecto de `NOW`. */
function offset(ms: number): Date {
  return new Date(NOW.getTime() + ms)
}

const SECOND = 1000
const MINUTE = 60 * SECOND

describe('trips.scenarios — invariantes de las tablas de estados', () => {
  it('TRIP_STATUSES tiene 5 elementos y no tiene duplicados', () => {
    expect(TRIP_STATUSES).toHaveLength(5)
    expect(new Set(TRIP_STATUSES).size).toBe(5)
  })

  it('ASSIGNABLE_STATUSES tiene 4 elementos y no tiene duplicados', () => {
    expect(ASSIGNABLE_STATUSES).toHaveLength(4)
    expect(new Set(ASSIGNABLE_STATUSES).size).toBe(4)
  })

  it('ASSIGNABLE_STATUSES es subconjunto de TRIP_STATUSES', () => {
    for (const s of ASSIGNABLE_STATUSES) {
      expect(TRIP_STATUSES).toContain(s)
    }
  })

  it("la única diferencia entre TRIP_STATUSES y ASSIGNABLE_STATUSES es 'pending'", () => {
    const diff = TRIP_STATUSES.filter((s) => !ASSIGNABLE_STATUSES.includes(s))
    expect(diff).toEqual(['pending'])
  })

  it('cada estado de TRIP_STATUSES es válido según isValidTripStatus', () => {
    for (const s of TRIP_STATUSES) {
      expect(isValidTripStatus(s)).toBe(true)
    }
  })

  it('cada estado de ASSIGNABLE_STATUSES es asignable según isAssignableStatus', () => {
    for (const s of ASSIGNABLE_STATUSES) {
      expect(isAssignableStatus(s)).toBe(true)
    }
  })
})

describe('trips.scenarios — isValidTripStatus con tipos no-string', () => {
  const casos: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['número 0', 0],
    ['número 1', 1],
    ['boolean true', true],
    ['boolean false', false],
    ['array de estado', ['pending']],
    ['objeto', { status: 'pending' }],
    ['función', () => 'pending'],
    ['símbolo', Symbol('pending')],
    ['NaN', NaN],
    ['string vacío', ''],
    ['string con espacios', '  pending  '],
    ['mayúsculas', 'PENDING'],
    ['con acento', 'péndïng'],
    ['estado inventado', 'archived'],
    ['casi-estado', 'in-progress'],
  ]

  it.each(casos)('devuelve false para %s', (_label, valor) => {
    expect(isValidTripStatus(valor)).toBe(false)
  })
})

describe('trips.scenarios — isAssignableStatus con tipos no-string y pending', () => {
  const noAsignables: Array<[string, unknown]> = [
    ['pending (válido pero no asignable)', 'pending'],
    ['null', null],
    ['undefined', undefined],
    ['número', 3],
    ['boolean', true],
    ['objeto', {}],
    ['array', []],
    ['string vacío', ''],
    ['ACCEPTED en mayúsculas', 'ACCEPTED'],
  ]

  it.each(noAsignables)('devuelve false para %s', (_label, valor) => {
    expect(isAssignableStatus(valor)).toBe(false)
  })
})

describe('trips.scenarios — matriz completa estado×timestamp', () => {
  const matriz: Array<[TripStatus, 'accepted_at' | 'started_at' | 'completed_at' | null]> = [
    ['pending', null],
    ['accepted', 'accepted_at'],
    ['in_progress', 'started_at'],
    ['completed', 'completed_at'],
    ['cancelled', null],
  ]

  it.each(matriz)('timestampFieldForStatus(%s) === %s', (status, esperado) => {
    expect(timestampFieldForStatus(status)).toBe(esperado)
  })

  it('exactamente 3 estados marcan un timestamp y 2 devuelven null', () => {
    const conTimestamp = TRIP_STATUSES.filter((s) => timestampFieldForStatus(s) !== null)
    const sinTimestamp = TRIP_STATUSES.filter((s) => timestampFieldForStatus(s) === null)
    expect(conTimestamp).toEqual(['accepted', 'in_progress', 'completed'])
    expect(sinTimestamp).toEqual(['pending', 'cancelled'])
  })

  it('los tres timestamps posibles son todos distintos entre sí', () => {
    const campos = ['accepted', 'in_progress', 'completed'].map((s) =>
      timestampFieldForStatus(s as TripStatus),
    )
    expect(new Set(campos).size).toBe(3)
  })
})

describe('trips.scenarios — roundOrNull: batería de redondeo', () => {
  const redondean: Array<[string, number, number]> = [
    ['entero positivo', 5, 5],
    ['entero negativo', -5, -5],
    ['cero', 0, 0],
    ['cero negativo', -0, 0],
    ['positivo hacia abajo', 16.4, 16],
    ['positivo hacia arriba', 16.6, 17],
    ['positivo .5 (redondea arriba)', 16.5, 17],
    ['positivo .5 en 2.5', 2.5, 3],
    ['negativo .5 (hacia +Inf)', -2.5, -2],
    ['negativo hacia abajo', -16.6, -17],
    ['negativo hacia arriba', -16.4, -16],
    ['muy pequeño positivo', 0.0001, 0],
    ['muy pequeño negativo', -0.0001, -0],
    ['0.5 exacto', 0.5, 1],
    ['-0.5 exacto (hacia +Inf)', -0.5, -0],
    ['grande', 123456.789, 123457],
    ['km*1000 típico', 16800.4, 16800],
  ]

  it.each(redondean)('roundOrNull(%s) redondea %d → %d', (_l, entrada, esperado) => {
    // Comparamos por igualdad numérica con ==, para no tropezar con la distinción
    // -0 vs +0 (irrelevante para una columna INTEGER: ambos son cero).
    const resultado = roundOrNull(entrada)
    expect(resultado == esperado).toBe(true)
    expect(Number.isInteger(resultado as number)).toBe(true)
  })

  const nulos: Array<[string, number | null | undefined]> = [
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
  ]

  it.each(nulos)('roundOrNull(%s) === null', (_l, entrada) => {
    expect(roundOrNull(entrada)).toBeNull()
  })

  it('roundOrNull(Infinity) queda Infinity (no lo redondea a null)', () => {
    expect(roundOrNull(Infinity)).toBe(Infinity)
  })

  it('roundOrNull(-Infinity) queda -Infinity', () => {
    expect(roundOrNull(-Infinity)).toBe(-Infinity)
  })

  it('roundOrNull(0) devuelve 0 y no null (0 es un valor válido)', () => {
    const r = roundOrNull(0)
    expect(r).toBe(0)
    expect(r).not.toBeNull()
  })

  it('el resultado de un valor decimal siempre es un entero', () => {
    const muestras = [1.1, 2.9, 99.5, -3.3, 1000.4999]
    for (const m of muestras) {
      const r = roundOrNull(m)
      expect(Number.isInteger(r as number)).toBe(true)
    }
  })
})

describe('trips.scenarios — distanceMetersFromRoute: prioridad y formatos', () => {
  it('route null → null', () => {
    expect(distanceMetersFromRoute(null)).toBeNull()
  })

  it('route undefined → null', () => {
    expect(distanceMetersFromRoute(undefined)).toBeNull()
  })

  it('objeto vacío → null', () => {
    expect(distanceMetersFromRoute({})).toBeNull()
  })

  const motor: Array<[string, number, number]> = [
    ['distanceM entero', 16800, 16800],
    ['distanceM decimal redondea abajo', 16800.4, 16800],
    ['distanceM decimal redondea arriba', 16800.6, 16801],
    ['distanceM .5', 100.5, 101],
    ['distanceM cero', 0, 0],
    ['distanceM negativo (no valida signo)', -50.4, -50],
  ]

  it.each(motor)('formato motor: %s → %d', (_l, distanceM, esperado) => {
    expect(distanceMetersFromRoute({ distanceM })).toBe(esperado)
  })

  const movil: Array<[string, number, number]> = [
    ['16.8 km → 16800 m', 16.8, 16800],
    ['1 km → 1000 m', 1, 1000],
    ['0.5 km → 500 m', 0.5, 500],
    ['0 km → 0 m', 0, 0],
    ['16.8005 km → 16800.5 redondea a 16801', 16.8005, 16801],
    ['0.1234 km → 123.4 redondea a 123', 0.1234, 123],
  ]

  it.each(movil)('formato móvil: %s', (_l, km, esperado) => {
    expect(distanceMetersFromRoute({ total_distance_km: km })).toBe(esperado)
  })

  it('distanceM tiene prioridad sobre total_distance_km cuando ambos existen', () => {
    expect(distanceMetersFromRoute({ distanceM: 500, total_distance_km: 99 })).toBe(500)
  })

  it('distanceM === 0 (no null) igual gana sobre total_distance_km', () => {
    expect(distanceMetersFromRoute({ distanceM: 0, total_distance_km: 99 })).toBe(0)
  })

  it('distanceM null cae a total_distance_km', () => {
    expect(distanceMetersFromRoute({ distanceM: null, total_distance_km: 2 })).toBe(2000)
  })

  it('distanceM undefined cae a total_distance_km', () => {
    expect(distanceMetersFromRoute({ distanceM: undefined, total_distance_km: 3 })).toBe(3000)
  })

  it('ambos null → null', () => {
    expect(distanceMetersFromRoute({ distanceM: null, total_distance_km: null })).toBeNull()
  })

  it('total_distance_km null con distanceM ausente → null', () => {
    expect(distanceMetersFromRoute({ total_distance_km: null })).toBeNull()
  })

  it('campos de duración presentes no afectan la distancia', () => {
    expect(
      distanceMetersFromRoute({
        total_distance_km: 5,
        estimatedDurationMin: 999,
        total_duration_min: 999,
      }),
    ).toBe(5000)
  })
})

describe('trips.scenarios — durationMinutesFromRoute: prioridad y formatos', () => {
  it('route null → null', () => {
    expect(durationMinutesFromRoute(null)).toBeNull()
  })

  it('route undefined → null', () => {
    expect(durationMinutesFromRoute(undefined)).toBeNull()
  })

  it('objeto vacío → null', () => {
    expect(durationMinutesFromRoute({})).toBeNull()
  })

  const motor: Array<[string, number, number]> = [
    ['estimatedDurationMin entero', 45, 45],
    ['decimal redondea abajo', 45.4, 45],
    ['decimal redondea arriba', 45.6, 46],
    ['.5 redondea arriba', 45.5, 46],
    ['cero', 0, 0],
  ]

  it.each(motor)('formato motor: %s → %d', (_l, min, esperado) => {
    expect(durationMinutesFromRoute({ estimatedDurationMin: min })).toBe(esperado)
  })

  const movil: Array<[string, number, number]> = [
    ['total_duration_min entero', 30, 30],
    ['total_duration_min decimal', 30.7, 31],
    ['total_duration_min .5', 12.5, 13],
    ['total_duration_min cero', 0, 0],
  ]

  it.each(movil)('formato móvil: %s → %d', (_l, min, esperado) => {
    expect(durationMinutesFromRoute({ total_duration_min: min })).toBe(esperado)
  })

  it('estimatedDurationMin tiene prioridad sobre total_duration_min', () => {
    expect(
      durationMinutesFromRoute({ estimatedDurationMin: 10, total_duration_min: 99 }),
    ).toBe(10)
  })

  it('estimatedDurationMin === 0 (no null) gana sobre total_duration_min', () => {
    expect(durationMinutesFromRoute({ estimatedDurationMin: 0, total_duration_min: 99 })).toBe(0)
  })

  it('estimatedDurationMin null cae a total_duration_min', () => {
    expect(
      durationMinutesFromRoute({ estimatedDurationMin: null, total_duration_min: 20 }),
    ).toBe(20)
  })

  it('estimatedDurationMin undefined cae a total_duration_min', () => {
    expect(
      durationMinutesFromRoute({ estimatedDurationMin: undefined, total_duration_min: 22 }),
    ).toBe(22)
  })

  it('ambos null → null', () => {
    expect(
      durationMinutesFromRoute({ estimatedDurationMin: null, total_duration_min: null }),
    ).toBeNull()
  })

  it('a diferencia de distancia, la duración NO multiplica por 1000', () => {
    expect(durationMinutesFromRoute({ total_duration_min: 5 })).toBe(5)
    expect(distanceMetersFromRoute({ total_distance_km: 5 })).toBe(5000)
  })

  it('campos de distancia presentes no afectan la duración', () => {
    expect(
      durationMinutesFromRoute({
        total_duration_min: 8,
        distanceM: 999,
        total_distance_km: 999,
      }),
    ).toBe(8)
  })
})

describe('trips.scenarios — tripSourceOf / isPersonalTrip', () => {
  const personales: Array<[string, { trip_source?: string | null }]> = [
    ['trip_source exactamente "personal"', { trip_source: 'personal' }],
  ]

  it.each(personales)('%s → personal', (_l, trip) => {
    expect(tripSourceOf(trip)).toBe('personal')
    expect(isPersonalTrip(trip)).toBe(true)
  })

  const empresa: Array<[string, { trip_source?: string | null }]> = [
    ['sin trip_source', {}],
    ['trip_source undefined', { trip_source: undefined }],
    ['trip_source null', { trip_source: null }],
    ['trip_source "company"', { trip_source: 'company' }],
    ['trip_source "Personal" (mayúscula)', { trip_source: 'Personal' }],
    ['trip_source "PERSONAL"', { trip_source: 'PERSONAL' }],
    ['trip_source " personal " (con espacios)', { trip_source: ' personal ' }],
    ['trip_source string vacío', { trip_source: '' }],
    ['trip_source "personal " trailing', { trip_source: 'personal ' }],
    ['trip_source "personals"', { trip_source: 'personals' }],
    ['trip_source otro texto', { trip_source: 'driver' }],
  ]

  it.each(empresa)('%s → company', (_l, trip) => {
    expect(tripSourceOf(trip)).toBe('company')
    expect(isPersonalTrip(trip)).toBe(false)
  })

  it('tripSourceOf sólo devuelve "personal" o "company"', () => {
    const entradas: Array<{ trip_source?: string | null }> = [
      { trip_source: 'personal' },
      { trip_source: 'company' },
      {},
      { trip_source: null },
    ]
    for (const t of entradas) {
      expect(['personal', 'company']).toContain(tripSourceOf(t))
    }
  })
})

describe('trips.scenarios — isAbandonedPersonalTrip: cortocircuitos', () => {
  it('viaje de empresa nunca está abandonado, aunque la ubicación sea vieja', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'company' }
    expect(isAbandonedPersonalTrip(trip, offset(-10 * MINUTE), NOW)).toBe(false)
  })

  it('viaje de empresa sin ubicación tampoco está abandonado', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'company' }
    expect(isAbandonedPersonalTrip(trip, null, NOW)).toBe(false)
  })

  const estadosNoEnCurso: TripStatus[] = ['pending', 'accepted', 'completed', 'cancelled']

  it.each(estadosNoEnCurso)(
    'viaje personal en estado %s (no in_progress) nunca está abandonado, aun sin ubicación',
    (status) => {
      const trip = { status, trip_source: 'personal' }
      expect(isAbandonedPersonalTrip(trip, null, NOW)).toBe(false)
      expect(isAbandonedPersonalTrip(trip, offset(-10 * MINUTE), NOW)).toBe(false)
    },
  )

  it('personal + in_progress + sin ubicación (null) → abandonado (true)', () => {
    const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }
    expect(isAbandonedPersonalTrip(trip, null, NOW)).toBe(true)
  })
})

describe('trips.scenarios — isAbandonedPersonalTrip: grilla temporal (maxAgeMs default 2 min)', () => {
  const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }

  // Con el default de 120000ms: abandonado sólo si (now - last) > 120000 estricto.
  const grilla: Array<[string, Date, boolean]> = [
    ['ubicación justo ahora (0ms)', offset(0), false],
    ['hace 1 segundo', offset(-1 * SECOND), false],
    ['hace 30 segundos', offset(-30 * SECOND), false],
    ['hace 1 minuto', offset(-1 * MINUTE), false],
    ['hace 119 segundos', offset(-119 * SECOND), false],
    ['borde exacto: hace 120000ms (2 min)', offset(-120000), false],
    ['borde -1ms: hace 120001ms', offset(-120001), true],
    ['hace 121 segundos', offset(-121 * SECOND), true],
    ['hace 3 minutos', offset(-3 * MINUTE), true],
    ['hace 1 hora', offset(-60 * MINUTE), true],
    ['ubicación en el futuro (+5s) → no abandonado', offset(5 * SECOND), false],
    ['ubicación en el futuro (+2 min)', offset(2 * MINUTE), false],
  ]

  it.each(grilla)('%s → abandonado=%s', (_l, lastLocationAt, esperado) => {
    expect(isAbandonedPersonalTrip(trip, lastLocationAt, NOW)).toBe(esperado)
  })

  it('el borde exacto (=maxAgeMs) NO es abandonado (comparación estricta >)', () => {
    expect(isAbandonedPersonalTrip(trip, offset(-120000), NOW)).toBe(false)
  })

  it('un solo ms más allá del borde SÍ es abandonado', () => {
    expect(isAbandonedPersonalTrip(trip, offset(-120001), NOW)).toBe(true)
  })
})

describe('trips.scenarios — isAbandonedPersonalTrip: maxAgeMs custom', () => {
  const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }

  const casos: Array<[string, number, number, boolean]> = [
    // [label, maxAgeMs, offsetMs (negativo = pasado), esperado]
    ['maxAge 0: cualquier pasado abandona', 0, -1, true],
    ['maxAge 0: exactamente ahora no abandona', 0, 0, false],
    ['maxAge 1s: hace 1000ms borde → false', 1000, -1000, false],
    ['maxAge 1s: hace 1001ms → true', 1000, -1001, true],
    ['maxAge 1s: hace 999ms → false', 1000, -999, false],
    ['maxAge 5min: hace 5min borde → false', 5 * MINUTE, -5 * MINUTE, false],
    ['maxAge 5min: hace 5min+1ms → true', 5 * MINUTE, -(5 * MINUTE + 1), true],
    ['maxAge 5min: hace 4min → false', 5 * MINUTE, -4 * MINUTE, false],
    ['maxAge 10min: hace 9min → false', 10 * MINUTE, -9 * MINUTE, false],
    ['maxAge 10min: hace 11min → true', 10 * MINUTE, -11 * MINUTE, true],
    ['maxAge 30s: hace 45s → true', 30 * SECOND, -45 * SECOND, true],
    ['maxAge 30s: hace 15s → false', 30 * SECOND, -15 * SECOND, false],
  ]

  it.each(casos)('%s', (_l, maxAgeMs, offMs, esperado) => {
    expect(isAbandonedPersonalTrip(trip, offset(offMs), NOW, maxAgeMs)).toBe(esperado)
  })

  it('con maxAgeMs grande (1 día) casi nada se abandona', () => {
    const unDia = 24 * 60 * MINUTE
    expect(isAbandonedPersonalTrip(trip, offset(-60 * MINUTE), NOW, unDia)).toBe(false)
    expect(isAbandonedPersonalTrip(trip, offset(-(unDia + 1)), NOW, unDia)).toBe(true)
  })

  it('sin ubicación (null) siempre abandona sin importar maxAgeMs', () => {
    expect(isAbandonedPersonalTrip(trip, null, NOW, 0)).toBe(true)
    expect(isAbandonedPersonalTrip(trip, null, NOW, 999999999)).toBe(true)
  })
})

describe('trips.scenarios — isFreshLocation: grilla temporal (default 5 min)', () => {
  const grilla: Array<[string, Date | null | undefined, boolean]> = [
    ['null → no fresca', null, false],
    ['undefined → no fresca', undefined, false],
    ['justo ahora (0ms)', offset(0), true],
    ['hace 1 segundo', offset(-1 * SECOND), true],
    ['hace 1 minuto', offset(-1 * MINUTE), true],
    ['hace 4 minutos', offset(-4 * MINUTE), true],
    ['hace 4:59', offset(-(4 * MINUTE + 59 * SECOND)), true],
    ['borde exacto: hace 5 min (300000ms)', offset(-300000), true],
    ['borde +1ms: hace 300001ms → no fresca', offset(-300001), false],
    ['hace 5:01', offset(-(5 * MINUTE + SECOND)), false],
    ['hace 10 minutos → no fresca', offset(-10 * MINUTE), false],
    ['hace 1 hora → no fresca', offset(-60 * MINUTE), false],
    ['futuro +1s → fresca', offset(1 * SECOND), true],
    ['futuro +10 min → fresca (el signo no importa, dif negativa <= max)', offset(10 * MINUTE), true],
  ]

  it.each(grilla)('%s → fresca=%s', (_l, updatedAt, esperado) => {
    expect(isFreshLocation(updatedAt, NOW)).toBe(esperado)
  })

  it('el borde exacto (=maxAgeMs) SÍ es fresco (comparación <=)', () => {
    expect(isFreshLocation(offset(-300000), NOW)).toBe(true)
  })

  it('un solo ms más allá del borde ya NO es fresco', () => {
    expect(isFreshLocation(offset(-300001), NOW)).toBe(false)
  })

  it('una ubicación en el futuro se considera fresca', () => {
    expect(isFreshLocation(offset(1000 * MINUTE), NOW)).toBe(true)
  })
})

describe('trips.scenarios — isFreshLocation: maxAgeMs custom', () => {
  const casos: Array<[string, number, number, boolean]> = [
    // [label, maxAgeMs, offsetMs, esperado]
    ['maxAge 0: exactamente ahora → fresca', 0, 0, true],
    ['maxAge 0: hace 1ms → no fresca', 0, -1, false],
    ['maxAge 1s: hace 1000ms borde → fresca', 1000, -1000, true],
    ['maxAge 1s: hace 1001ms → no fresca', 1000, -1001, false],
    ['maxAge 1s: hace 500ms → fresca', 1000, -500, true],
    ['maxAge 1min: hace 60s borde → fresca', MINUTE, -MINUTE, true],
    ['maxAge 1min: hace 61s → no fresca', MINUTE, -(MINUTE + SECOND), false],
    ['maxAge 10min: hace 10min borde → fresca', 10 * MINUTE, -10 * MINUTE, true],
    ['maxAge 10min: hace 10min+1ms → no fresca', 10 * MINUTE, -(10 * MINUTE + 1), false],
    ['maxAge 30s: hace 45s → no fresca', 30 * SECOND, -45 * SECOND, false],
    ['maxAge 30s: hace 20s → fresca', 30 * SECOND, -20 * SECOND, true],
  ]

  it.each(casos)('%s', (_l, maxAgeMs, offMs, esperado) => {
    expect(isFreshLocation(offset(offMs), NOW, maxAgeMs)).toBe(esperado)
  })

  it('null/undefined siguen dando no-fresca con cualquier maxAgeMs', () => {
    expect(isFreshLocation(null, NOW, 999999999)).toBe(false)
    expect(isFreshLocation(undefined, NOW, 0)).toBe(false)
  })
})

describe('trips.scenarios — abandono y frescura son criterios independientes', () => {
  const trip = { status: 'in_progress' as TripStatus, trip_source: 'personal' }

  it('a los 3 minutos: abandonado (>2min) pero todavía fresco (<5min)', () => {
    const last = offset(-3 * MINUTE)
    expect(isAbandonedPersonalTrip(trip, last, NOW)).toBe(true)
    expect(isFreshLocation(last, NOW)).toBe(true)
  })

  it('a los 90 segundos: ni abandonado ni desactualizado', () => {
    const last = offset(-90 * SECOND)
    expect(isAbandonedPersonalTrip(trip, last, NOW)).toBe(false)
    expect(isFreshLocation(last, NOW)).toBe(true)
  })

  it('a los 6 minutos: abandonado y ya no fresco', () => {
    const last = offset(-6 * MINUTE)
    expect(isAbandonedPersonalTrip(trip, last, NOW)).toBe(true)
    expect(isFreshLocation(last, NOW)).toBe(false)
  })
})
