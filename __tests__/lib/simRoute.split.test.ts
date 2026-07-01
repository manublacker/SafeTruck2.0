/**
 * Tests EXHAUSTIVOS del aplanado y del recorte por progreso de
 * `src/lib/simRoute.ts`: `flattenSegments` y `splitSegmentsByProgress`. El foco
 * está en el recorte gris/color según `idx`/`frac` (estilo Waze), con muchos
 * casos de multi-segmento, bordes, status variados y degenerados.
 */
import {
  flattenSegments,
  splitSegmentsByProgress,
  type Segment,
  type SimProgress,
} from '../../src/lib/simRoute'

// Helper: construye un Coord {lat,lng} de forma compacta.
const c = (lat: number, lng: number) => ({ lat, lng })

// Helper: construye un Segment con status opcional.
const seg = (coords: Array<{ lat: number; lng: number }>, status?: string): Segment =>
  status === undefined ? { coordinates: coords } : { coordinates: coords, status }

describe('simRoute — flattenSegments', () => {
  it('aplana un único segmento a tuplas [lat,lng] en orden', () => {
    const s = [seg([c(1, 2), c(3, 4), c(5, 6)])]
    expect(flattenSegments(s)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
  })

  it('devuelve un array vacío para lista de segmentos vacía', () => {
    expect(flattenSegments([])).toEqual([])
  })

  it('concatena varios segmentos preservando los puntos de borde (duplicados)', () => {
    // El último punto de un segmento coincide con el primero del siguiente y
    // se incluyen AMBOS (borde duplicado), igual que el path plano.
    const s = [
      seg([c(0, 0), c(1, 1)]),
      seg([c(1, 1), c(2, 2)]),
      seg([c(2, 2), c(3, 3)]),
    ]
    expect(flattenSegments(s)).toEqual([
      [0, 0],
      [1, 1],
      [1, 1],
      [2, 2],
      [2, 2],
      [3, 3],
    ])
  })

  it('cuenta correctamente la longitud total (suma de puntos, con bordes)', () => {
    const s = [
      seg([c(0, 0), c(1, 1), c(2, 2)]),
      seg([c(2, 2), c(3, 3)]),
      seg([c(3, 3), c(4, 4), c(5, 5), c(6, 6)]),
    ]
    expect(flattenSegments(s)).toHaveLength(3 + 2 + 4)
  })

  it('tolera un segmento con coordinates undefined (lo saltea)', () => {
    const s = [
      { coordinates: undefined as unknown as { lat: number; lng: number }[] },
      seg([c(7, 8)]),
    ]
    expect(flattenSegments(s)).toEqual([[7, 8]])
  })

  it('tolera un segmento con coordinates vacío (aporta 0 puntos)', () => {
    const s = [seg([c(1, 1)]), seg([]), seg([c(2, 2)])]
    expect(flattenSegments(s)).toEqual([
      [1, 1],
      [2, 2],
    ])
  })

  it('tolera TODOS los segmentos vacíos/undefined', () => {
    const s = [
      seg([]),
      { coordinates: undefined as unknown as { lat: number; lng: number }[] },
      seg([]),
    ]
    expect(flattenSegments(s)).toEqual([])
  })

  it('preserva un único punto por segmento', () => {
    const s = [seg([c(10, 20)]), seg([c(30, 40)]), seg([c(50, 60)])]
    expect(flattenSegments(s)).toEqual([
      [10, 20],
      [30, 40],
      [50, 60],
    ])
  })

  it('no muta los segmentos originales', () => {
    const original = [seg([c(1, 1), c(2, 2)])]
    const copia = JSON.parse(JSON.stringify(original))
    flattenSegments(original)
    expect(original).toEqual(copia)
  })

  it('mantiene valores negativos y decimales reales del AMBA', () => {
    const s = [seg([c(-34.6037, -58.3816), c(-34.6099, -58.3921)])]
    expect(flattenSegments(s)).toEqual([
      [-34.6037, -58.3816],
      [-34.6099, -58.3921],
    ])
  })

  it('ignora la propiedad status al aplanar', () => {
    const s = [seg([c(1, 1), c(2, 2)], 'apto'), seg([c(2, 2), c(3, 3)], 'no_apto')]
    expect(flattenSegments(s)).toEqual([
      [1, 1],
      [2, 2],
      [2, 2],
      [3, 3],
    ])
  })
})

describe('simRoute — splitSegmentsByProgress: progreso null', () => {
  it('progress null → passed vacío y remaining = segments (misma referencia)', () => {
    const segments = [seg([c(0, 0), c(1, 1)]), seg([c(1, 1), c(2, 2)])]
    const res = splitSegmentsByProgress(segments, null)
    expect(res.passed).toEqual([])
    expect(res.remaining).toBe(segments)
  })

  it('progress null con lista vacía → passed vacío, remaining vacío (misma ref)', () => {
    const segments: Segment[] = []
    const res = splitSegmentsByProgress(segments, null)
    expect(res.passed).toEqual([])
    expect(res.remaining).toBe(segments)
  })
})

describe('simRoute — splitSegmentsByProgress: un solo segmento', () => {
  const base = [seg([c(0, 0), c(0, 10)])]

  it('idx 0, frac 0 → passed = [inicio, inicio], remaining arranca en el interp (=inicio)', () => {
    const res = splitSegmentsByProgress(base, { idx: 0, frac: 0 })
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0 },
    ])
    expect(res.remaining).toHaveLength(1)
    // segRemaining = [interp(=inicio), b] por el interp, y luego el else re-empuja b.
    expect(res.remaining[0].coordinates).toEqual([c(0, 0), c(0, 10), c(0, 10)])
  })

  it('idx 0, frac 0.5 → interpola el punto medio', () => {
    const res = splitSegmentsByProgress(base, { idx: 0, frac: 0.5 })
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 5 },
    ])
    // [interp, b] del interp + b re-empujado por el else en el último punto.
    expect(res.remaining[0].coordinates).toEqual([c(0, 5), c(0, 10), c(0, 10)])
  })

  it.each<[number, number]>([
    [0, 0],
    [0.25, 2.5],
    [0.5, 5],
    [0.75, 7.5],
    [1, 10],
  ])('idx 0, frac %s interpola la longitud en %s', (frac, esperadoLng) => {
    const res = splitSegmentsByProgress(base, { idx: 0, frac })
    expect(res.passed[0]).toEqual({ latitude: 0, longitude: 0 })
    expect(res.passed[1].longitude).toBeCloseTo(esperadoLng, 10)
    expect(res.passed[1].latitude).toBeCloseTo(0, 10)
    // remaining arranca en el punto interpolado.
    expect(res.remaining[0].coordinates[0].lng).toBeCloseTo(esperadoLng, 10)
    expect(res.remaining[0].coordinates[1]).toEqual(c(0, 10))
  })

  it('interpola también la latitud en un tramo diagonal', () => {
    const diag = [seg([c(0, 0), c(10, 20)])]
    const res = splitSegmentsByProgress(diag, { idx: 0, frac: 0.3 })
    expect(res.passed[1].latitude).toBeCloseTo(3, 10)
    expect(res.passed[1].longitude).toBeCloseTo(6, 10)
    expect(res.remaining[0].coordinates[0].lat).toBeCloseTo(3, 10)
    expect(res.remaining[0].coordinates[0].lng).toBeCloseTo(6, 10)
  })
})

