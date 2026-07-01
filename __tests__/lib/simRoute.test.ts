/**
 * Tests de la geometría pura de la simulación de recorrido
 * (`src/lib/simRoute.ts`): haversine, rumbo (bearing), aplanado de segmentos y
 * recorte gris/color según el progreso del vehículo.
 */
import {
  haversineMeters,
  bearingDeg,
  flattenSegments,
  splitSegmentsByProgress,
  type LatLng,
  type Segment,
  type SimProgress,
} from '../../src/lib/simRoute'

// Metros por grado de latitud con R = 6371000 (aprox. 111195 m).
const M_PER_DEG = (6371000 * Math.PI) / 180

describe('simRoute — haversineMeters', () => {
  it('distancia cero entre un punto y sí mismo', () => {
    expect(haversineMeters([0, 0], [0, 0])).toBe(0)
    expect(haversineMeters([-34.6, -58.38], [-34.6, -58.38])).toBe(0)
  })

  it('1 grado de latitud ≈ 111195 metros', () => {
    const d = haversineMeters([0, 0], [1, 0])
    expect(d).toBeCloseTo(M_PER_DEG, 0)
  })

  it('es simétrica (a→b === b→a)', () => {
    const a: LatLng = [-34.6037, -58.3816]
    const b: LatLng = [-34.6, -58.4]
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })

  it('devuelve siempre un valor no negativo', () => {
    const pts: LatLng[] = [
      [0, 0],
      [10, 10],
      [-34.6, -58.3],
      [40.7, -74],
      [51.5, -0.12],
    ]
    for (const a of pts) {
      for (const b of pts) {
        expect(haversineMeters(a, b)).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('crece de forma monótona con la separación en latitud', () => {
    const d1 = haversineMeters([0, 0], [1, 0])
    const d2 = haversineMeters([0, 0], [2, 0])
    const d5 = haversineMeters([0, 0], [5, 0])
    expect(d2).toBeGreaterThan(d1)
    expect(d5).toBeGreaterThan(d2)
  })

  it('1 grado de longitud en el ecuador ≈ 1 grado de latitud', () => {
    const dLat = haversineMeters([0, 0], [1, 0])
    const dLng = haversineMeters([0, 0], [0, 1])
    expect(dLng).toBeCloseTo(dLat, -1)
  })

  it('1 grado de longitud se acorta al alejarse del ecuador', () => {
    const atEquator = haversineMeters([0, 0], [0, 1])
    const atMidLat = haversineMeters([60, 0], [60, 1])
    // A 60° de latitud el paralelo mide ~la mitad (cos 60° = 0.5).
    expect(atMidLat).toBeLessThan(atEquator)
    expect(atMidLat / atEquator).toBeCloseTo(0.5, 1)
  })

  it('calcula una distancia realista dentro del AMBA (< 100 km)', () => {
    // Obelisco → La Plata, aprox 55 km.
    const obelisco: LatLng = [-34.6037, -58.3816]
    const laPlata: LatLng = [-34.9215, -57.9545]
    const d = haversineMeters(obelisco, laPlata)
    expect(d).toBeGreaterThan(40000)
    expect(d).toBeLessThan(70000)
  })

  it('distancias pequeñas (~metros) son precisas', () => {
    // ~0.00001 grado ≈ 1.11 m.
    const d = haversineMeters([0, 0], [0.00001, 0])
    expect(d).toBeCloseTo(1.112, 1)
  })

  it('maneja el cruce de hemisferios', () => {
    const d = haversineMeters([-1, 0], [1, 0])
    expect(d).toBeCloseTo(2 * M_PER_DEG, 0)
  })
})

describe('simRoute — bearingDeg', () => {
  it('rumbo hacia el norte = 0°', () => {
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(0, 5)
  })

  it('rumbo hacia el este = 90°', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(90, 5)
  })

  it('rumbo hacia el sur = 180°', () => {
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(180, 5)
  })

  it('rumbo hacia el oeste = 270°', () => {
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(270, 5)
  })

  it('siempre devuelve un valor en [0, 360)', () => {
    const pts: LatLng[] = [
      [0, 0],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
      [-34.6, -58.3],
    ]
    for (const a of pts) {
      for (const b of pts) {
        if (a === b) continue
        const brg = bearingDeg(a, b)
        expect(brg).toBeGreaterThanOrEqual(0)
        expect(brg).toBeLessThan(360)
      }
    }
  })

  it('el noreste está entre 0° y 90°', () => {
    const brg = bearingDeg([0, 0], [1, 1])
    expect(brg).toBeGreaterThan(0)
    expect(brg).toBeLessThan(90)
  })

  it('cerca del ecuador el noreste (Δlat=Δlng) es ≈ 45°', () => {
    const brg = bearingDeg([0, 0], [1, 1])
    expect(brg).toBeCloseTo(45, 0)
  })

  it('el sudoeste está entre 180° y 270°', () => {
    const brg = bearingDeg([0, 0], [-1, -1])
    expect(brg).toBeGreaterThan(180)
    expect(brg).toBeLessThan(270)
  })

  it('rumbos opuestos difieren ~180° cerca del ecuador', () => {
    const ab = bearingDeg([0, 0], [0, 1]) // este = 90
    const ba = bearingDeg([0, 1], [0, 0]) // oeste = 270
    expect(Math.abs(ab - ba)).toBeCloseTo(180, 0)
  })

  it('nunca devuelve exactamente 360 (se normaliza a 0)', () => {
    // Un rumbo que caería en 360 se envuelve a 0 por el módulo.
    const brg = bearingDeg([0, 0], [1, 0])
    expect(brg).not.toBe(360)
  })
})

describe('simRoute — flattenSegments', () => {
  it('devuelve un array vacío para una lista de segmentos vacía', () => {
    expect(flattenSegments([])).toEqual([])
  })

  it('aplana un único segmento a tuplas [lat, lng]', () => {
    const segs: Segment[] = [
      {
        coordinates: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
      },
    ]
    expect(flattenSegments(segs)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('concatena varios segmentos en orden, incluyendo puntos de borde', () => {
    const segs: Segment[] = [
      {
        coordinates: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
        ],
      },
      {
        coordinates: [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
        ],
      },
    ]
    // El punto de borde (1,1) aparece dos veces, igual que en el path plano.
    expect(flattenSegments(segs)).toEqual([
      [0, 0],
      [1, 1],
      [1, 1],
      [2, 2],
    ])
  })

  it('tolera segmentos con coordinates undefined', () => {
    const segs = [
      { coordinates: undefined as any },
      { coordinates: [{ lat: 5, lng: 6 }] },
    ]
    expect(flattenSegments(segs as Segment[])).toEqual([[5, 6]])
  })

  it('tolera un segmento con coordinates vacío', () => {
    const segs: Segment[] = [
      { coordinates: [] },
      { coordinates: [{ lat: 7, lng: 8 }] },
    ]
    expect(flattenSegments(segs)).toEqual([[7, 8]])
  })

  it('preserva el status ignorándolo (sólo importa la geometría)', () => {
    const segs: Segment[] = [
      { coordinates: [{ lat: 1, lng: 1 }], status: 'ok' },
      { coordinates: [{ lat: 2, lng: 2 }], status: 'blocked' },
    ]
    expect(flattenSegments(segs)).toEqual([
      [1, 1],
      [2, 2],
    ])
  })

  it('el total de puntos es la suma de puntos de cada segmento', () => {
    const segs: Segment[] = [
      { coordinates: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 2, lng: 0 }] },
      { coordinates: [{ lat: 2, lng: 0 }, { lat: 3, lng: 0 }] },
    ]
    expect(flattenSegments(segs)).toHaveLength(5)
  })

  it('cada elemento es una tupla de dos números', () => {
    const segs: Segment[] = [
      { coordinates: [{ lat: -34.6, lng: -58.3 }, { lat: -34.7, lng: -58.4 }] },
    ]
    for (const pt of flattenSegments(segs)) {
      expect(pt).toHaveLength(2)
      expect(typeof pt[0]).toBe('number')
      expect(typeof pt[1]).toBe('number')
    }
  })
})

describe('simRoute — splitSegmentsByProgress', () => {
  const straightSegment: Segment[] = [
    {
      coordinates: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
        { lat: 0, lng: 2 },
        { lat: 0, lng: 3 },
      ],
      status: 'ok',
    },
  ]

  it('sin progreso devuelve todo como "remaining" y nada "passed"', () => {
    const res = splitSegmentsByProgress(straightSegment, null)
    expect(res.passed).toEqual([])
    expect(res.remaining).toBe(straightSegment)
  })

  it('progreso al inicio (idx 0, frac 0): passed contiene el punto de arranque interpolado', () => {
    const progress: SimProgress = { idx: 0, frac: 0 }
    const res = splitSegmentsByProgress(straightSegment, progress)
    // El primer punto siempre se copia al passed y el interpolado coincide con él.
    expect(res.passed[0]).toEqual({ latitude: 0, longitude: 0 })
    expect(res.remaining.length).toBe(1)
  })

  it('interpola la posición del vehículo a mitad del primer tramo (idx 0, frac 0.5)', () => {
    const progress: SimProgress = { idx: 0, frac: 0.5 }
    const res = splitSegmentsByProgress(straightSegment, progress)
    // El último punto "passed" debe ser el interpolado exacto (0, 0.5).
    const last = res.passed[res.passed.length - 1]
    expect(last.latitude).toBeCloseTo(0, 10)
    expect(last.longitude).toBeCloseTo(0.5, 10)
  })

  it('el tramo remaining arranca en la posición interpolada del vehículo', () => {
    const progress: SimProgress = { idx: 0, frac: 0.5 }
    const res = splitSegmentsByProgress(straightSegment, progress)
    const firstRemaining = res.remaining[0].coordinates[0]
    expect(firstRemaining.lat).toBeCloseTo(0, 10)
    expect(firstRemaining.lng).toBeCloseTo(0.5, 10)
  })

  it('progreso avanzado (idx 2) deja más puntos en passed que en remaining', () => {
    const progress: SimProgress = { idx: 2, frac: 0.5 }
    const res = splitSegmentsByProgress(straightSegment, progress)
    expect(res.passed.length).toBeGreaterThan(0)
    // Los primeros dos puntos ya fueron recorridos.
    expect(res.passed[0]).toEqual({ latitude: 0, longitude: 0 })
    expect(res.passed[1]).toEqual({ latitude: 0, longitude: 1 })
  })

  it('preserva el status del segmento en remaining', () => {
    const progress: SimProgress = { idx: 0, frac: 0.5 }
    const res = splitSegmentsByProgress(straightSegment, progress)
    expect(res.remaining[0].status).toBe('ok')
  })

  it('descarta segmentos remaining con menos de 2 puntos', () => {
    // idx apuntando al último punto: no queda tramo dibujable.
    const progress: SimProgress = { idx: 3, frac: 0 }
    const res = splitSegmentsByProgress(straightSegment, progress)
    expect(res.remaining).toEqual([])
  })

  it('avanza el contador a través de bordes entre múltiples segmentos', () => {
    const multi: Segment[] = [
      { coordinates: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], status: 'ok' },
      { coordinates: [{ lat: 0, lng: 1 }, { lat: 0, lng: 2 }], status: 'blocked' },
    ]
    // idx 2 = primer punto del segundo segmento (contador global cruza el borde).
    const progress: SimProgress = { idx: 2, frac: 0.5 }
    const res = splitSegmentsByProgress(multi, progress)
    // Todos los puntos del primer segmento están en passed.
    expect(res.passed).toContainEqual({ latitude: 0, longitude: 0 })
    expect(res.passed).toContainEqual({ latitude: 0, longitude: 1 })
    // El remaining, si existe, conserva el status del segmento correspondiente.
    for (const seg of res.remaining) {
      expect(['ok', 'blocked']).toContain(seg.status)
    }
  })

  it('un frac de 0 mantiene el punto exacto sin desplazamiento', () => {
    const progress: SimProgress = { idx: 1, frac: 0 }
    const res = splitSegmentsByProgress(straightSegment, progress)
    const interp = res.remaining[0].coordinates[0]
    expect(interp.lat).toBeCloseTo(0, 10)
    expect(interp.lng).toBeCloseTo(1, 10)
  })

  it('un frac de 1 coloca al vehículo en el siguiente vértice', () => {
    const progress: SimProgress = { idx: 0, frac: 1 }
    const res = splitSegmentsByProgress(straightSegment, progress)
    const last = res.passed[res.passed.length - 1]
    expect(last.latitude).toBeCloseTo(0, 10)
    expect(last.longitude).toBeCloseTo(1, 10)
  })

  it('no muta el arreglo de segmentos original', () => {
    const original: Segment[] = JSON.parse(JSON.stringify(straightSegment))
    splitSegmentsByProgress(straightSegment, { idx: 1, frac: 0.5 })
    expect(straightSegment).toEqual(original)
  })

  it('los puntos passed usan claves {latitude, longitude}', () => {
    const res = splitSegmentsByProgress(straightSegment, { idx: 2, frac: 0.3 })
    for (const p of res.passed) {
      expect(p).toHaveProperty('latitude')
      expect(p).toHaveProperty('longitude')
    }
  })

  it('tolera segmentos con coordinates undefined sin romper', () => {
    const segs = [{ coordinates: undefined as any, status: 'ok' }]
    const res = splitSegmentsByProgress(segs as Segment[], { idx: 0, frac: 0.5 })
    expect(res.remaining).toEqual([])
  })
})
