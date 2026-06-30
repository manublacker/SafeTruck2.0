/**
 * services/api.ts
 *
 * Centraliza todas las llamadas HTTP al backend SafeTruck.
 * El proxy de Vite redirige /api → http://localhost:3000 en desarrollo.
 * En producción se usa la misma URL base (mismo origen o variable de entorno).
 */

import type {
  RouteRequest,
  RouteResponse,
  HealthResponse,
  SearchResult,
} from "@/types/route";
import type { Truck, Driver } from "@/types/auth";
import { supabase } from "@/lib/supabase";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

const TOKEN_KEY = "safetruck_token";

export class SubscriptionRequiredError extends Error {
  constructor() {
    super("subscription_required");
    this.name = "SubscriptionRequiredError";
  }
}

// Called by AuthProvider on mount so the service layer can trigger logout
// without importing React context.
let _onUnauthorized: (() => void) | null = null;
export function registerUnauthorizedHandler(cb: () => void): void {
  _onUnauthorized = cb;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// On 401, try to refresh the Supabase session before logging the user out.
// Returning from MercadoPago Checkout can take long enough that the cached JWT
// expires; we shouldn't kick the user to /login if a valid refresh_token
// is still available.
let _refreshInFlight: Promise<boolean> | null = null;
async function tryRefreshSession(): Promise<boolean> {
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) return false;
    setToken(data.session.access_token);
    return true;
  })();
  try {
    return await _refreshInFlight;
  } finally {
    _refreshInFlight = null;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) {
      const refreshed = await tryRefreshSession();
      if (!refreshed) _onUnauthorized?.();
    }
    if (res.status === 402) throw new SubscriptionRequiredError();
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── POST /api/routes ──────────────────────────────────────────
// Calcula la ruta óptima para un camión entre dos puntos.
export async function calculateRoute(payload: RouteRequest): Promise<RouteResponse> {
  const res = await fetch(`${BASE_URL}/api/routes`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body:    JSON.stringify(payload),
  });
  return handleResponse<RouteResponse>(res);
}

// ── GET /api/health ───────────────────────────────────────────
// Verifica que el backend y la base de datos estén operativos.
export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE_URL}/api/health`);
  return handleResponse<HealthResponse>(res);
}

// ── GET /api/search?q=<query> ─────────────────────────────────
// Busca calles en red_vial por similitud de trigramas.
// Devuelve hasta 10 resultados ordenados por score.
export async function searchStreets(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  const res = await fetch(
    `${BASE_URL}/api/search?q=${encodeURIComponent(query.trim())}`,
    { headers: authHeaders() }
  );
  const data = await handleResponse<{ results: SearchResult[] }>(res);
  return data.results ?? [];
}

// ─────────────────────────────────────────────────────────────
// FLOTA — Trucks, Drivers y la asignación entre ambos
// ─────────────────────────────────────────────────────────────

const JSON_CONTENT_TYPE = { "Content-Type": "application/json" } as const;

type TruckCreate = Partial<Omit<Truck, "id" | "created_at" | "driver">>;
type TruckUpdate = Partial<Omit<Truck, "id" | "created_at">>;

type DriverCreate = Partial<Omit<Driver, "id" | "created_at">>;
type DriverUpdate = Partial<Omit<Driver, "id" | "created_at">>;

// ── Trucks ────────────────────────────────────────────────────
export async function fetchTrucks(): Promise<Truck[]> {
  const res = await fetch(`${BASE_URL}/api/trucks`, { headers: authHeaders() });
  return handleResponse<Truck[]>(res);
}

export async function createTruck(data: TruckCreate): Promise<Truck> {
  const res = await fetch(`${BASE_URL}/api/trucks`, {
    method:  "POST",
    headers: { ...JSON_CONTENT_TYPE, ...authHeaders() },
    body:    JSON.stringify(data),
  });
  return handleResponse<Truck>(res);
}

export async function updateTruck(id: number, data: TruckUpdate): Promise<Truck> {
  const res = await fetch(`${BASE_URL}/api/trucks/${id}`, {
    method:  "PATCH",
    headers: { ...JSON_CONTENT_TYPE, ...authHeaders() },
    body:    JSON.stringify(data),
  });
  return handleResponse<Truck>(res);
}

export async function deleteTruck(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/trucks/${id}`, {
    method:  "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    if (res.status === 401) await Promise.resolve();
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
}

// ── Drivers ───────────────────────────────────────────────────
export async function fetchDrivers(): Promise<Driver[]> {
  const res = await fetch(`${BASE_URL}/api/drivers`, { headers: authHeaders() });
  return handleResponse<Driver[]>(res);
}

export async function createDriver(data: DriverCreate): Promise<Driver> {
  const res = await fetch(`${BASE_URL}/api/drivers`, {
    method:  "POST",
    headers: { ...JSON_CONTENT_TYPE, ...authHeaders() },
    body:    JSON.stringify(data),
  });
  return handleResponse<Driver>(res);
}

export async function updateDriver(id: number, data: DriverUpdate): Promise<Driver> {
  const res = await fetch(`${BASE_URL}/api/drivers/${id}`, {
    method:  "PATCH",
    headers: { ...JSON_CONTENT_TYPE, ...authHeaders() },
    body:    JSON.stringify(data),
  });
  return handleResponse<Driver>(res);
}