describe('simRoute — splitSegmentsByProgress: multi-punto en un segmento', () => {
  // Un solo segmento con 4 puntos: contador global 0,1,2,3.
  const s = [seg([c(0, 0), c(0, 10), c(0, 20), c(0, 30)])]

  it('idx 0, frac 0.5 → sólo el primer punto queda "atrás", resto en remaining', () => {
    const res = splitSegmentsByProgress(s, { idx: 0, frac: 0.5 })
    // passed: [punto0, interp entre 0 y 1]
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 5 },
    ])
    // remaining: [interp, p1] (del interp) + p1,p2,p3 (else en i=1,2,3) → p1 duplicado.
    expect(res.remaining[0].coordinates).toEqual([
      c(0, 5),
      c(0, 10),
      c(0, 10),
      c(0, 20),
      c(0, 30),
    ])
  })

  it('idx 2, frac 0 → p0,p1 pasados, interp de p2 con frac 0 = p2', () => {
    const res = splitSegmentsByProgress(s, { idx: 2, frac: 0 })
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 20 }, // p2 empujado
      { latitude: 0, longitude: 20 }, // interp frac 0 = p2
    ])
    // [interp(=p2), p3] + p3 re-empujado por el else en i=3.
    expect(res.remaining[0].coordinates).toEqual([c(0, 20), c(0, 30), c(0, 30)])
  })

  it('idx 2, frac 0.5 → interp entre p2 y p3', () => {
    const res = splitSegmentsByProgress(s, { idx: 2, frac: 0.5 })
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 20 },
      { latitude: 0, longitude: 25 },
    ])
    expect(res.remaining[0].coordinates).toEqual([c(0, 25), c(0, 30), c(0, 30)])
  })

  it('idx apuntando al ÚLTIMO punto (i === length-1): no interpola, va a remaining', () => {
    // idx 3 = último punto del segmento. Como i < length-1 es falso y
    // pointCounter !== idx no aplica (es igual pero i no cumple), cae al else:
    // se empuja coords[3] a segRemaining. Pero segRemaining sólo tendría 1 → se descarta.
    const res = splitSegmentsByProgress(s, { idx: 3, frac: 0.5 })
    // p0,p1,p2 pasados; p3 (último) → segRemaining=[p3] (len 1) → NO entra a remaining.
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 20 },
    ])
    expect(res.remaining).toEqual([])
  })

  it('idx mayor a todos los puntos → todo pasado, remaining vacío', () => {
    const res = splitSegmentsByProgress(s, { idx: 99, frac: 0.5 })
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 20 },
      { latitude: 0, longitude: 30 },
    ])
    expect(res.remaining).toEqual([])
  })
})

