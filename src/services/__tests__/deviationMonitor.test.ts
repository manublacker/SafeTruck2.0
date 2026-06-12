/**
 * Tests del monitor de desvío con confirmación temporal
 * (`src/services/deviationMonitor.ts`).
 * Requiere `jest` con el preset `jest-expo` (no incluido aún — ver deuda técnica).
 *
 * Escenario base: ruta recta este-oeste a lat -34.60. En ese tramo la distancia
 * perpendicular de un punto es su desfasaje de latitud × 111.320 m/grado, así que
 * un punto a `d` metros al sur del eje está exactamente a `d` m de la ruta.
 * Origen y destino son los extremos del tramo, lejos de los puntos de prueba
 * (que caen en el medio), para no activar la zona muerta sin querer.
 */
import {
  stepDeviationMonitor,
  createDeviationMonitor,
  type DeviationMonitorState,
  type DeviationReading,
} from '../deviationMonitor'
import type { LatLng } from '../routeDeviation'

const ORIGIN: LatLng = { lat: -34.60, lng: -58.42 }
const DEST: LatLng = { lat: -34.60, lng: -58.38 }
const ROUTE: LatLng[] = [ORIGIN, DEST]

const deg = (m: number) => m / 111_320

/** Punto a `metrosSur` metros al sur del eje de la ruta, en el medio del tramo. */
const puntoSur = (metrosSur: number, lng = -58.40): LatLng => ({ lat: -34.60 - deg(metrosSur), lng })

/** Encadena una secuencia de lecturas a través del monitor y devuelve cada resultado. */
function correr(
  lecturas: Array<{ point: LatLng; now: number }>,
  config?: Parameters<typeof stepDeviationMonitor>[2],
) {
  let state: DeviationMonitorState = createDeviationMonitor()
  return lecturas.map(({ point, now }) => {
    const reading: DeviationReading = { point, route: ROUTE, origin: ORIGIN, destination: DEST, now }
    const res = stepDeviationMonitor(state, reading, config)
    state = res.state
    return res
  })
}

describe('stepDeviationMonitor — confirmación', () => {
  it('confirma en la 3ra lectura consecutiva fuera y alejándose', () => {
    const r = correr([
      { point: puntoSur(60), now: 0 },
      { point: puntoSur(70), now: 4000 },
      { point: puntoSur(80), now: 8000 },
    ])
    expect(r.map(x => x.status)).toEqual(['pending', 'pending', 'confirmed'])
    expect(r.map(x => x.triggered)).toEqual([false, false, true])
  })

  it('una sola lectura fuera no dispara', () => {
    const r = correr([{ point: puntoSur(80), now: 0 }])
    expect(r[0].triggered).toBe(false)
    expect(r[0].status).toBe('pending')
  })

  it('una lectura dentro de tolerancia reinicia la racha', () => {
    const r = correr([
      { point: puntoSur(60), now: 0 },     // pending (racha 1)
      { point: puntoSur(70), now: 4000 },  // pending (racha 2)
      { point: puntoSur(10), now: 8000 },  // EN RUTA → reinicia
      { point: puntoSur(60), now: 12000 }, // pending (racha 1 de nuevo)
      { point: puntoSur(70), now: 16000 }, // pending (racha 2)
      { point: puntoSur(80), now: 20000 }, // confirmed (racha 3)
    ])
    expect(r.map(x => x.status)).toEqual(['pending', 'pending', 'on_route', 'pending', 'pending', 'confirmed'])
    expect(r[5].triggered).toBe(true)
  })
})

describe('stepDeviationMonitor — alejándose vs rebote', () => {
  it('un regreso hacia la ruta (>tolerancia) corta la racha', () => {
    const r = correr([
      { point: puntoSur(70), now: 0 },     // pending
      { point: puntoSur(55), now: 4000 },  // fuera pero se acercó 15 m → pending sin sumar
      { point: puntoSur(60), now: 8000 },  // vuelve a alejarse → racha 1
    ])
    expect(r.map(x => x.status)).toEqual(['pending', 'pending', 'pending'])
    expect(r.every(x => !x.triggered)).toBe(true)
  })

  it('una caída menor a la tolerancia (jitter) no corta la racha', () => {
    // 60 → 58 (cae 2 m, < growTolerance 5) → la racha sigue; 58 → 80 confirma.
    const r = correr([
      { point: puntoSur(60), now: 0 },     // racha 1
      { point: puntoSur(58), now: 4000 },  // racha 2 (dentro de tolerancia)
      { point: puntoSur(80), now: 8000 },  // racha 3 → confirmed
    ])
    expect(r[2].status).toBe('confirmed')
    expect(r[2].triggered).toBe(true)
  })
})