export async function deleteDriver(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/drivers/${id}`, {
    method:  "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
}

// ── Asignación truck ↔ driver ─────────────────────────────────
export async function assignDriver(truckId: number, driverId: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/truck-drivers`, {
    method:  "POST",
    headers: { ...JSON_CONTENT_TYPE, ...authHeaders() },
    body:    JSON.stringify({ truck_id: truckId, driver_id: driverId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
}

export async function unassignDriver(truckId: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/truck-drivers/${truckId}`, {
    method:  "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
}

// ── Billing / MercadoPago ──────────────────────────────────────────

/**
 * Crea una MercadoPago Checkout Session para el plan dado y devuelve la URL.
 * El llamador debe hacer window.location.href = url para redirigir al usuario.
 */
export async function startCheckout(plan: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/billing/checkout`, {
    method:  "POST",
    headers: { ...JSON_CONTENT_TYPE, ...authHeaders() },
    // returnUrl tells the backend where to redirect after MercadoPago checkout,
    // so it works correctly both in local dev and in production.
    body:    JSON.stringify({ plan, returnUrl: window.location.origin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return (data as { url: string }).url;
}

/**
 * Confirma de forma SÍNCRONA el pago al volver del checkout de MercadoPago.
 * Verifica el pago en MP y activa la suscripción sin depender del webhook.
 * Devuelve la suscripción resultante y si se confirmó un pago.
 */
export async function confirmCheckout(
  plan: string | null
): Promise<{ subscription: any; confirmed: boolean }> {
  const res = await fetch(`${BASE_URL}/api/billing/confirm`, {
    method:  "POST",
    headers: { ...JSON_CONTENT_TYPE, ...authHeaders() },
    body:    JSON.stringify({ plan }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as { subscription: any; confirmed: boolean };
}

/**
 * Devuelve la suscripción activa del usuario logueado, o null si no tiene.
 */
export async function fetchSubscription(): Promise<{
  plan: string;
  status: string;
  current_period_end: string | null;
} | null> {
  const res = await fetch(`${BASE_URL}/api/billing/subscription`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return (data as { subscription: any }).subscription;
}

// ── Invitations ────────────────────────────────────────────────────────────────

export interface DriverInvitation {
  id: number;
  code: string;
  admin_id: string;
  hint_name: string | null;
  driver_id: number | null;
  driver_nombre: string | null;
  redeemed_at: string | null;
  expires_at: string;
  created_at: string;
}

export async function createInvitation(): Promise<{ code: string; expires_at: string }> {
  const res = await fetch(`${BASE_URL}/api/invitations`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await handleResponse<{ success: boolean; invitation: DriverInvitation }>(res);
  return data.invitation;
}

export async function deleteInvitation(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/invitations/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
}

export async function bulkCreateInvitations(quantity: number): Promise<{ code: string; expires_at: string }[]> {
  const res = await fetch(`${BASE_URL}/api/invitations/bulk`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  });
  return handleResponse<{ code: string; expires_at: string }[]>(res);
}

export async function fetchInvitations(): Promise<DriverInvitation[]> {
  const res = await fetch(`${BASE_URL}/api/invitations`, {
    headers: authHeaders(),
  });
  return handleResponse<DriverInvitation[]>(res);
}

// ── Assigned Trips ─────────────────────────────────────────────────────────────

export interface AssignedTrip {
  id: number;
  driver_id: number;
  driver_nombre?: string | null;
  truck_id: number;
  truck_patente?: string | null;
  origin_label: string;
  destination_label: string;
  origin_lat: number;
  origin_lon: number;
  destination_lat: number;
  destination_lon: number;
  distance_m?: number | null;
  duration_min?: number | null;
  scheduled_at: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  status: string;
  /** Origen del viaje: 'company' (lo asignó la empresa) o 'personal' (lo armó el conductor). */
  trip_source?: string;
  created_at: string;
  /** Ruta calculada y guardada al crear el viaje (RouteResponse con los tramos
   *  coloreados). Puede venir como objeto (JSONB) o string (TEXT) según la columna,
   *  o null en viajes viejos. Se usa para "Ver viaje" en el mapa. */
  path?: RouteResponse | string | null;
}

export async function fetchAssignedTrips(): Promise<AssignedTrip[]> {
  const res = await fetch(`${BASE_URL}/api/assigned-trips`, {
    headers: authHeaders(),
  });
  return handleResponse<AssignedTrip[]>(res);
}

export async function createAssignedTrip(data: {
  driver_id: number;
  truck_id: number;
  origin_address: string;
  destination_address: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  route: unknown;
  scheduled_at?: string;
}): Promise<AssignedTrip> {
  const res = await fetch(`${BASE_URL}/api/assigned-trips`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<AssignedTrip>(res);
}

// ── Driver Locations ───────────────────────────────────────────────────────────

export interface DriverLocation {
  driver_app_user_id: string;
  driver_name: string;
  truck_plate: string;
  lat: number;
  lng: number;
  updated_at: string;
}

export async function fetchDriverLocations(): Promise<DriverLocation[]> {
  const res = await fetch(`${BASE_URL}/api/locations`, {
    headers: authHeaders(),
  });
  return handleResponse<DriverLocation[]>(res);
}