describe('simRoute — splitSegmentsByProgress: contador global entre 2 segmentos', () => {
  // Seg A: puntos globales 0,1,2 ; Seg B: puntos globales 3,4 (borde duplicado).
  const segments = [seg([c(0, 0), c(0, 10), c(0, 20)]), seg([c(0, 20), c(0, 30)])]

  it('idx 0: recorte en el primer segmento, el segundo queda intacto', () => {
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 5 },
    ])
    expect(res.remaining).toHaveLength(2)
    // [interp, p1] + p1,p2 (else) → p1 duplicado.
    expect(res.remaining[0].coordinates).toEqual([c(0, 5), c(0, 10), c(0, 10), c(0, 20)])
    expect(res.remaining[1].coordinates).toEqual([c(0, 20), c(0, 30)])
  })

  it('idx 2 (último punto del seg A): seg A no interpola y se descarta', () => {
    // Global idx 2 = tercer punto del seg A, que es su ÚLTIMO punto (i=2=len-1).
    // else → segRemaining=[p2] (len 1) → seg A descartado. Seg B intacto.
    const res = splitSegmentsByProgress(segments, { idx: 2, frac: 0.5 })
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
    ])
    // Seg A: p2 solo → descartado. Seg B: ambos puntos > idx → van a remaining.
    expect(res.remaining).toHaveLength(1)
    expect(res.remaining[0].coordinates).toEqual([c(0, 20), c(0, 30)])
  })

  it('idx 3 (primer punto del seg B): recorte dentro del seg B', () => {
    // Globales 0,1,2 del seg A pasados. Seg A completo pasado → segRemaining vacío
    // → descartado. En seg B, global 3 = i=0, i<len-1 → interpola.
    const res = splitSegmentsByProgress(segments, { idx: 3, frac: 0.5 })
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 20 }, // p2 del seg A
      { latitude: 0, longitude: 20 }, // p0 del seg B (borde duplicado)
      { latitude: 0, longitude: 25 }, // interp del seg B
    ])
    expect(res.remaining).toHaveLength(1)
    expect(res.remaining[0].coordinates).toEqual([c(0, 25), c(0, 30), c(0, 30)])
  })

  it('idx 4 (último punto del seg B): todo pasado, remaining vacío', () => {
    const res = splitSegmentsByProgress(segments, { idx: 4, frac: 0 })
    // Globales 0,1,2 (seg A) van a passed; en seg B global 3 (i=0) interpola con
    // frac 0 → empuja p0 y interp(=p0); global 4 (i=1=len-1) va a segRemaining
    // pero queda len 1 → seg B descartado. passed = 4 puntos.
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 20 },
      { latitude: 0, longitude: 20 },
    ])
    expect(res.remaining).toEqual([])
  })

  it('el contador NO se reinicia por segmento (idx 3 cae en el seg B, no en el A)', () => {
    // Prueba explícita de que el contador es GLOBAL: idx 3 no puede referirse a
    // ningún punto del seg A (que sólo tiene índices globales 0,1,2).
    const res = splitSegmentsByProgress(segments, { idx: 3, frac: 0.25 })
    // El punto interpolado 0.25 entre (0,20) y (0,30) es (0, 22.5) en el seg B.
    const ultimoPassed = res.passed[res.passed.length - 1]
    expect(ultimoPassed.longitude).toBeCloseTo(22.5, 10)
  })
})

