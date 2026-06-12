/**
 * Tests de la detección de desvío de ruta (`src/services/routeDeviation.ts`).
 * Requiere `jest` con el preset `jest-expo` (no incluido aún — ver deuda técnica).
 *
 * Las rutas de prueba usan un tramo este-oeste a latitud constante: ahí la
 * distancia perpendicular es simplemente el desfasaje de latitud × 111.320 m/grado,
 * lo que hace las cuentas predecibles sin depender del coseno de la longitud.
 */
import {
  checkDeviation,
  distanceToRoute,
  metersBetween,
  toLatLng,
  DEVIATION_THRESHOLD_M,
  type LatLng,
} from '../routeDeviation'

// Tramo recto este-oeste a lat -34.60 (≈ Buenos Aires).
const RUTA: LatLng[] = [
  { lat: -34.60, lng: -58.42 },
  { lat: -34.60, lng: -58.38 },
]

// Un grado de latitud ≈ 111.320 m; lo usamos para construir desfasajes exactos.
const degParaMetros = (m: number) => m / 111_320

describe('distanceToRoute', () => {
  it('da ~0 para un punto sobre la ruta', () => {
    const { distanceM } = distanceToRoute({ lat: -34.60, lng: -58.40 }, RUTA)
    expect(distanceM).toBeLessThan(1)
  })

  it('mide la distancia perpendicular real (≈111 m a 0.001° de latitud)', () => {
    const { distanceM } = distanceToRoute({ lat: -34.601, lng: -58.40 }, RUTA)
    expect(distanceM).toBeGreaterThan(105)
    expect(distanceM).toBeLessThan(115)
  })

  it('devuelve el índice del segmento más cercano', () => {
    const { segmentIndex } = distanceToRoute({ lat: -34.6005, lng: -58.40 }, RUTA)
    expect(segmentIndex).toBe(0)
  })

  it('elige el segmento correcto en una ruta multi-tramo (en "L")', () => {
    // Ruta en L: tramo 0 horizontal (este-oeste), tramo 1 vertical (norte-sur).
    const rutaL: LatLng[] = [
      { lat: -34.60, lng: -58.42 },
      { lat: -34.60, lng: -58.40 }, // vértice del codo
      { lat: -34.62, lng: -58.40 },
    ]
    // Un punto pegado al tramo vertical debe seleccionar el segmento 1, no el 0.
    expect(distanceToRoute({ lat: -34.61, lng: -58.4005 }, rutaL).segmentIndex).toBe(1)
    // Y uno pegado al tramo horizontal, el segmento 0.
    expect(distanceToRoute({ lat: -34.6005, lng: -58.41 }, rutaL).segmentIndex).toBe(0)
  })

  it('no propaga NaN: un punto GPS con coordenada inválida da Infinity / -1', () => {
    expect(distanceToRoute({ lat: NaN, lng: -58.40 }, RUTA)).toEqual({ distanceM: Infinity, segmentIndex: -1 })
  })

  it('mide contra el vértice final cuando el punto se pasa del tramo (doblar en la esquina)', () => {
    // Punto 0.001° al este del fin de ruta: al recortar la proyección al tramo,
    // la distancia se mide contra el vértice, no contra la recta infinita.
    const finLng = -58.38
    const { distanceM } = distanceToRoute({ lat: -34.60, lng: finLng + degParaMetros(100) / Math.cos((-34.6 * Math.PI) / 180) }, RUTA)
    expect(distanceM).toBeGreaterThan(90)
    expect(distanceM).toBeLessThan(110)
  })

  it('devuelve Infinity y segmentIndex -1 si la ruta tiene menos de 2 puntos', () => {
    expect(distanceToRoute({ lat: -34.60, lng: -58.40 }, [])).toEqual({ distanceM: Infinity, segmentIndex: -1 })
    expect(distanceToRoute({ lat: -34.60, lng: -58.40 }, [{ lat: -34.60, lng: -58.40 }])).toEqual({
      distanceM: Infinity,
      segmentIndex: -1,
    })
  })
})

describe('checkDeviation', () => {
  it('no marca desvío justo por debajo del umbral (≈44 m)', () => {
    const punto = { lat: -34.60 - degParaMetros(44), lng: -58.40 }
    expect(checkDeviation(punto, RUTA).isOff).toBe(false)
  })

  it('marca desvío por encima del umbral (≈67 m)', () => {
    const punto = { lat: -34.60 - degParaMetros(67), lng: -58.40 }
    const res = checkDeviation(punto, RUTA)
    expect(res.isOff).toBe(true)
    expect(res.distanceM).toBeGreaterThan(DEVIATION_THRESHOLD_M)
  })

  it('respeta un umbral personalizado', () => {
    const punto = { lat: -34.60 - degParaMetros(67), lng: -58.40 }
    expect(checkDeviation(punto, RUTA, 100).isOff).toBe(false)
  })

  it('no marca desvío si no hay ruta válida', () => {
    expect(checkDeviation({ lat: -34.60, lng: -58.40 }, []).isOff).toBe(false)
  })

  it('no marca desvío ante coordenadas inválidas (NaN)', () => {
    expect(checkDeviation({ lat: NaN, lng: -58.40 }, RUTA).isOff).toBe(false)
  })
})

describe('metersBetween', () => {
  it('mide ~111 m entre dos puntos a 0.001° de latitud', () => {
    const d = metersBetween({ lat: -34.60, lng: -58.40 }, { lat: -34.601, lng: -58.40 })
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })

  it('da 0 entre un punto y sí mismo', () => {
    expect(metersBetween({ lat: -34.60, lng: -58.40 }, { lat: -34.60, lng: -58.40 })).toBe(0)
  })
})

describe('toLatLng', () => {
  it('normaliza un punto con lng', () => {
    expect(toLatLng({ lat: -34.60, lng: -58.40 })).toEqual({ lat: -34.60, lng: -58.40 })
  })

  it('normaliza un punto con lon (formato del path de viajes)', () => {
    expect(toLatLng({ lat: -34.60, lon: -58.40 })).toEqual({ lat: -34.60, lng: -58.40 })
  })

  it('deja lng en NaN si faltan ambos campos (no inventa lng 0)', () => {
    expect(toLatLng({ lat: -34.60 }).lng).toBeNaN()
  })
})
