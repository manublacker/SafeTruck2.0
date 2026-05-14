export interface Profile {
  id: string
  full_name: string
  phone?: string
  license_number?: string
  created_at: string
}

export interface Vehicle {
  id: string
  user_id: string
  plate: string
  name?: string
  weight_kg: number
  height_m: number
  width_m: number
  length_m: number
  axles: number
  is_default: boolean
  created_at: string
}

export interface Incident {
  id: string
  user_id: string
  location: { lat: number; lng: number }
  incident_type: IncidentType
  description?: string
  is_active: boolean
  upvotes: number
  downvotes: number
  created_at: string
  expires_at: string
}

export type IncidentType =
  | 'fine'
  | 'accident'
  | 'police_check'
  | 'road_work'
  | 'low_bridge'
  | 'weight_check'
  | 'road_closed'
  | 'other'

export interface RouteSegment {
  id: string
  street_name?: string
  municipality: string
  heavy_vehicle_allowed: boolean | null
  coordinates: { lat: number; lng: number }[]
  status: 'ok' | 'unauthorized' | 'unknown'
}

export interface Route {
  segments: RouteSegment[]
  total_distance_km: number
  total_duration_min: number
  has_unauthorized: boolean
  has_unknown: boolean
  polyline: { lat: number; lng: number }[]
}

export interface Trip {
  id: string
  user_id: string
  vehicle_id: string
  origin_address?: string
  destination_address?: string
  distance_km?: number
  duration_min?: number
  status: 'planned' | 'active' | 'completed' | 'cancelled'
  created_at: string
}

export interface Coordinates {
  lat: number
  lng: number
}