describe('simRoute — splitSegmentsByProgress: borde entre 3 segmentos', () => {
  // A: 0,1 ; B: 2,3 ; C: 4,5  (todos con borde duplicado).
  const segments = [
    seg([c(0, 0), c(0, 10)], 'apto'),
    seg([c(0, 10), c(0, 20)], 'no_apto'),
    seg([c(0, 20), c(0, 30)], 'apto'),
  ]

  it('idx 0: recorta A, mantiene B y C', () => {
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    expect(res.remaining).toHaveLength(3)
    // Seg A recortado: [interp, b] + b (else) → b duplicado.
    expect(res.remaining[0].coordinates).toEqual([c(0, 5), c(0, 10), c(0, 10)])
    expect(res.remaining[1].coordinates).toEqual([c(0, 10), c(0, 20)])
    expect(res.remaining[2].coordinates).toEqual([c(0, 20), c(0, 30)])
  })

  it('idx 2 (arranque de B): A descartado, recorta B, mantiene C', () => {
    const res = splitSegmentsByProgress(segments, { idx: 2, frac: 0.5 })
    // A: globales 0,1 pasados → descartado.
    expect(res.remaining).toHaveLength(2)
    expect(res.remaining[0].coordinates).toEqual([c(0, 15), c(0, 20), c(0, 20)])
    expect(res.remaining[1].coordinates).toEqual([c(0, 20), c(0, 30)])
    expect(res.remaining[0].status).toBe('no_apto')
    expect(res.remaining[1].status).toBe('apto')
  })

  it('idx 4 (arranque de C): A y B descartados, recorta sólo C', () => {
    const res = splitSegmentsByProgress(segments, { idx: 4, frac: 0.5 })
    expect(res.remaining).toHaveLength(1)
    expect(res.remaining[0].coordinates).toEqual([c(0, 25), c(0, 30), c(0, 30)])
    expect(res.remaining[0].status).toBe('apto')
  })

  it.each<[number, number]>([
    [0, 3],
    [2, 2],
    [4, 1],
  ])('idx %s deja %s segmentos en remaining', (idx, cuantos) => {
    const res = splitSegmentsByProgress(segments, { idx, frac: 0.5 })
    expect(res.remaining).toHaveLength(cuantos)
  })
})

