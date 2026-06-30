import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

/**
 * Test de INTEGRACIÓN del ruteo + pintado (no es un test puro: pega contra la
 * base real de ruteo en Aiven y contra la API /api/routes de producción).
 *
 * Por eso está GUARDADO: sólo corre si se le pasan las dos variables de entorno;
 * sin ellas se saltea, así `npm test` normal sigue determinista y sin red.
 *
 *   AIVEN_DATABASE_URL='postgres://...safetruck2...'  \
 *   API_URL='https://safetruck20-production.up.railway.app' \
 *   npx vitest run tests/backend/routing.coloring.test.ts
 *
 * Verifica los dos requisitos del pintado/ruteo:
 *   REQ 1 — las rutas se deberían calcular teniendo en cuenta las características
 *           del camión (la traza debería cambiar entre un camión chico y uno grande).
 *   REQ 2 — cada tramo se debería pintar VERDE cuando el camión está habilitado,
 *           tomando NULL como "sin restricción" (= habilitado por ese atributo).
 */

const DB_URL  = process.env.AIVEN_DATABASE_URL
const API_URL = process.env.API_URL
const RUN = Boolean(DB_URL && API_URL)

// ── Casos de prueba (editables para correr más combinaciones) ────────────────
type Trip = { name: string; o: [number, number]; d: [number, number] }
type Truck = { name: string; weight: number; height: number; width: number; length: number }

const TRIPS: Trip[] = [
  { name: 'CABA · Obelisco → Caballito',          o: [-34.6037, -58.3816], d: [-34.6158, -58.4333] },
  { name: 'CABA · Plaza de Mayo → Liniers',       o: [-34.6083, -58.3712], d: [-34.6444, -58.5236] },
  { name: 'GBA · Tigre → Don Torcuato',           o: [-34.4264, -58.5796], d: [-34.4900, -58.6200] },
  { name: 'GBA · San Martín → José León Suárez',  o: [-34.5725, -58.5242], d: [-34.5350, -58.5640] },
]

const TRUCKS: Truck[] = [
  { name: 'liviano 3.5t/3.0m', weight: 3500,  height: 3.0, width: 2.2, length: 7  },
  { name: 'mediano 12t/4.0m',  weight: 12000, height: 4.0, width: 2.5, length: 12 },
  { name: 'pesado 25t/4.2m',   weight: 25000, height: 4.2, width: 2.6, length: 18 },
  { name: 'alto 8t/4.8m',      weight: 8000,  height: 4.8, width: 2.5, length: 12 },
]

type Edge = { heavy_vehicle_allowed: boolean | null; max_weight_kg: number | null; max_height_m: number | null }

// Color ACTUAL: réplica exacta de la lógica de src/backend/router.ts:45-60.
function currentColor(e: Edge, t: Truck): 'verde' | 'rojo' | 'naranja' {
  const { heavy_vehicle_allowed: hva, max_weight_kg: mw, max_height_m: mh } = e
  if (hva === true) {
    if (mw && t.weight > mw) return 'rojo'
    if (mh && t.height > mh) return 'rojo'
    return 'verde'
  } else if (hva === false) {
    return 'rojo'
  }
  return 'naranja'
}

// Color ESPERADO según la regla pedida (3 colores):
//   naranja → no tenemos datos todavía (heavy_vehicle_allowed = null)
//   rojo    → el camión NO está habilitado (hva=false, o excede un límite posteado)
//   verde   → habilitado; un límite (peso/altura) en null = sin restricción, no bloquea
function expectedColor(e: Edge, t: Truck): 'verde' | 'rojo' | 'naranja' {
  const { heavy_vehicle_allowed: hva, max_weight_kg: mw, max_height_m: mh } = e
  if (hva == null) return 'naranja'                  // sin datos
  if (hva === false) return 'rojo'                   // no habilitado
  const okWeight = mw == null || t.weight <= mw      // null = sin restricción
  const okHeight = mh == null || t.height <= mh
  return okWeight && okHeight ? 'verde' : 'rojo'
}

