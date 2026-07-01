/**
 * Tests AVANZADOS y exhaustivos del motor de ruteo A* para camiones
 * (`src/backend/algorithm/astar.ts`).
 *
 * Estos tests son complementarios a `astar.test.ts` y cubren escenarios más
 * complejos: grillas grandes, combinaciones de restricciones físicas, la
 * interacción (suma) entre penalizaciones de trust e incidentes en la misma
 * arista, desempates, caminos con muchos saltos, aristas paralelas, self-loops,
 * overlays que habilitan/bloquean/penalizan, y contraste entre el modo normal y
 * el modo alternativo en grafos con varias rutas.
 *
 * Para volver el comportamiento determinista (equivalente a Dijkstra) todos los
 * nodos comparten la coordenada (0,0): la heurística haversine vale 0 y A* elige
 * puramente por costo real acumulado. Algunos tests usan coordenadas reales para
 * ejercitar la heurística admisible.
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

// Camión chico (útil para tests que exigen pasar por restricciones ajustadas).
const SMALL_TRUCK = {
  maxWeightKg: 5000,
  maxHeightM: 2.5,
  maxWidthM: 2,
  maxLengthM: 6,
}

// Construye un grafo con todos los nodos en (0,0) → heurística = 0 (Dijkstra).
function buildGraph(nodeIds: string[], edges: Record<string, Edge[]>): Graph {
  const nodes: Graph['nodes'] = {}
  for (const id of nodeIds) nodes[id] = { id, lat: 0, lon: 0 }
  const adjacency: Graph['adjacency'] = {}
  for (const id of nodeIds) adjacency[id] = edges[id] ?? []
  return { nodes, adjacency }
}

// ─── Grillas grandes ─────────────────────────────────────────────────────────
describe('astar — grillas 3x3 y elección de rutas', () => {
  // Grilla 3x3 con nodos R{fila}{col}. Sólo movimientos derecha/abajo, cada
  // arista de largo 1. Todas las rutas monótonas de esquina a esquina tienen el
  // mismo costo (4). El desempate por g elige la primera actualización.
  function grid3x3(): Graph {
    const ids: string[] = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) ids.push(`R${r}${c}`)
    const edges: Record<string, Edge[]> = {}
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const here = `R${r}${c}`
        edges[here] = []
        if (c < 2) edges[here].push({ to: `R${r}${c + 1}`, lengthM: 1 })
        if (r < 2) edges[here].push({ to: `R${r + 1}${c}`, lengthM: 1 })
      }
    }
    return buildGraph(ids, edges)
  }

  it('cruza la grilla de esquina a esquina con costo mínimo 4', () => {
    const g = grid3x3()
    const res = astar(g as any, 'R00', 'R22', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(4)
  })

  it('el path completo de la grilla tiene 5 nodos (4 saltos)', () => {
    const g = grid3x3()
    const res = findTruckRoute(g as any, 'R00', 'R22', TRUCK)
    expect(res.found).toBe(true)
    expect(res.path.length).toBe(5)
    expect(res.path[0]).toBe('R00')
    expect(res.path[res.path.length - 1]).toBe('R22')
    expect(res.distance).toBe(4)
  })

  it('rutea a un nodo intermedio de la grilla (centro)', () => {
    const g = grid3x3()
    const res = astar(g as any, 'R00', 'R11', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(2)
  })

  it('bloquear el centro obliga a rodear pero mantiene costo 4', () => {
    // Encarezco fuertemente todas las aristas que entran a R11: la ruta óptima
    // pasa por los bordes (R01→R02→R12→R22 o R10→R20→R21→R22), costo 4.
    const g = grid3x3()
    for (const from of ['R01', 'R10']) {
      for (const e of g.adjacency[from]) {
        if (e.to === 'R11') e.lengthM = 1000
      }
    }
    const res = astar(g as any, 'R00', 'R22', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(4)
    // El camino no debe pasar por R11.
    const path = findTruckRoute(g as any, 'R00', 'R22', TRUCK).path
    expect(path).not.toContain('R11')
  })

  it('si toda la fila y columna del centro está bloqueada físicamente, rodea igual', () => {
    // Restrinjo por altura las aristas que llegan a R11: el camión no pasa por
    // el centro pero sí por los bordes.
    const g = grid3x3()
    for (const from of ['R01', 'R10']) {
      for (const e of g.adjacency[from]) {
        if (e.to === 'R11') e.maxHeightM = 2 // camión de 4m no pasa
      }
    }
    const res = findTruckRoute(g as any, 'R00', 'R22', TRUCK)
    expect(res.found).toBe(true)
    expect(res.path).not.toContain('R11')
    expect(res.distance).toBe(4)
  })

  it('bloquear ambos vecinos de salida del origen deja sin ruta', () => {
    const g = grid3x3()
    // R00 sólo puede ir a R01 y R10; bloqueo físicamente ambas.
    for (const e of g.adjacency['R00']) e.maxWeightKg = 1000
    const res = astar(g as any, 'R00', 'R22', TRUCK)
    expect(res.found).toBe(false)
    expect(res.distance).toBe(Infinity)
  })
})

// ─── Restricciones físicas combinadas ─────────────────────────────────────────
describe('astar — múltiples restricciones físicas en una misma arista', () => {
  it('pasa cuando todas las restricciones combinadas se cumplen justo en el límite', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        {
          to: 'B',
          lengthM: 100,
          maxWeightKg: 20000,
          maxHeightM: 4,
          maxWidthM: 2.5,
          maxLengthM: 12,
        },
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100)
  })

  it('bloquea si UNA sola de varias restricciones se viola (peso ok, altura no)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        {
          to: 'B',
          lengthM: 100,
          maxWeightKg: 20000, // ok
          maxHeightM: 3.9, // camión de 4m NO pasa
          maxWidthM: 2.5, // ok
          maxLengthM: 12, // ok
        },
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(false)
  })

  it('bloquea si se viola sólo el ancho aunque el resto pase', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        {
          to: 'B',
          lengthM: 100,
          maxWeightKg: 20000,
          maxHeightM: 4,
          maxWidthM: 2.4, // camión de 2.5m NO pasa
          maxLengthM: 12,
        },
      ],
    })
    expect(astar(g as any, 'A', 'B', TRUCK).found).toBe(false)
  })

  it('bloquea si se viola sólo el largo aunque el resto pase', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        {
          to: 'B',
          lengthM: 100,
          maxWeightKg: 20000,
          maxHeightM: 4,
          maxWidthM: 2.5,
          maxLengthM: 11.9, // camión de 12m NO pasa
        },
      ],
    })
    expect(astar(g as any, 'A', 'B', TRUCK).found).toBe(false)
  })

  it('un camión chico pasa por la misma arista donde el grande falla por varias dimensiones', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        {
          to: 'B',
          lengthM: 100,
          maxWeightKg: 8000,
          maxHeightM: 3,
          maxWidthM: 2.2,
          maxLengthM: 7,
        },
      ],
    })
    expect(astar(g as any, 'A', 'B', TRUCK).found).toBe(false)
    expect(astar(g as any, 'A', 'B', SMALL_TRUCK).found).toBe(true)
    expect(astar(g as any, 'A', 'B', SMALL_TRUCK).distance).toBe(100)
  })

  it('elige entre dos rutas la única que satisface todas las restricciones físicas', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 50, maxHeightM: 3 }, // corto pero bloqueado (altura)
        { to: 'C', lengthM: 400 }, // largo pero libre
      ],
      B: [{ to: 'D', lengthM: 50 }],
      C: [{ to: 'D', lengthM: 50 }],
    })
    const res = astar(g as any, 'A', 'D', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(450) // A→C→D
    expect(res.prev['D']).toBe('C')
  })

  it('restricciones que NO se declaran (undefined) nunca bloquean', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100 }], // sin ninguna maxXxx
    })
    // Camión gigante: igual pasa porque la arista no declara límites.
    const giant = { maxWeightKg: 999999, maxHeightM: 99, maxWidthM: 99, maxLengthM: 99 }
    expect(astar(g as any, 'A', 'B', giant).found).toBe(true)
  })
})

// ─── Interacción trust + incidentes (se suman) ────────────────────────────────
describe('astar — suma de penalizaciones trust + incidente en la misma arista', () => {
  it('suma trustScore negativo e incidente en modo normal', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, trustScore: -3, incidentType: 'trafico' }],
    })
    // 100 + |−3|*500 + trafico(200)*1 = 100 + 1500 + 200 = 1800
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.found).toBe(true)
    expect(res.distance).toBe(1800)
  })

  it('suma truckAllowed=false + trustScore negativo + incidente con count', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        {
          to: 'B',
          lengthM: 100,
          truckAllowed: false, // +10000
          trustScore: -2, // +1000
          incidentType: 'obra', // 300 * count
          incidentCount: 2, // *2 → +600
        },
      ],
    })
    // 100 + 10000 + 1000 + 600 = 11700
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.distance).toBe(11700)
  })

  it('trustStatus bloqueada gana sobre cualquier penalización sumable (Infinity)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        {
          to: 'B',
          lengthM: 100,
          trustStatus: 'bloqueada',
          trustScore: -5,
          incidentType: 'accidente',
        },
      ],
    })
    // Bloqueada retorna Infinity antes de sumar → sin ruta.
    expect(astar(g as any, 'A', 'B', TRUCK, 'normal').found).toBe(false)
  })

  it('en modo alternativo el incidente vuelve Infinity aunque haya trust penalizado', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, trustScore: -1, incidentType: 'obra' }],
    })
    expect(astar(g as any, 'A', 'B', TRUCK, 'alternative').found).toBe(false)
  })

  it('trustScore negativo SÍ penaliza en modo alternativo si no hay incidente', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, trustScore: -4 }],
    })
    // Sin incidente, alternative se comporta igual: 100 + 4*500 = 2100.
    const res = astar(g as any, 'A', 'B', TRUCK, 'alternative')
    expect(res.found).toBe(true)
    expect(res.distance).toBe(2100)
  })

  it('elige la ruta con menor suma total de penalizaciones', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        // Ruta B: 100 + accidente(500) = 600, luego 100 → 700
        { to: 'B', lengthM: 100, incidentType: 'accidente' },
        // Ruta C: 100 + trustScore −1 (500) = 600, luego 100 → 700 (empate en A)
        { to: 'C', lengthM: 100, trustScore: -1 },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 50 }], // esta hace que C sea mejor (650 vs 700)
    })
    // Ruta B: 100 + accidente(500) + 100 = 700.
    // Ruta C: 100 + trust −1(500) + 50 = 650 → gana C.
    const res = astar(g as any, 'A', 'D', TRUCK, 'normal')
    expect(res.found).toBe(true)
    expect(res.distance).toBe(650)
    expect(res.prev['D']).toBe('C')
  })
})

// ─── Costo mínimo 1 (Math.max) ────────────────────────────────────────────────
describe('astar — costo mínimo de arista es 1', () => {
  it('una arista de longitud 0 cuesta al menos 1', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 0 }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(1)
  })

  it('varias aristas de longitud 0 suman 1 por cada salto', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [{ to: 'B', lengthM: 0 }],
      B: [{ to: 'C', lengthM: 0 }],
      C: [{ to: 'D', lengthM: 0 }],
    })
    const res = astar(g as any, 'A', 'D', TRUCK)
    expect(res.distance).toBe(3) // 1 + 1 + 1
  })

  it('longitud negativa también queda topeada a 1', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: -50 }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.distance).toBe(1)
  })
})

// ─── Aristas paralelas y self-loops ───────────────────────────────────────────
describe('astar — aristas paralelas, self-loops y casos degenerados', () => {
  it('elige la más barata entre dos aristas paralelas al mismo destino', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'B', lengthM: 900 },
        { to: 'B', lengthM: 300 }, // esta gana
        { to: 'B', lengthM: 600 },
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(300)
  })

  it('entre paralelas, una barata pero bloqueada y otra cara habilitada → usa la habilitada', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'B', lengthM: 100, trustStatus: 'bloqueada' }, // Infinity
        { to: 'B', lengthM: 800 }, // válida
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.distance).toBe(800)
  })

  it('entre paralelas, prefiere la penalizada barata si la limpia es aún más cara', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'B', lengthM: 100, incidentType: 'control_policial' }, // 100 + 100 = 200
        { to: 'B', lengthM: 500 }, // 500
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.distance).toBe(200)
  })

  it('ignora un self-loop y no altera la distancia', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'A', lengthM: 5 }, // self-loop
        { to: 'B', lengthM: 100 },
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100)
  })

  it('un self-loop en el destino no impide encontrarlo', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 50 }],
      B: [{ to: 'B', lengthM: 1 }], // self-loop en destino
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.distance).toBe(50)
  })

  it('aristas a nodos fantasma se ignoran incluso si son las más baratas', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'FANTASMA1', lengthM: 1 },
        { to: 'FANTASMA2', lengthM: 2 },
        { to: 'B', lengthM: 100 },
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100)
  })

  it('si TODAS las aristas van a fantasmas, no hay ruta', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'X', lengthM: 1 },
        { to: 'Y', lengthM: 2 },
      ],
    })
    expect(astar(g as any, 'A', 'B', TRUCK).found).toBe(false)
  })

  it('nodo sin aristas salientes (array vacío) no rompe', () => {
    const g = buildGraph(['A', 'B'], { A: [] })
    expect(astar(g as any, 'A', 'B', TRUCK).found).toBe(false)
  })
})

// ─── Desempates entre caminos de igual costo ──────────────────────────────────
describe('astar — desempates entre caminos de igual costo', () => {
  it('con dos rutas de idéntico costo devuelve found true y el costo correcto', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100 },
        { to: 'C', lengthM: 100 },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    const res = astar(g as any, 'A', 'D', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(200)
    // El predecesor de D es B o C (ambos válidos); ambos con costo 200.
    expect(['B', 'C']).toContain(res.prev['D'])
  })

  it('el desempate elige la primera arista que relaja el vecino (orden de adyacencia)', () => {
    // B se procesa antes que C (misma f y g). D se actualiza primero desde B.
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100 },
        { to: 'C', lengthM: 100 },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    const res = astar(g as any, 'A', 'D', TRUCK)
    // B se relaja primero → gScore[D] queda por B; C no mejora (empate no relaja).
    expect(res.prev['D']).toBe('B')
  })

  it('rutas de distinta cantidad de saltos pero igual costo total', () => {
    // A→D directo de 300, o A→B→C→D de 100+100+100=300.
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100 },
        { to: 'D', lengthM: 300 },
      ],
      B: [{ to: 'C', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    const res = astar(g as any, 'A', 'D', TRUCK)
    expect(res.distance).toBe(300)
  })
})

// ─── Caminos largos con muchos saltos ─────────────────────────────────────────
describe('astar — cadenas largas', () => {
  it('resuelve una cadena lineal de 20 nodos sumando todas las longitudes', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `N${i}`)
    const edges: Record<string, Edge[]> = {}
    for (let i = 0; i < 19; i++) edges[`N${i}`] = [{ to: `N${i + 1}`, lengthM: 10 }]
    const g = buildGraph(ids, edges)
    const res = astar(g as any, 'N0', 'N19', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(19 * 10) // 190
  })

  it('reconstruye el path completo de una cadena de 20 nodos', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `N${i}`)
    const edges: Record<string, Edge[]> = {}
    for (let i = 0; i < 19; i++) edges[`N${i}`] = [{ to: `N${i + 1}`, lengthM: 10 }]
    const g = buildGraph(ids, edges)
    const res = findTruckRoute(g as any, 'N0', 'N19', TRUCK)
    expect(res.found).toBe(true)
    expect(res.path).toEqual(ids)
    expect(res.path.length).toBe(20)
  })

  it('en una cadena larga con un atajo, elige el atajo', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `N${i}`)
    const edges: Record<string, Edge[]> = {}
    for (let i = 0; i < 9; i++) edges[`N${i}`] = [{ to: `N${i + 1}`, lengthM: 10 }]
    // Atajo directo N0→N9 mucho más barato.
    edges['N0'].push({ to: 'N9', lengthM: 5 })
    const g = buildGraph(ids, edges)
    const res = findTruckRoute(g as any, 'N0', 'N9', TRUCK)
    expect(res.distance).toBe(5)
    expect(res.path).toEqual(['N0', 'N9'])
  })

  it('en una cadena larga con un tramo bloqueado no hay ruta', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `N${i}`)
    const edges: Record<string, Edge[]> = {}
    for (let i = 0; i < 9; i++) edges[`N${i}`] = [{ to: `N${i + 1}`, lengthM: 10 }]
    // Bloqueo el tramo N5→N6 con trustStatus bloqueada, sin alternativas.
    edges['N5'][0].trustStatus = 'bloqueada'
    const g = buildGraph(ids, edges)
    const res = astar(g as any, 'N0', 'N9', TRUCK)
    expect(res.found).toBe(false)
  })
})

// ─── Overlays: habilitar, bloquear, penalizar ─────────────────────────────────
describe('astar — overlays por aristaId', () => {
  it('overlay sin la aristaId correspondiente no afecta el costo', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 1 }],
    })
    // El overlay apunta a la arista 999, que no existe → no aplica.
    const overlays = new Map<number, EdgeOverlay>([[999, { trustStatus: 'bloqueada' }]])
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal', overlays)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100)
  })

  it('overlay sobre una arista SIN aristaId no aplica (no hay match)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100 }], // sin aristaId
    })
    const overlays = new Map<number, EdgeOverlay>([[1, { trustStatus: 'bloqueada' }]])
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal', overlays)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100)
  })

  it('overlay penaliza con trustScore negativo por aristaId', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 5 }],
    })
    const overlays = new Map<number, EdgeOverlay>([[5, { trustScore: -6 }]])
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal', overlays)
    expect(res.distance).toBe(100 + 6 * 500) // 3100
  })

  it('overlay agrega un incidente con count por aristaId (modo normal)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 5 }],
    })
    const overlays = new Map<number, EdgeOverlay>([
      [5, { incidentType: 'accidente', incidentCount: 4 }],
    ])
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal', overlays)
    expect(res.distance).toBe(100 + 500 * 4) // 2100
  })

  it('overlay con incidente en modo alternativo excluye la arista', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 5 }],
    })
    const overlays = new Map<number, EdgeOverlay>([[5, { incidentType: 'corte' }]])
    const res = astar(g as any, 'A', 'B', TRUCK, 'alternative', overlays)
    expect(res.found).toBe(false)
  })

  it('múltiples overlays afectan aristas distintas por su aristaId', () => {
    const g = buildGraph(['A', 'B', 'C'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 10 }],
      B: [{ to: 'C', lengthM: 100, aristaId: 20 }],
    })
    const overlays = new Map<number, EdgeOverlay>([
      [10, { trustScore: -1 }], // +500
      [20, { incidentType: 'trafico', incidentCount: 2 }], // +400
    ])
    const res = astar(g as any, 'A', 'C', TRUCK, 'normal', overlays)
    // 100 + 500 + 100 + 400 = 1100
    expect(res.distance).toBe(1100)
  })

  it('overlay que desbloquea permite usar una arista que el edge marca bloqueada', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 7, trustStatus: 'bloqueada' }],
    })
    // El overlay pisa el status con 'habilitada'.
    const overlays = new Map<number, EdgeOverlay>([[7, { trustStatus: 'habilitada' }]])
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal', overlays)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100)
  })

  it('overlay redirige la ruta óptima: bloquea el atajo y fuerza el desvío', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 50, aristaId: 100 }, // atajo, será bloqueado por overlay
        { to: 'C', lengthM: 300 },
      ],
      B: [{ to: 'D', lengthM: 50 }],
      C: [{ to: 'D', lengthM: 50 }],
    })
    const overlays = new Map<number, EdgeOverlay>([[100, { trustStatus: 'bloqueada' }]])
    const res = findTruckRoute(g as any, 'A', 'D', TRUCK, 'normal', overlays)
    expect(res.found).toBe(true)
    expect(res.path).toEqual(['A', 'C', 'D'])
    expect(res.distance).toBe(350)
  })

  it('sin overlays (undefined) el edge conserva su comportamiento', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 3, trustScore: -1 }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal', undefined)
    expect(res.distance).toBe(100 + 500)
  })
})

// ─── Modo normal vs alternativo en grafos con varias rutas ───────────────────
describe('astar — normal vs alternativo en grafos multi-ruta', () => {
  // Grafo con 3 rutas paralelas A→...→D:
  //  - Ruta 1 (por B): corta pero con incidente (corte)
  //  - Ruta 2 (por C): media, limpia
  //  - Ruta 3 (por E): larga, limpia
  function multiRoute(): Graph {
    return buildGraph(['A', 'B', 'C', 'E', 'D'], {
      A: [
        { to: 'B', lengthM: 100, incidentType: 'corte' }, // penalizada/excluida
        { to: 'C', lengthM: 400 },
        { to: 'E', lengthM: 900 },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
      E: [{ to: 'D', lengthM: 100 }],
    })
  }

  it('modo normal usa la ruta corta con incidente si sigue siendo la más barata', () => {
    const g = multiRoute()
    // Ruta B: 100 + corte(2000) + 100 = 2200. Ruta C: 400 + 100 = 500 → gana C.
    const res = findTruckRoute(g as any, 'A', 'D', TRUCK, 'normal')
    expect(res.path).toEqual(['A', 'C', 'D']) // corte es caro (2000), C conviene
    expect(res.distance).toBe(500)
  })

  it('modo normal SÍ usa la ruta con incidente cuando la penalización es leve', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100, incidentType: 'control_policial' }, // +100
        { to: 'C', lengthM: 400 },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    // Ruta B: 100 + 100 + 100 = 300. Ruta C: 400 + 100 = 500 → gana B.
    const res = findTruckRoute(g as any, 'A', 'D', TRUCK, 'normal')
    expect(res.path).toEqual(['A', 'B', 'D'])
    expect(res.distance).toBe(300)
  })

  it('modo alternativo excluye la ruta con incidente y toma la limpia más barata', () => {
    const g = multiRoute()
    // B queda excluida; entre C (500) y E (1000), gana C.
    const res = findTruckRoute(g as any, 'A', 'D', TRUCK, 'alternative')
    expect(res.path).toEqual(['A', 'C', 'D'])
    expect(res.distance).toBe(500)
  })

  it('modo alternativo sin ninguna ruta limpia devuelve found false', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100, incidentType: 'obra' },
        { to: 'C', lengthM: 100, incidentType: 'trafico' },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    // Toda ruta pasa por un incidente → alternative no encuentra ruta.
    const res = astar(g as any, 'A', 'D', TRUCK, 'alternative')
    expect(res.found).toBe(false)
  })

  it('normal y alternativo coinciden cuando no hay incidentes en el grafo', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100 },
        { to: 'C', lengthM: 250 },
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    const normal = findTruckRoute(g as any, 'A', 'D', TRUCK, 'normal')
    const alt = findTruckRoute(g as any, 'A', 'D', TRUCK, 'alternative')
    expect(normal.path).toEqual(alt.path)
    expect(normal.distance).toBe(alt.distance)
    expect(normal.distance).toBe(200)
  })

  it('el modo alternativo mueve la ruta a un desvío más largo pero sin incidente', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 10, incidentType: 'accidente' }, // corto con incidente
        { to: 'C', lengthM: 800 }, // largo limpio
      ],
      B: [{ to: 'D', lengthM: 10 }],
      C: [{ to: 'D', lengthM: 10 }],
    })
    const normal = findTruckRoute(g as any, 'A', 'D', TRUCK, 'normal')
    const alt = findTruckRoute(g as any, 'A', 'D', TRUCK, 'alternative')
    // Normal: 10 + 500 + 10 = 520 (B) vs 810 (C) → B.
    expect(normal.path).toEqual(['A', 'B', 'D'])
    // Alternativo: B excluida → C.
    expect(alt.path).toEqual(['A', 'C', 'D'])
    expect(alt.distance).toBe(810)
  })
})

// ─── Todos los tipos de incidente y su penalización base ──────────────────────
describe('astar — tabla de penalizaciones base por tipo de incidente', () => {
  const casos: Array<[string, number]> = [
    ['accidente', 500],
    ['corte', 2000],
    ['trafico', 200],
    ['obra', 300],
    ['control_policial', 100],
    ['objeto_en_via', 200],
  ]

  it.each(casos)('incidente "%s" agrega %d al costo (count=1)', (tipo, penalty) => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, incidentType: tipo }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.distance).toBe(100 + penalty)
  })

  it.each(casos)('incidente "%s" en modo alternativo excluye la arista', (tipo) => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, incidentType: tipo }],
    })
    expect(astar(g as any, 'A', 'B', TRUCK, 'alternative').found).toBe(false)
  })

  it('un tipo desconocido usa el default 200 y lo multiplica por count', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, incidentType: 'tornado', incidentCount: 3 }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.distance).toBe(100 + 200 * 3) // 700
  })

  it('incidentCount ausente equivale a 1', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, incidentType: 'corte' }],
    })
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.distance).toBe(100 + 2000) // *1
  })

  it('incidentCount 0 anula la penalización del incidente (0 * penalty)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, incidentType: 'corte', incidentCount: 0 }],
    })
    // incidentCount ?? 1 → 0 (no es null/undefined) → 2000*0 = 0.
    const res = astar(g as any, 'A', 'B', TRUCK, 'normal')
    expect(res.distance).toBe(100)
  })
})

// ─── trustScore: distintos valores ────────────────────────────────────────────
describe('astar — penalización por trustScore negativo', () => {
  it('trustScore 0 no penaliza (no es < 0)', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, trustScore: 0 }],
    })
    expect(astar(g as any, 'A', 'B', TRUCK).distance).toBe(100)
  })

  it('trustScore fraccionario negativo penaliza proporcionalmente', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, trustScore: -0.5 }],
    })
    expect(astar(g as any, 'A', 'B', TRUCK).distance).toBe(100 + 0.5 * 500) // 350
  })

  it('trustScore muy negativo hace la arista tan cara que se prefiere otra', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'B', lengthM: 100, trustScore: -100 }, // 100 + 50000
        { to: 'B', lengthM: 5000 }, // más barata que la anterior
      ],
    })
    expect(astar(g as any, 'A', 'B', TRUCK).distance).toBe(5000)
  })
})

// ─── findTruckRoute: casos avanzados de reconstrucción ────────────────────────
describe('findTruckRoute — reconstrucción avanzada', () => {
  it('el path refleja la ruta de menor costo tras penalizaciones cooperativas', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 100, trustScore: -5 }, // 100 + 2500 = 2600
        { to: 'C', lengthM: 300 }, // 300
      ],
      B: [{ to: 'D', lengthM: 100 }],
      C: [{ to: 'D', lengthM: 100 }],
    })
    const res = findTruckRoute(g as any, 'A', 'D', TRUCK, 'normal')
    expect(res.path).toEqual(['A', 'C', 'D']) // evita la arista con trust malo
    expect(res.distance).toBe(400)
  })

  it('devuelve found false y distance Infinity si todas las salidas del origen están bloqueadas', () => {
    const g = buildGraph(['A', 'B', 'C'], {
      A: [
        { to: 'B', lengthM: 100, trustStatus: 'bloqueada' },
        { to: 'C', lengthM: 100, trustStatus: 'bloqueada' },
      ],
    })
    const res = findTruckRoute(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(false)
    expect(res.path).toEqual([])
    expect(res.distance).toBe(Infinity)
  })

  it('reconstruye correctamente una ruta que atraviesa un cuello de botella único', () => {
    // Muchas entradas, un único paso obligado (X), muchas salidas.
    const g = buildGraph(['A1', 'A2', 'X', 'B1', 'B2', 'D'], {
      A1: [{ to: 'X', lengthM: 50 }],
      A2: [{ to: 'X', lengthM: 10 }],
      X: [
        { to: 'B1', lengthM: 30 },
        { to: 'B2', lengthM: 5 },
      ],
      B1: [{ to: 'D', lengthM: 10 }],
      B2: [{ to: 'D', lengthM: 10 }],
    })
    const res = findTruckRoute(g as any, 'A1', 'D', TRUCK)
    expect(res.found).toBe(true)
    // A1→X (50) → B2 (5) → D (10) = 65
    expect(res.path).toEqual(['A1', 'X', 'B2', 'D'])
    expect(res.distance).toBe(65)
  })

  it('propaga el modo alternativo a través del wrapper y reconstruye el desvío', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 10, incidentType: 'objeto_en_via' },
        { to: 'C', lengthM: 200 },
      ],
      B: [{ to: 'D', lengthM: 10 }],
      C: [{ to: 'D', lengthM: 10 }],
    })
    const res = findTruckRoute(g as any, 'A', 'D', TRUCK, 'alternative')
    expect(res.path).toEqual(['A', 'C', 'D'])
    expect(res.distance).toBe(210)
  })

  it('propaga overlays a través del wrapper', () => {
    const g = buildGraph(['A', 'B'], {
      A: [{ to: 'B', lengthM: 100, aristaId: 42 }],
    })
    const overlays = new Map<number, EdgeOverlay>([[42, { trustScore: -2 }]])
    const res = findTruckRoute(g as any, 'A', 'B', TRUCK, 'normal', overlays)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(100 + 2 * 500) // 1100
    expect(res.path).toEqual(['A', 'B'])
  })
})

// ─── Heurística admisible con coordenadas reales ─────────────────────────────
describe('astar — heurística con coordenadas geográficas reales', () => {
  it('encuentra la ruta óptima con nodos separados geográficamente', () => {
    const g: Graph = {
      nodes: {
        A: { id: 'A', lat: -34.6, lon: -58.38 },
        B: { id: 'B', lat: -34.61, lon: -58.39 },
        C: { id: 'C', lat: -34.62, lon: -58.4 },
        D: { id: 'D', lat: -34.63, lon: -58.41 },
      },
      adjacency: {
        A: [
          { to: 'B', lengthM: 1500 },
          { to: 'C', lengthM: 5000 },
        ],
        B: [{ to: 'C', lengthM: 1500 }],
        C: [{ to: 'D', lengthM: 1500 }],
      },
    }
    const res = astar(g as any, 'A', 'D', TRUCK)
    expect(res.found).toBe(true)
    // A→B→C→D = 1500*3 = 4500 (más barato que A→C directo 5000+1500).
    expect(res.distance).toBe(4500)
    expect(res.prev['C']).toBe('B')
  })

  it('con heurística activa el resultado coincide con la ruta de menor costo real', () => {
    const g: Graph = {
      nodes: {
        A: { id: 'A', lat: -34.6, lon: -58.38 },
        B: { id: 'B', lat: -34.605, lon: -58.385 },
        C: { id: 'C', lat: -34.62, lon: -58.4 },
      },
      adjacency: {
        A: [
          { to: 'B', lengthM: 800 },
          { to: 'C', lengthM: 3000 },
        ],
        B: [{ to: 'C', lengthM: 800 }],
      },
    }
    const res = findTruckRoute(g as any, 'A', 'C', TRUCK)
    expect(res.found).toBe(true)
    // A→B→C = 1600 < A→C directo 3000.
    expect(res.path).toEqual(['A', 'B', 'C'])
    expect(res.distance).toBe(1600)
  })

  it('la heurística no afecta la corrección: destino alcanzable siempre se encuentra', () => {
    const g: Graph = {
      nodes: {
        A: { id: 'A', lat: 0, lon: 0 },
        B: { id: 'B', lat: 10, lon: 10 }, // lejos, pero conectado
      },
      adjacency: {
        A: [{ to: 'B', lengthM: 1 }],
      },
    }
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.found).toBe(true)
    expect(res.distance).toBe(1)
  })
})

// ─── Interacción entre restricciones físicas y penalizaciones ─────────────────
describe('astar — física + penalizaciones combinadas', () => {
  it('una arista físicamente bloqueada nunca se penaliza: simplemente se descarta', () => {
    // Aunque tenga incidentType, si el peso excede el máximo la arista ni se
    // evalúa en el costo → se ignora antes.
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'B', lengthM: 100, maxWeightKg: 1000, incidentType: 'accidente' },
        { to: 'B', lengthM: 700 }, // única viable
      ],
    })
    const res = astar(g as any, 'A', 'B', TRUCK)
    expect(res.distance).toBe(700)
  })

  it('elige la ruta penalizada por trust sobre una físicamente imposible', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [
        { to: 'B', lengthM: 50, maxHeightM: 2 }, // bloqueada físicamente
        { to: 'C', lengthM: 50, trustScore: -1 }, // penalizada pero viable
      ],
      B: [{ to: 'D', lengthM: 50 }],
      C: [{ to: 'D', lengthM: 50 }],
    })
    const res = findTruckRoute(g as any, 'A', 'D', TRUCK, 'normal')
    expect(res.path).toEqual(['A', 'C', 'D'])
    // 50 + 500 (trust) + 50 = 600
    expect(res.distance).toBe(600)
  })

  it('truckAllowed=false NO bloquea, pero pesa +10000 frente a un desvío limpio más largo', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'B', lengthM: 100, truckAllowed: false }, // 10100
        { to: 'B', lengthM: 9000 }, // más barata que 10100
      ],
    })
    expect(astar(g as any, 'A', 'B', TRUCK).distance).toBe(9000)
  })

  it('truckAllowed=false se usa igual si el desvío limpio es aún más caro', () => {
    const g = buildGraph(['A', 'B'], {
      A: [
        { to: 'B', lengthM: 100, truckAllowed: false }, // 10100
        { to: 'B', lengthM: 15000 }, // más caro
      ],
    })
    expect(astar(g as any, 'A', 'B', TRUCK).distance).toBe(10100)
  })
})

// ─── Consistencia estructural del resultado ───────────────────────────────────
describe('astar — estructura del resultado', () => {
  it('prev sólo contiene entradas para nodos alcanzados', () => {
    const g = buildGraph(['A', 'B', 'C', 'D'], {
      A: [{ to: 'B', lengthM: 10 }],
      B: [{ to: 'C', lengthM: 10 }],
      // D queda desconectado
    })
    const res = astar(g as any, 'A', 'C', TRUCK)
    expect(res.found).toBe(true)
    expect(res.prev['B']).toBe('A')
    expect(res.prev['C']).toBe('B')
    // D nunca fue tocado → no está en prev.
    expect(res.prev['D']).toBeUndefined()
  })

  it('en caso origen===destino prev es un objeto vacío y distance 0', () => {
    const g = buildGraph(['A', 'B'], { A: [{ to: 'B', lengthM: 10 }] })
    const res = astar(g as any, 'A', 'A', TRUCK)
    expect(res.prev).toEqual({})
    expect(res.distance).toBe(0)
    expect(res.found).toBe(true)
  })

  it('cuando no hay ruta, prev puede tener nodos parciales pero found es false', () => {
    const g = buildGraph(['A', 'B', 'C'], {
      A: [{ to: 'B', lengthM: 10 }],
      // B no llega a C
    })
    const res = astar(g as any, 'A', 'C', TRUCK)
    expect(res.found).toBe(false)
    expect(res.distance).toBe(Infinity)
    // Aun así se exploró B desde A.
    expect(res.prev['B']).toBe('A')
  })
})
