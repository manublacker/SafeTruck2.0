export type SubscriptionPlan = 'individual' | 'starter' | 'pro' | 'enterprise'

export interface Profile {
  id: string
  full_name: string
  email?: string | null
  phone?: string
  license_number?: string
  /** 'driver' (empresa) | 'independent' (paga su propio plan). Requiere migración 004 en Supabase. */
  role?: string | null
  company_id?: string | null
  company_name?: string | null
  cuit?: string | null
  industry?: string | null
  fleet_size?: string | null
  country?: string | null
  province?: string | null
  plan?: SubscriptionPlan | null
  created_at: string
}

export interface Company {
  id: string
  name: string
  cuit: string
  rubro: string
  plan: SubscriptionPlan
  truck_count: string
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
  | 'multa'
  | 'accidente'
  | 'control_policial'
  | 'obra'
  | 'puente_bajo'
  | 'control_peso'
  | 'corte'
  | 'otro'
  | 'trafico'
  | 'objeto_en_via'

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
  user_id?: string | null
  admin_id?: string | null
  driver_id?: string | null
  vehicle_id?: string | null
  origin_address?: string | null
  destination_address?: string | null
  distance_km?: number | null
  duration_min?: number | null
  scheduled_at?: string | null
  status: 'pending' | 'planned' | 'active' | 'in_progress' | 'completed' | 'cancelled'
  created_at: string
}

export interface Driver {
  id: string
  admin_id: string
  full_name: string
  email?: string | null
  phone?: string | null
  license_number?: string | null
  status: 'active' | 'inactive'
  created_at: string
  updated_at?: string
}

export interface Coordinates {
  lat: number
  lng: number
}
