/**
 * Tests del motor de ruteo A* para camiones (`src/backend/algorithm/astar.ts`).
 *
 * Se construyen grafos chicos a mano. Para volver el comportamiento
 * determinista (equivalente a Dijkstra) la mayoría de los nodos comparten la
 * misma coordenada, de modo que la heurística haversine vale 0 y A* elige por
 * costo real acumulado. Un par de tests usan coordenadas reales para ejercitar
 * la heurística.
 */
import { astar, findTruckRoute, type EdgeOverlay } from '../../src/backend/algorithm/astar'

// ─── Tipos locales (los del módulo no se exportan) ──────────────────────────
interface Edge {
  to: string
  lengthM: number
  aristaId?: number
  truckAllowed?: boolean
  maxWeightKg?: number
  maxHeightM?: number
  maxWidthM?: number
  maxLengthM?: number
  trustStatus?: string
  trustScore?: number
  incidentType?: string
  incidentCount?: number
  toll?: boolean
  surface?: 'asphalt' | 'gravel' | 'dirt'
  highway?: boolean
}
interface Graph {
  nodes: Record<string, { id: string; lat: number; lon: number }>
  adjacency: Record<string, Edge[]>
}

// Camión estándar que pasa por cualquier calle sin restricción física.
const TRUCK = {
  maxWeightKg: 20000,
  maxHeightM: 4,
  maxWidthM: 2.5,
  maxLengthM: 12,
}

// Construye un grafo con todos los nodos en (0,0) → heurística = 0 (Dijkstra).
function buildGraph(
  nodeIds: string[],
  edges: Record<string, Edge[]>,
): Graph {
  const nodes: Graph['nodes'] = {}
  for (const id of nodeIds) nodes[id] = { id, lat: 0, lon: 0 }
  const adjacency: Graph['adjacency'] = {}
  for (const id of nodeIds) adjacency[id] = edges[id] ?? []
  return { nodes, adjacency }
}

describe('astar — casos triviales y validación', () => {
  it('origen === destino devuelve distancia 0 y found true', () => {
    const g = buildGraph(['A'], {})
    const res = astar(g as any, 'A', 'A', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(0)
    expect(res.prev).toEqual({})
  })

  it('lanza si el grafo es null', () => {
    expect(() => astar(null as any, 'A', 'B', TRUCK)).toThrow('El grafo es inválido.')
  })

  it('lanza si faltan nodes', () => {
    expect(() =>
      astar({ adjacency: {} } as any, 'A', 'B', TRUCK),
    ).toThrow('El grafo es inválido.')
  })

  it('lanza si falta adjacency', () => {
    expect(() =>
      astar({ nodes: {} } as any, 'A', 'B', TRUCK),
    ).toThrow('El grafo es inválido.')
  })

  it('lanza si el nodo origen no existe', () => {
    const g = buildGraph(['B'], {})
    expect(() => astar(g as any, 'A', 'B', TRUCK)).toThrow(
      'El nodo origen "A" no existe en el grafo.',
    )
  })

  it('lanza si el nodo destino no existe', () => {
    const g = buildGraph(['A'], {})
    expect(() => astar(g as any, 'A', 'Z', TRUCK)).toThrow(
      'El nodo destino "Z" no existe en el grafo.',
    )
  })
})

describe('astar — rutas en grafos lineales', () => {
  it('encuentra la ruta en un grafo A→B→C y suma las longitudes', () => {
    const g = buildGraph(['A', 'B', 'C'], {
      A: [{ to: 'B', lengthM: 100 }],
      B: [{ to: 'C', lengthM: 200 }],
    })
    const res = astar(g as any, 'A', 'C', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(300)
    expect(res.prev['C']).toBe('B')
    expect(res.prev['B']).toBe('A')
  })

  it('no encuentra ruta si el destino está desconectado', () => {
    const g = buildGraph(['A', 'B', 'C'], {
      A: [{ to: 'B', lengthM: 100 }],
      // C no tiene aristas entrantes
    })
    const res = astar(g as any, 'A', 'C', TRUCK)
    expect(res.found).toBe(false)
    expect(res.distance).toBe(Infinity)
  })

  it('encuentra una ruta directa de un solo salto', () => {
    const g = buildGraph(['A', 'B'], { A: [{ to: 'B', lengthM: 42 }] })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(42)
    expect(res.prev['B']).toBe('A')
  })

  it('respeta la dirección de las aristas (no viaja en sentido inverso)', () => {
    const g = buildGraph(['A', 'B'], { A: [{ to: 'B', lengthM: 10 }] })
    // No hay arista B→A.
    const res = astar(g as any, 'B', 'A', TRUCK)
    expect(res.found).toBe(false)
  })
})

describe('astar — elección del camino de menor costo', () => {
  it('elige el camino más corto entre dos alternativas', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100 },
        { to: 'C', lengthM: 500 },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    const res = astar(g as any, 'A', 'D', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(200) // A→B→D
    expect(res.prev['D']).toBe('B')
  })

  it('toma el camino largo si el corto queda bloqueado por restricción física', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100, maxHeightM: 3 }, // camión de 4m no pasa
        { to: 'C', lengthM: 300 },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    const res = astar(g as any, 'A', 'D', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(400) // A→C→D
    expect(res.prev['D']).toBe('C')
  })

  it('penaliza (no prohíbe) calles con truckAllowed=false', () => {
    // La única ruta pasa por una calle no habilitada: se usa igual con +10000.
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, truckAllowed: false }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100 + 10000)
  })

  it('prefiere la calle habilitada sobre la penalizada cuando ambas conectan', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'B', lengthM: 100, truckAllowed: false }, // 10100
        { to: 'B', lengthM: 500 }, // 500
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.distance).toBe(500)
  })
})

