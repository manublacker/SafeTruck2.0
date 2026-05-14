import 'dotenv/config'
import { supabase } from '../services/supabase'
import { Coordinates, Route, RouteSegment } from '../types'

interface Vehicle {
  weight_kg: number
  height_m: number
  width_m: number
}

export async function calculateRoute(
  origin: Coordinates,
  destination: Coordinates,
  vehicle: Vehicle
): Promise<Route> {
  console.log(`[Router] (${origin.lat},${origin.lng}) → (${destination.lat},${destination.lng})`)

  const { data, error } = await supabase.rpc('pgr_route_truck', {
    start_lat: origin.lat,
    start_lng: origin.lng,
    end_lat: destination.lat,
    end_lng: destination.lng,
  })

  if (error) throw new Error('Error en pgRouting: ' + error.message)
  if (!data || data.length === 0) throw new Error('No se encontró ruta entre los puntos')

  const validRows = data.filter((r: any) => r.edge_id > 0)
  if (validRows.length === 0) throw new Error('Ruta vacía')

  // Filtrar por restricciones del vehículo
  const segments: RouteSegment[] = validRows.map((r: any) => {
    let status: 'ok' | 'unauthorized' | 'unknown' = 'unknown'

    if (r.heavy_vehicle_allowed === true) {
      // Verificar restricciones físicas
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
      status = 'unknown' // NULL = modo colaborativo
    }

    // Parsear geometría
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

  // Calcular totales
  const totalCostSec = validRows[validRows.length - 1]?.agg_cost ?? 0
  const totalDist = validRows.reduce((sum: number, r: any) => {
    return sum + (r.length_m || 0)
  }, 0) / 1000

  const polyline = segments.flatMap(s => s.coordinates)

  return {
    segments,
    total_distance_km: Math.round(totalDist * 10) / 10,
    total_duration_min: Math.round(totalCostSec / 60),
    has_unauthorized: segments.some(s => s.status === 'unauthorized'),
    has_unknown: segments.some(s => s.status === 'unknown'),
    polyline,
  }
}

function parseGeom(geom: any): { lat: number; lng: number }[] {
  if (!geom) return []
  try {
    // Supabase devuelve GeoJSON
    if (typeof geom === 'object' && geom.coordinates) {
      if (geom.type === 'LineString') {
        return geom.coordinates.map((c: number[]) => ({ lat: c[1], lng: c[0] }))
      }
    }
    // WKT fallback
    if (typeof geom === 'string') {
      const match = geom.match(/LINESTRING\s*\(([^)]+)\)/i)
      if (match) {
        return match[1].split(',').map(pt => {
          const [lng, lat] = pt.trim().split(/\s+/).map(Number)
          return { lat, lng }
        })
      }
    }
  } catch {}
  return []
}
