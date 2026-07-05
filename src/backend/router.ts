import 'dotenv/config'
import { Pool } from 'pg'
import { Coordinates, Route, RouteSegment } from '../types'

interface Vehicle {
  weight_kg: number
  height_m: number
  width_m: number
}

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  }
  return pool
}

// Distancia en km entre dos puntos (haversine). Para el guard de "fuera de zona".
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const dLat = (bLat - aLat) * Math.PI / 180
  const dLng = (bLng - aLng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export async function calculateRoute(
  origin: Coordinates,
  destination: Coordinates,
  vehicle: Vehicle
): Promise<Route> {
  console.log(`[Router] (${origin.lat},${origin.lng}) → (${destination.lat},${destination.lng})`)

  // Guard de distancia: el AMBA tiene ~70km de diámetro. Si origen y destino
  // están a >80km, casi siempre es un geocode equivocado (un NOMBRE de lugar
  // que Nominatim ubicó lejos). En ese caso pgr_route_truck arma un bounding box
  // gigante y tarda 10-45s. Cortamos al instante con un error claro. (Medido:
  // trips del AMBA tardan 1-2s; CABA→La Plata ~9s; CABA→Córdoba ~11s.)
  const separationKm = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng)
  if (separationKm > 80) {
    throw new Error('fuera de zona')
  }

  const client = await getPool().connect()
  try {
    // 45s (antes 120s): una ruta normal del AMBA se calcula en pocos segundos;
    // si tarda más suele ser un punto que no engancha con el grafo (origen
    // escrito a mano que cayó fuera de las calles). Mejor cortar y avisar amable
    // que colgar 2 minutos. El handler de /api/routes traduce el timeout a un
    // "no encontramos ruta" (no a un 500).
    await client.query("SET statement_timeout = '45s'")
    // pgr_route_truck_wp: snapea a la ARISTA más cercana (no al nodo/esquina) y
    // rutea con pgr_withPoints, así el viaje arranca y termina a MITAD DE CUADRA,
    // en la dirección real, en vez de saltar a la esquina. Misma forma de columnas
    // que la vieja pgr_route_truck. Para volver atrás: cambiar el nombre acá.
    const result = await client.query(
      'SELECT * FROM pgr_route_truck_wp($1, $2, $3, $4)',
      [origin.lat, origin.lng, destination.lat, destination.lng]
    )
    const data = result.rows

    if (!data || data.length === 0) throw new Error('No se encontró ruta entre los puntos')

    console.log("geom sample:", JSON.stringify(data[1]?.geom));
    const validRows = data.filter((r: any) => r.edge_id > 0)
    if (validRows.length === 0) throw new Error('Ruta vacía')

    const segments: RouteSegment[] = validRows.map((r: any) => {
      const allowed = r.heavy_vehicle_allowed
      const isFalse = allowed === false || allowed === 'false' || allowed === 'f' || allowed === 0
      const isTrue = !isFalse && allowed !== null && allowed !== undefined

      let status: 'ok' | 'unauthorized' | 'unknown' = 'unknown'
      if (isTrue) {
        if (r.max_weight_kg && vehicle.weight_kg > r.max_weight_kg) {
          status = 'unauthorized'
        } else if (r.max_height_m && vehicle.height_m > r.max_height_m) {
          status = 'unauthorized'
        } else {
          status = 'ok'
        }
      } else if (isFalse) {
        status = 'unauthorized'
      } else {
        status = 'unknown'
      }

      const coords = parseGeom(r.geom)
      return {
        id: String(r.edge_id),
        street_name: r.street_name || '',
        municipality: r.municipality || '',
        heavy_vehicle_allowed: r.heavy_vehicle_allowed,
        coordinates: coords,
        status,
      }
    })

    const totalCostSec = validRows[validRows.length - 1]?.agg_cost ?? 0
    const totalDist = validRows.reduce((sum: number, r: any) => sum + (r.length_m || 0), 0) / 1000
    const polyline = segments.flatMap(s => s.coordinates)

    return {
      segments,
      total_distance_km: Math.round(totalDist * 10) / 10,
      total_duration_min: Math.round(totalCostSec / 60),
      has_unauthorized: segments.some(s => s.status === 'unauthorized'),
      has_unknown: segments.some(s => s.status === 'unknown'),
      polyline,
    }
  } finally {
    client.release()
  }
}

export async function denunciarPunto(
  lat: number,
  lng: number,
  tipo: 'multa' | 'sin_problemas',
  tripId: number | null = null,
  notes: string | null = null
): Promise<number> {
  const client = await getPool().connect()
  try {
    const r = await client.query(
      'SELECT denunciar_punto($1, $2, $3, $4, $5) AS edge_id',
      [lat, lng, tipo, tripId, notes]
    )
    return r.rows[0].edge_id
  } finally {
    client.release()
  }
}

function parseGeom(geom: any): { lat: number; lng: number }[] {
  if (!geom) return []
  try {
    let obj = geom
    if (typeof geom === 'string') {
      obj = JSON.parse(geom)
    }
    if (obj && obj.type === 'LineString' && Array.isArray(obj.coordinates)) {
      return obj.coordinates.map((c: number[]) => ({ lat: c[1], lng: c[0] }))
    }
  } catch (e) {
    console.log('parseGeom error:', e)
  }
  return []
}