describe('astar — restricciones físicas del vehículo (isEdgeAllowed)', () => {
  it('bloquea por exceso de peso', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, maxWeightKg: 10000 }],
    })
    const res = astar(g as any, 'A', 'B', { ...TRUCK, maxWeightKg: 20000 })
    expect(res.found).toBe(false)
  })

  it('permite si el peso está justo en el límite', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, maxWeightKg: 20000 }],
    })
    const res = astar(g as any, 'A', 'B', { ...TRUCK, maxWeightKg: 20000 })
    expect(res.found).toBe(true)
  })

  it('bloquea por exceso de altura', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, maxHeightM: 3.5 }],
    })
    const res = astar(g as any, 'A', 'B', { ...TRUCK, maxHeightM: 4 })
    expect(res.found).toBe(false)
  })

  it('bloquea por exceso de ancho', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, maxWidthM: 2 }],
    })
    const res = astar(g as any, 'A', 'B', { ...TRUCK, maxWidthM: 2.5 })
    expect(res.found).toBe(false)
  })

  it('bloquea por exceso de largo', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, maxLengthM: 8 }],
    })
    const res = astar(g as any, 'A', 'B', { ...TRUCK, maxLengthM: 12 })
    expect(res.found).toBe(false)
  })

  it('no aplica restricción si la arista no la declara (undefined)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100 }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
  })

  it('un camión más chico pasa por donde uno grande no', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, maxWeightKg: 15000 }],
    })
    expect(astar(g as any, 'A', 'B', { ...TRUCK, maxWeightKg: 20000 }).found).toBe(false)
    expect(astar(g as any, 'A', 'B', { ...TRUCK, maxWeightKg: 10000 }).found).toBe(true)
  })
})

describe('astar — sistema cooperativo (overlays y trust)', () => {
  it('excluye una arista con trustStatus "bloqueada" del edge', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, trustStatus: 'bloqueada' }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(false)
  })

  it('excluye una arista bloqueada vía overlay por aristaId', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 7 }],
    })
    const overlays = new Map<number, EdgeOverlay>([[7, { trustStatus: 'bloqueada' }]])
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal', overlays)
    expect(res.found).toBe(false)
  })

  it('el overlay tiene prioridad sobre el trustStatus del edge', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 3, trustStatus: 'bloqueada' }],
    })
    // El overlay "habilita" con status desconocido → deja de estar bloqueada.
    const overlays = new Map<number, EdgeOverlay>([[3, { trustStatus: 'habilitada' }]])
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal', overlays)
    expect(res.found).toBe(true)
  })

  it('penaliza aristas con trustScore negativo (|score| * 500)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, trustScore: -2 }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.distance).toBe(100 + 2 * 500)
  })

  it('no penaliza aristas con trustScore positivo', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, trustScore: 5 }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.distance).toBe(100)
  })
})

describe('astar — incidentes según el modo', () => {
  it('en modo normal, un accidente agrega penalización leve pero deja pasar', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, incidentType: 'accidente' }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100 + 500) // penalización base accidente
  })

  it('multiplica la penalización por incidentCount en modo normal', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, incidentType: 'trafico', incidentCount: 3 }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.distance).toBe(100 + 200 * 3) // trafico=200
  })

  it('usa penalización default 200 para un tipo de incidente desconocido', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, incidentType: 'inundacion' }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.distance).toBe(100 + 200)
  })

  it('en modo alternativo, cualquier incidente excluye la arista (Infinity)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, incidentType: 'accidente' }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK, 'alternative')
    expect(res.found).toBe(false)
  })

  it('en modo alternativo elige la ruta libre de incidentes aunque sea más larga', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100, incidentType: 'corte' }, // excluida en alternative
        { to: 'C', lengthM: 300 },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    const res = astar(g as any, 'A', 'D', TRUCK, 'alternative')
    expect(res.found).toBe(true)
    expect(res.prev['D']).toBe('C')
  })

  it('el overlay de incidente pisa al del edge', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 9 }],
    })
    const overlays = new Map<number, EdgeOverlay>([
      [9, { incidentType: 'corte', incidentCount: 2 }],
    ])
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal', overlays)
    expect(res.distance).toBe(100 + 2000 * 2) // corte=2000
  })
})