async function apiRoute(trip: Trip, truck: Truck) {
  const res = await fetch(`${API_URL}/api/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      originLabel: 'o', destinationLabel: 'd',
      origin: { lat: trip.o[0], lon: trip.o[1] },
      destination: { lat: trip.d[0], lon: trip.d[1] },
      vehicle: { maxWeightKg: truck.weight, maxHeightM: truck.height, maxWidthM: truck.width, maxLengthM: truck.length },
      routingOptions: { avoidTolls: true, preferHighways: true },
    }),
  })
  return res.json() as Promise<{ found: boolean; path: { lat: number; lon: number; status?: string }[] }>
}

const geomHash = (path: { lat: number; lon: number }[]) =>
  (path || []).map((n) => `${n.lat.toFixed(5)},${n.lon.toFixed(5)}`).join('|')

describe.runIf(RUN)('ruteo + pintado (integración, base real)', () => {
  let pool: pg.Pool

  beforeAll(() => {
    // Sacamos el query string: pg v8.22 trata sslmode=require como verify-full y
    // pisaría el rejectUnauthorized:false del certificado autofirmado de Aiven.
    pool = new pg.Pool({ connectionString: (DB_URL as string).split('?')[0], ssl: { rejectUnauthorized: false } })
  })
  afterAll(async () => { await pool?.end() })

  async function routeEdges(trip: Trip): Promise<Edge[]> {
    const { rows } = await pool.query(
      'SELECT heavy_vehicle_allowed, max_weight_kg, max_height_m FROM pgr_route_truck($1,$2,$3,$4) WHERE edge_id > 0',
      [trip.o[0], trip.o[1], trip.d[0], trip.d[1]],
    )
    return rows as Edge[]
  }

  // ── REQ 1 ──────────────────────────────────────────────────────────────────
  it('REQ 1 — la traza de la ruta cambia según las características del camión', async () => {
    const small = TRUCKS[0]                       // liviano
    const big   = TRUCKS[TRUCKS.length - 1]       // alto/pesado
    let algunaCambia = false
    for (const trip of TRIPS) {
      const [a, b] = await Promise.all([apiRoute(trip, small), apiRoute(trip, big)])
      if (a.found && b.found && geomHash(a.path) !== geomHash(b.path)) algunaCambia = true
      console.log(`[REQ1] ${trip.name}: traza ${a.found && b.found && geomHash(a.path) !== geomHash(b.path) ? 'CAMBIA' : 'idéntica'} entre ${small.name} y ${big.name}`)
    }
    // Debería cambiar en al menos un viaje. Hoy NO cambia (el motor ignora las
    // medidas del camión) → este expect FALLA y documenta el incumplimiento.
    expect(algunaCambia, 'la ruta no cambió con NINGÚN camión: el motor no considera las características').toBe(true)
  }, 60_000)

  // ── REQ 2 ──────────────────────────────────────────────────────────────────
  it('REQ 2 — el color pinta verde donde el camión está habilitado (null = sin restricción)', async () => {
    // Muestra representativa de aristas de CADA tipo de hva (incluye null).
    const { rows } = await pool.query(`
      (SELECT heavy_vehicle_allowed, max_weight_kg, max_height_m FROM pgr_edges WHERE heavy_vehicle_allowed IS TRUE  LIMIT 200)
      UNION ALL
      (SELECT heavy_vehicle_allowed, max_weight_kg, max_height_m FROM pgr_edges WHERE heavy_vehicle_allowed IS FALSE LIMIT 200)
      UNION ALL
      (SELECT heavy_vehicle_allowed, max_weight_kg, max_height_m FROM pgr_edges WHERE heavy_vehicle_allowed IS NULL  LIMIT 200)
    `)
    const edges = rows as Edge[]

    const mismatches: { edge: Edge; truck: string; actual: string; esperado: string }[] = []
    for (const truck of TRUCKS) {
      for (const e of edges) {
        const cur = currentColor(e, truck)
        const exp = expectedColor(e, truck)
        if (cur !== exp) mismatches.push({ edge: e, truck: truck.name, actual: cur, esperado: exp })
      }
    }
    console.log(`[REQ2] tramos mal pintados: ${mismatches.length} (de ${edges.length} aristas × ${TRUCKS.length} camiones)`)
    if (mismatches[0]) console.log('[REQ2] ejemplo:', JSON.stringify(mismatches[0]))

    // Con la regla de 3 colores (naranja = sin datos), la lógica de router.ts ya
    // coincide → este expect PASA. Si aparece algún mismatch, indica un caso borde.
    expect(mismatches.length, `${mismatches.length} tramos no cumplen la regla de pintado`).toBe(0)
  }, 30_000)

  // ── Reporte informativo (siempre pasa): cómo se pinta cada viaje por camión ──
  it('reporte — pintado por viaje y configuración de camión', async () => {
    for (const trip of TRIPS) {
      const edges = await routeEdges(trip)
      console.log(`\n${trip.name}  (${edges.length} tramos)`)
      for (const truck of TRUCKS) {
        const t = { verde: 0, rojo: 0, naranja: 0 } as Record<string, number>
        for (const e of edges) t[currentColor(e, truck)]++
        console.log(`  ${truck.name.padEnd(20)} verde:${t.verde}  rojo:${t.rojo}  naranja:${t.naranja}`)
      }
    }
    expect(true).toBe(true)
  }, 30_000)
})

// Aviso visible cuando se corre sin las variables (para no creer que "pasó").
describe.skipIf(RUN)('ruteo + pintado (integración)', () => {
  it('SE SALTEA sin AIVEN_DATABASE_URL y API_URL (ver cabecera del archivo)', () => {
    expect(RUN).toBe(false)
  })
})
