import { supabase } from './supabase'

export interface AssignedTrip {
  id: number
  empresa_user_id: string
  driver_id: number
  driver_app_user_id: string | null
  truck_id: number | null
  origin_label: string | null
  destination_label: string | null
  origin_lat: number | null
  origin_lon: number | null
  destination_lat: number | null
  destination_lon: number | null
  path: any
  distance_m: number | null
  duration_min: number | null
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled'
  scheduled_at: string | null
  accepted_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '')

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await authHeaders()
  const res = await fetch(`${API_URL}${path}`, { ...options, headers: { ...headers, ...options?.headers } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`)
  return data as T
}

export async function fetchAllMyTrips(): Promise<AssignedTrip[]> {
  return apiRequest<AssignedTrip[]>('/api/assigned-trips/mine')
}

export async function updateTripStatus(
  tripId: string,
  status: AssignedTrip['status']
): Promise<void> {
  await apiRequest(`/api/assigned-trips/${tripId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function sendLocation(
  lat: number,
  lng: number,
  tripId: string,
  driverName: string,
  truckPlate?: string
): Promise<void> {
  await apiRequest('/api/locations', {
    method: 'POST',
    body: JSON.stringify({ lat, lng, trip_id: tripId, driver_name: driverName, truck_plate: truckPlate }),
  })
}

export async function clearLocation(): Promise<void> {
  await apiRequest('/api/locations', { method: 'DELETE' })
}

export async function redeemInvitation(code: string): Promise<{ driver_name: string }> {
  return apiRequest('/api/invitations/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function registerPushToken(token: string): Promise<void> {
  await apiRequest('/api/push-tokens', {
    method: 'POST',
    body: JSON.stringify({ token }),
  }).catch(() => null) // no bloqueante
}