describe('astar — grafos más grandes y heurística', () => {
  it('resuelve un grafo en grilla eligiendo el costo mínimo', () => {
    // A→B→D y A→C→D con costos distintos.
    const g = buildGraph(['A', 'B', 'C', 'D', 'E'], {
      A: [
        { to: 'B', lengthM: 50 },
        { to: 'C', lengthM: 50 },
      ],
      B: [{ to: 'D', lengthM: 50 }],
      C: [{ to: 'D', lengthM: 200 }],
      D: [{ to: 'E', lengthM: 10 }],
    })
    const res = astar(g as any, 'A', 'E', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(110) // A→B→D→E
    expect(res.prev['D']).toBe('B')
  })

  it('con coordenadas reales sigue encontrando la ruta óptima', () => {
    // Nodos con lat/lon reales para ejercitar la heurística haversine.
    const g: Graph = {
      nodes: {
        A: { id: 'A', lat: -34.60, lon: -58.38 },
        B: { id: 'B', lat: -34.61, lon: -58.39 },
        C: { id: 'C', lat: -34.62, lon: -58.40 },
      },
      adjacency: {
        A: [{ to: 'B', lengthM: 1500 }],
        B: [{ to: 'C', lengthM: 1500 }],
      },
    }
    const res = astar(g as any, 'A', 'C', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(3000)
  })

  it('maneja ciclos sin quedarse colgado', () => {
    const g = buildGraph(['A', 'B', 'C'], {
      A: [{ to: 'B', lengthM: 10 }],
      B: [
        { to: 'C', lengthM: 10 },
        { to: 'A', lengthM: 10 }, // ciclo
      ],
      C: [{ to: 'A', lengthM: 10 }], // ciclo
    })
    const res = astar(g as any, 'A', 'C', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(20)
  })

  it('ignora aristas hacia nodos inexistentes', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'FANTASMA', lengthM: 1 },
        { to: 'B', lengthM: 100 },
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100)
  })
})

describe('findTruckRoute — wrapper de alto nivel', () => {
  it('reconstruye el path completo origen→destino', () => {
    const g = buildGraph(['A', 'B', 'C'], {
      A: [{ to: 'B', lengthM: 100 }],
      B: [{ to: 'C', lengthM: 100 }],
    })
    const res = findTruckRoute(g as any, 'A', 'C', TRUCK)
    expect(res.found).toBe(true)
    expect(res.path).toEqual(['A', 'B', 'C'])
    expect(res.distance).toBe(200)
  })

  it('devuelve path [origen] cuando origen === destino', () => {
    const g = buildGraph(['A'], {})
    const res = findTruckRoute(g as any, 'A', 'A', TRUCK)
    expect(res.found).toBe(true)
    expect(res.path).toEqual(['A'])
    expect(res.distance).toBe(0)
  })

  it('devuelve found false y path vacío cuando no hay ruta', () => {
    const g = buildGraph(['A', 'B'], {}) // sin aristas
    const res = findTruckRoute(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(false)
    expect(res.path).toEqual([])
    expect(res.distance).toBe(Infinity)
  })

  it('el path empieza en el origen y termina en el destino', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [{ to: 'B', lengthM: 1 }],
      B: [{ to: 'C', lengthM: 1 }],
      C: [{ to: 'D', lengthM: 1 }],
    })
    const res = findTruckRoute(g as any, 'A', 'D', TRUCK)
    expect(res.path[0]).toBe('A')
    expect(res.path[res.path.length - 1]).toBe('D')
  })

  it('el path elegido es el de menor costo', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 1 },
        { to: 'C', lengthM: 100 },
      ],
      B: [{ to: 'D', lengthM: 1 }],
      C: [{ to: 'D', lengthM: 1 }],
    })
    const res = findTruckRoute(g as any, 'A', 'D', TRUCK)
    expect(res.path).toEqual(['A', 'B', 'D'])
  })

  it('propaga las restricciones físicas (sin ruta viable → found false)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, maxHeightM: 2 }],
    })
    const res = findTruckRoute(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(false)
  })

  it('en modo alternativo evita incidentes', () => {
    // Camino corto (por B): 10 + trafico(200) + 10 = 220.
    // Camino largo (por C): 500 + 10 = 510.
    // Normal prefiere B (220 < 510). Alternativo excluye B → usa C.
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 10, incidentType: 'trafico' },
        { to: 'C', lengthM: 500 },
      ],
      B: [{ to: 'D', lengthM: 10 }],
      C: [{ to: 'D', lengthM: 10 }],
    })
    const normal = findTruckRoute(g as any, 'A', 'D', TRUCK, 'normal')
    const alt = findTruckRoute(g as any, 'A', 'D', TRUCK, 'alternative')
    expect(normal.path).toEqual(['A', 'B', 'D']) // corto pese al incidente
    expect(alt.path).toEqual(['A', 'C', 'D']) // evita el incidente
  })
})