describe('simRoute — splitSegmentsByProgress: preserva status', () => {
  it('el status del segmento recortado se conserva en remaining', () => {
    const segments = [seg([c(0, 0), c(0, 10), c(0, 20)], 'restringido')]
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    expect(res.remaining[0].status).toBe('restringido')
  })

  it.each<[string]>([['apto'], ['no_apto'], ['restringido'], ['sin_dato'], ['']])(
    'conserva el status "%s"',
    (status) => {
      const segments = [seg([c(0, 0), c(0, 10), c(0, 20)], status)]
      const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
      expect(res.remaining[0].status).toBe(status)
    },
  )

  it('un segmento sin status queda con status undefined en remaining', () => {
    const segments = [seg([c(0, 0), c(0, 10), c(0, 20)])]
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    expect(res.remaining[0].status).toBeUndefined()
    expect('status' in res.remaining[0]).toBe(false)
  })

  it('preserva distintos status a lo largo de varios segmentos remaining', () => {
    const segments = [
      seg([c(0, 0), c(0, 5), c(0, 10)], 'A'),
      seg([c(0, 10), c(0, 15), c(0, 20)], 'B'),
      seg([c(0, 20), c(0, 25), c(0, 30)], 'C'),
    ]
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    expect(res.remaining.map((r) => r.status)).toEqual(['A', 'B', 'C'])
  })
})

describe('simRoute — splitSegmentsByProgress: inmutabilidad', () => {
  it('no muta el arreglo de segmentos original', () => {
    const segments = [seg([c(0, 0), c(0, 10), c(0, 20)], 'apto'), seg([c(0, 20), c(0, 30)], 'no_apto')]
    const copia = JSON.parse(JSON.stringify(segments))
    splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    expect(segments).toEqual(copia)
  })

  it('no muta las coordenadas internas de los segmentos', () => {
    const coords = [c(0, 0), c(0, 10), c(0, 20)]
    const segments = [seg(coords)]
    splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    expect(coords).toEqual([c(0, 0), c(0, 10), c(0, 20)])
  })

  it('el remaining es un array nuevo (no la misma referencia) cuando hay progress', () => {
    const segments = [seg([c(0, 0), c(0, 10), c(0, 20)])]
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    expect(res.remaining).not.toBe(segments)
  })

  it('cada segmento de remaining es un objeto nuevo (spread), no el original', () => {
    const segments = [seg([c(0, 0), c(0, 10), c(0, 20)], 'apto')]
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    expect(res.remaining[0]).not.toBe(segments[0])
  })
})

