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

export async function calculateRoute(
  origin: Coordinates,
  destination: Coordinates,
  vehicle: Vehicle
): Promise<Route> {
  console.log(`[Router] (${origin.lat},${origin.lng}) → (${destination.lat},${destination.lng})`)

  const client = await getPool().connect()
  try {
    await client.query("SET statement_timeout = '120s'")
    const result = await client.query(
      'SELECT * FROM pgr_route_truck($1, $2, $3, $4)',
      [origin.lat, origin.lng, destination.lat, destination.lng]
    )
    const data = result.rows

    if (!data || data.length === 0) throw new Error('No se encontró ruta entre los puntos')

    console.log("geom sample:", JSON.stringify(data[1]?.geom));
    const validRows = data.filter((r: any) => r.edge_id > 0)
    if (validRows.length === 0) throw new Error('Ruta vacía')

    const segments: RouteSegment[] = validRows.map((r: any) => {
      let status: 'ok' | 'unauthorized' | 'unknown' = 'unknown'
      if (r.heavy_vehicle_allowed === true) {
        if (r.max_weight_kg && vehicle.weight_kg > r.max_weight_kg) {
          status = 'unauthorized'
        } else if (r.max_height_m && vehicle.height_m > r.max_height_m) {
          status = 'unauthorized'
        } else {
          status = 'ok'
        }
      } else if (r.heavy_vehicle_allowed === false) {
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