describe('stepDeviationMonitor — cooldown', () => {
  it('no vuelve a disparar dentro del cooldown', () => {
    const r = correr([
      { point: puntoSur(60), now: 0 },
      { point: puntoSur(70), now: 4000 },
      { point: puntoSur(80), now: 8000 },   // confirmed (cooldownUntil = 8000 + 30000)
      { point: puntoSur(90), now: 12000 },  // dentro del cooldown
      { point: puntoSur(100), now: 16000 }, // dentro del cooldown
    ])
    expect(r[2].triggered).toBe(true)
    expect(r[3].status).toBe('cooldown')
    expect(r[4].status).toBe('cooldown')
    expect(r[3].triggered).toBe(false)
  })

  it('vuelve a disparar una vez vencido el cooldown', () => {
    const r = correr([
      { point: puntoSur(60), now: 0 },
      { point: puntoSur(70), now: 4000 },
      { point: puntoSur(80), now: 8000 },    // confirmed @8000, cooldown hasta 38000
      { point: puntoSur(60), now: 40000 },   // cooldown vencido → racha 1
      { point: puntoSur(70), now: 44000 },   // racha 2
      { point: puntoSur(80), now: 48000 },   // racha 3 → confirmed de nuevo
    ])
    expect(r[2].triggered).toBe(true)
    expect(r[5].triggered).toBe(true)
    expect(r[5].status).toBe('confirmed')
  })
})

describe('stepDeviationMonitor — zonas muertas y ruta inválida', () => {
  it('ignora el desvío cerca del origen (zona muerta)', () => {
    // 70 m al sur del origen: fuera de ruta (>50) pero dentro de la zona muerta (<80).
    const cerca: LatLng = { lat: ORIGIN.lat - deg(70), lng: ORIGIN.lng }
    const r = correr([
      { point: cerca, now: 0 },
      { point: cerca, now: 4000 },
      { point: cerca, now: 8000 },
    ])
    expect(r.every(x => x.status === 'dead_zone')).toBe(true)
    expect(r.every(x => !x.triggered)).toBe(true)
  })

  it('no evalúa sin una ruta válida', () => {
    let state = createDeviationMonitor()
    const res = stepDeviationMonitor(state, { point: puntoSur(80), route: [], origin: ORIGIN, destination: DEST, now: 0 })
    expect(res.status).toBe('no_route')
    expect(res.triggered).toBe(false)
  })

  it('la zona muerta tiene prioridad sobre una racha ya iniciada y la resetea', () => {
    const cerca: LatLng = { lat: ORIGIN.lat - deg(70), lng: ORIGIN.lng }
    const r = correr([
      { point: puntoSur(60), now: 0 },     // racha 1
      { point: puntoSur(70), now: 4000 },  // racha 2 (a un paso de confirmar)
      { point: cerca, now: 8000 },         // entra a zona muerta → NO confirma, resetea
      { point: puntoSur(80), now: 12000 }, // racha vuelve a 1, no a 3
    ])
    expect(r[2].status).toBe('dead_zone')
    expect(r[2].triggered).toBe(false)
    expect(r[3].triggered).toBe(false) // si no se hubiera reseteado, acá dispararía
    expect(r[3].status).toBe('pending')
  })

  it('apaga la detección si origen/destino tienen coordenadas inválidas (NaN)', () => {
    let state = createDeviationMonitor()
    const res = stepDeviationMonitor(state, {
      point: puntoSur(80),
      route: ROUTE,
      origin: { lat: NaN, lng: NaN },
      destination: DEST,
      now: 0,
    })
    expect(res.status).toBe('dead_zone')
    expect(res.triggered).toBe(false)
  })

  it('puede disparar en el instante exacto en que vence el cooldown', () => {
    const r = correr([
      { point: puntoSur(60), now: 0 },
      { point: puntoSur(70), now: 4000 },
      { point: puntoSur(80), now: 8000 },     // confirmed @8000 → cooldown hasta 38000
      { point: puntoSur(60), now: 38000 },    // borde exacto: cooldown ya NO activo → racha 1
      { point: puntoSur(70), now: 42000 },    // racha 2
      { point: puntoSur(80), now: 46000 },    // racha 3 → confirmed
    ])
    expect(r[3].status).toBe('pending') // en el borde ya evalúa, no es 'cooldown'
    expect(r[5].triggered).toBe(true)
  })
})