describe('simRoute — splitSegmentsByProgress: casos degenerados', () => {
  it('segmento con coordinates vacío se saltea sin romper el contador', () => {
    const segments = [seg([c(0, 0), c(0, 10), c(0, 20)]), seg([]), seg([c(0, 20), c(0, 30)])]
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    // El seg vacío no aporta puntos ni entra a remaining (len 0 < 2).
    expect(res.remaining).toHaveLength(2)
    expect(res.remaining[0].coordinates).toEqual([c(0, 5), c(0, 10), c(0, 10), c(0, 20)])
    expect(res.remaining[1].coordinates).toEqual([c(0, 20), c(0, 30)])
  })

  it('segmento con coordinates undefined se tolera (?? [])', () => {
    const segments: Segment[] = [
      { coordinates: undefined as unknown as { lat: number; lng: number }[] },
      seg([c(0, 0), c(0, 10), c(0, 20)]),
    ]
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    // El primer seg aporta 0 puntos; el recorte ocurre en el segundo desde global idx 0.
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 5 },
    ])
    expect(res.remaining).toHaveLength(1)
    expect(res.remaining[0].coordinates).toEqual([c(0, 5), c(0, 10), c(0, 10), c(0, 20)])
  })

  it('segmento de UN solo punto nunca entra a remaining (len < 2)', () => {
    const segments = [seg([c(5, 5)])]
    const res0 = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    // idx 0, i=0=len-1 → no interpola, else → segRemaining=[p] (len 1) → descartado.
    expect(res0.remaining).toEqual([])
    expect(res0.passed).toEqual([])
  })

  it('segmento de un solo punto con idx mayor → pasa a passed', () => {
    const segments = [seg([c(5, 5)])]
    const res = splitSegmentsByProgress(segments, { idx: 1, frac: 0 })
    expect(res.passed).toEqual([{ latitude: 5, longitude: 5 }])
    expect(res.remaining).toEqual([])
  })

  it('varios segmentos de un solo punto: todos van a passed según idx', () => {
    const segments = [seg([c(0, 0)]), seg([c(1, 1)]), seg([c(2, 2)])]
    const res = splitSegmentsByProgress(segments, { idx: 5, frac: 0 })
    expect(res.passed).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 1 },
      { latitude: 2, longitude: 2 },
    ])
    expect(res.remaining).toEqual([])
  })

  it('lista de segmentos vacía con progress → passed y remaining vacíos', () => {
    const res = splitSegmentsByProgress([], { idx: 0, frac: 0.5 })
    expect(res.passed).toEqual([])
    expect(res.remaining).toEqual([])
  })

  it('frac negativo interpola "hacia atrás" (extrapolación literal)', () => {
    // El código no clampa frac: frac -1 da a.lng + (b.lng-a.lng)*(-1).
    const segments = [seg([c(0, 10), c(0, 20)])]
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: -1 })
    expect(res.passed[1].longitude).toBeCloseTo(0, 10) // 10 + 10*(-1) = 0
    expect(res.remaining[0].coordinates[0].lng).toBeCloseTo(0, 10)
  })

  it('frac mayor a 1 extrapola más allá del punto b (sin clamp)', () => {
    const segments = [seg([c(0, 10), c(0, 20)])]
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 2 })
    expect(res.passed[1].longitude).toBeCloseTo(30, 10) // 10 + 10*2 = 30
  })
})

describe('simRoute — splitSegmentsByProgress: ruta larga multi-segmento (barrido)', () => {
  // Ruta plana horizontal de 4 segmentos, cada uno de 3 puntos con borde
  // duplicado. Path plano de puntos globales (12 en total):
  //   Seg0: 0,1,2   Seg1: 3,4,5   Seg2: 6,7,8   Seg3: 9,10,11
  const segments = [
    seg([c(0, 0), c(0, 10), c(0, 20)], 's0'),
    seg([c(0, 20), c(0, 30), c(0, 40)], 's1'),
    seg([c(0, 40), c(0, 50), c(0, 60)], 's2'),
    seg([c(0, 60), c(0, 70), c(0, 80)], 's3'),
  ]

  it('el path plano tiene 12 puntos (con bordes)', () => {
    expect(flattenSegments(segments)).toHaveLength(12)
  })

  it.each<[number, number]>([
    [0, 4],
    [1, 4],
    [3, 3],
    [4, 3],
    [6, 2],
    [7, 2],
    [9, 1],
    [10, 1],
  ])('idx %s deja %s segmentos en remaining', (idx, cuantos) => {
    const res = splitSegmentsByProgress(segments, { idx, frac: 0.5 })
    expect(res.remaining).toHaveLength(cuantos)
  })

  it('la longitud de passed tiende a crecer con idx (con dientes de sierra por los pares interp)', () => {
    // El passed NO es estrictamente monótono: en el punto del camión se empujan
    // DOS puntos (origen + interp), y al avanzar al idx siguiente ese par se
    // "descuenta", produciendo un diente de sierra. Verificamos que la tendencia
    // general sube: el primero es chico y el último es el path completo.
    const largos: number[] = []
    for (let idx = 0; idx <= 11; idx++) {
      largos.push(splitSegmentsByProgress(segments, { idx, frac: 0.5 }).passed.length)
    }
    expect(largos[0]).toBe(2)
    expect(largos[largos.length - 1]).toBe(11)
    expect(largos[largos.length - 1]).toBeGreaterThan(largos[0])
    // Con idx muy grande, passed = TODOS los puntos del path (12 con bordes).
    const todo = splitSegmentsByProgress(segments, { idx: 99, frac: 0 })
    expect(todo.passed).toHaveLength(12)
    expect(todo.remaining).toEqual([])
  })

  it('passed + remaining reconstruyen el recorrido en el punto del camión', () => {
    // En idx 4 (segundo punto del seg1, i=1, interpola con p5), el último punto
    // de passed debe coincidir con el primer punto de remaining (el interpolado).
    const res = splitSegmentsByProgress(segments, { idx: 4, frac: 0.5 })
    const ultimoPassed = res.passed[res.passed.length - 1]
    const primerRemaining = res.remaining[0].coordinates[0]
    expect(ultimoPassed.longitude).toBeCloseTo(primerRemaining.lng, 10)
    expect(ultimoPassed.latitude).toBeCloseTo(primerRemaining.lat, 10)
    // interp entre p4=(0,30) y p5=(0,40) con frac 0.5 = (0,35).
    expect(ultimoPassed.longitude).toBeCloseTo(35, 10)
  })

  it('barrido de frac en un mismo idx interpola de forma creciente', () => {
    const longitudes = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
      const res = splitSegmentsByProgress(segments, { idx: 6, frac })
      return res.passed[res.passed.length - 1].longitude
    })
    // idx 6 = primer punto del seg2 = (0,40), siguiente (0,50).
    expect(longitudes).toEqual([40, 42.5, 45, 47.5, 50])
    // Y son estrictamente crecientes.
    for (let i = 1; i < longitudes.length; i++) {
      expect(longitudes[i]).toBeGreaterThan(longitudes[i - 1])
    }
  })

  it('conserva los status de los segmentos que sobreviven', () => {
    const res = splitSegmentsByProgress(segments, { idx: 3, frac: 0.5 })
    // seg0 pasado (globales 0,1,2) → descartado; sobreviven s1,s2,s3.
    expect(res.remaining.map((r) => r.status)).toEqual(['s1', 's2', 's3'])
  })

  it('recorre TODOS los idx sin lanzar y con remaining consistente (>=2 coords cada uno)', () => {
    for (let idx = 0; idx <= 13; idx++) {
      for (const frac of [0, 0.5, 1]) {
        const res = splitSegmentsByProgress(segments, { idx, frac })
        for (const r of res.remaining) {
          expect(r.coordinates.length).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })
})

describe('simRoute — splitSegmentsByProgress: coordenadas reales del AMBA', () => {
  // Un tramo real corto Obelisco → Congreso partido en 3 puntos.
  const segments = [
    seg([c(-34.6037, -58.3816), c(-34.6068, -58.3868), c(-34.6099, -58.3921)], 'apto'),
  ]

  it('idx 0, frac 0.5 interpola el punto medio del primer tramo', () => {
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.5 })
    // Interp entre (-34.6037,-58.3816) y (-34.6068,-58.3868).
    expect(res.passed[1].latitude).toBeCloseTo((-34.6037 + -34.6068) / 2, 10)
    expect(res.passed[1].longitude).toBeCloseTo((-58.3816 + -58.3868) / 2, 10)
  })

  it('el punto interpolado queda entre los dos extremos del tramo', () => {
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0.7 })
    const p = res.passed[1]
    // lat entre -34.6068 y -34.6037 (recordando que -34.6068 < -34.6037).
    expect(p.latitude).toBeGreaterThan(-34.6068)
    expect(p.latitude).toBeLessThan(-34.6037)
    expect(p.longitude).toBeGreaterThan(-58.3868)
    expect(p.longitude).toBeLessThan(-58.3816)
  })

  it('frac 0 devuelve exactamente el punto de origen', () => {
    const res = splitSegmentsByProgress(segments, { idx: 0, frac: 0 })
    expect(res.passed[1]).toEqual({ latitude: -34.6037, longitude: -58.3816 })
  })
})
