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

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

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

export function authHeaders(): Record<string, string> {
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

// Saca un mensaje legible del cuerpo { error } del backend (o cae al texto/status).
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: string };
    if (j?.error) return j.error;
  } catch { /* no era JSON */ }
  return text || `HTTP ${res.status}: ${res.statusText}`;
}

// Fetch al backend adjuntando el token. Ante un 401, refresca la sesión UNA vez
// y REINTENTA el request original (volver de MercadoPago o una sesión inactiva
// puede vencer el JWT cacheado; si el refresh_token sigue vivo, la primera acción
// no tiene por qué fallar). Reconstruye los headers en cada intento para que el
// reintento use el token nuevo.
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const build = (): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), ...authHeaders() },
  });
  let res = await fetch(`${BASE_URL}${path}`, build());
  if (res.status === 401 && (await tryRefreshSession())) {
    res = await fetch(`${BASE_URL}${path}`, build());
  }
  return res;
}

// apiFetch + manejo uniforme de estados: 401 (tras el reintento) → logout;
// 402 → paywall; cualquier otro !ok → Error con el mensaje humano del backend.
// Devuelve el JSON parseado (o undefined en 204 No Content).
async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    if (res.status === 401) _onUnauthorized?.();
    if (res.status === 402) throw new SubscriptionRequiredError();
    throw new Error(await errorMessage(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── POST /api/routes ──────────────────────────────────────────
// Calcula la ruta óptima para un camión entre dos puntos.
export async function calculateRoute(payload: RouteRequest): Promise<RouteResponse> {
  return apiRequest<RouteResponse>("/api/routes", {
    method:  "POST",
    headers: JSON_HEADERS,
    body:    JSON.stringify(payload),
  });
}

// ── GET /api/health ───────────────────────────────────────────
// Verifica que el backend y la base de datos estén operativos.
export async function checkHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/api/health");
}

// ── GET /api/search?q=<query> ─────────────────────────────────
// Busca calles en red_vial por similitud de trigramas.
// Devuelve hasta 10 resultados ordenados por score.
export async function searchStreets(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  const data = await apiRequest<{ results: SearchResult[] }>(
    `/api/search?q=${encodeURIComponent(query.trim())}`,
  );
  return data.results ?? [];
}

// ─────────────────────────────────────────────────────────────
// FLOTA — Trucks, Drivers y la asignación entre ambos
// ─────────────────────────────────────────────────────────────

type TruckCreate = Partial<Omit<Truck, "id" | "created_at" | "driver">>;
type TruckUpdate = Partial<Omit<Truck, "id" | "created_at">>;

type DriverCreate = Partial<Omit<Driver, "id" | "created_at">>;
type DriverUpdate = Partial<Omit<Driver, "id" | "created_at">>;

// ── Trucks ────────────────────────────────────────────────────
export async function fetchTrucks(): Promise<Truck[]> {
  return apiRequest<Truck[]>("/api/trucks");
}

export async function createTruck(data: TruckCreate): Promise<Truck> {
  return apiRequest<Truck>("/api/trucks", {
    method:  "POST",
    headers: JSON_HEADERS,
    body:    JSON.stringify(data),
  });
}

export async function updateTruck(id: number, data: TruckUpdate): Promise<Truck> {
  return apiRequest<Truck>(`/api/trucks/${id}`, {
    method:  "PATCH",
    headers: JSON_HEADERS,
    body:    JSON.stringify(data),
  });
}

export async function deleteTruck(id: number): Promise<void> {
  await apiRequest<void>(`/api/trucks/${id}`, { method: "DELETE" });
}

// ── Drivers ───────────────────────────────────────────────────
export async function fetchDrivers(): Promise<Driver[]> {
  return apiRequest<Driver[]>("/api/drivers");
}

export async function createDriver(data: DriverCreate): Promise<Driver> {
  return apiRequest<Driver>("/api/drivers", {
    method:  "POST",
    headers: JSON_HEADERS,
    body:    JSON.stringify(data),
  });
}

export async function updateDriver(id: number, data: DriverUpdate): Promise<Driver> {
  return apiRequest<Driver>(`/api/drivers/${id}`, {
    method:  "PATCH",
    headers: JSON_HEADERS,
    body:    JSON.stringify(data),
  });
}

export async function deleteDriver(id: number): Promise<void> {
  await apiRequest<void>(`/api/drivers/${id}`, { method: "DELETE" });
}

// ── Asignación truck ↔ driver ─────────────────────────────────
export async function assignDriver(truckId: number, driverId: number): Promise<void> {
  await apiRequest<void>("/api/truck-drivers", {
    method:  "POST",
    headers: JSON_HEADERS,
    body:    JSON.stringify({ truck_id: truckId, driver_id: driverId }),
  });
}

export async function unassignDriver(truckId: number): Promise<void> {
  await apiRequest<void>(`/api/truck-drivers/${truckId}`, { method: "DELETE" });
}

// ── Billing / MercadoPago ──────────────────────────────────────────

/**
 * Crea una MercadoPago Checkout Session para el plan dado y devuelve la URL.
 * El llamador debe hacer window.location.href = url para redirigir al usuario.
 */
export async function startCheckout(plan: string): Promise<string> {
  const data = await apiRequest<{ url: string }>("/api/billing/checkout", {
    method:  "POST",
    headers: JSON_HEADERS,
    // returnUrl tells the backend where to redirect after MercadoPago checkout,
    // so it works correctly both in local dev and in production.
    body:    JSON.stringify({ plan, returnUrl: window.location.origin }),
  });
  return data.url;
}

/**
 * Confirma de forma SÍNCRONA el pago al volver del checkout de MercadoPago.
 * Verifica el pago en MP y activa la suscripción sin depender del webhook.
 * Devuelve la suscripción resultante y si se confirmó un pago.
 */
export async function confirmCheckout(
  plan: string | null
): Promise<{ subscription: any; confirmed: boolean }> {
  return apiRequest<{ subscription: any; confirmed: boolean }>("/api/billing/confirm", {
    method:  "POST",
    headers: JSON_HEADERS,
    body:    JSON.stringify({ plan }),
  });
}

/**
 * Devuelve la suscripción activa del usuario logueado, o null si no tiene.
 */
export async function fetchSubscription(): Promise<{
  plan: string;
  status: string;
  current_period_end: string | null;
} | null> {
  const data = await apiRequest<{ subscription: any }>("/api/billing/subscription");
  return data.subscription;
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
  const data = await apiRequest<{ success: boolean; invitation: DriverInvitation }>(
    "/api/invitations",
    { method: "POST" },
  );
  return data.invitation;
}

export async function deleteInvitation(id: string): Promise<void> {
  await apiRequest<void>(`/api/invitations/${id}`, { method: "DELETE" });
}

export async function bulkCreateInvitations(quantity: number): Promise<{ code: string; expires_at: string }[]> {
  return apiRequest<{ code: string; expires_at: string }[]>("/api/invitations/bulk", {
    method:  "POST",
    headers: JSON_HEADERS,
    body:    JSON.stringify({ quantity }),
  });
}

export async function fetchInvitations(): Promise<DriverInvitation[]> {
  return apiRequest<DriverInvitation[]>("/api/invitations");
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
  return apiRequest<AssignedTrip[]>("/api/assigned-trips");
}

// Trae UN viaje con su `path` (el recorrido para dibujar). Las listas ya NO
// mandan el path (era el grueso del egress de Supabase); se pide sólo acá, al
// abrir un viaje en el mapa.
export async function fetchAssignedTripById(id: number | string): Promise<AssignedTrip> {
  return apiRequest<AssignedTrip>(`/api/assigned-trips/${id}`);
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
  return apiRequest<AssignedTrip>("/api/assigned-trips", {
    method:  "POST",
    headers: JSON_HEADERS,
    body:    JSON.stringify(data),
  });
}

export async function deleteAssignedTrip(id: number | string): Promise<void> {
  await apiRequest<void>(`/api/assigned-trips/${id}`, { method: "DELETE" });
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
  return apiRequest<DriverLocation[]>("/api/locations");
}

// ── Mantenimiento y Vencimientos ────────────────────────────────────────────

/** Tipos de intervención permitidos (deben coincidir con ALLOWED_TIPOS del backend). */
export type MaintenanceTipo =
  | "service"
  | "reparacion"
  | "neumaticos"
  | "vtv"
  | "seguro"
  | "otro";

export interface MaintenanceRecord {
  id: number;
  truck_id: number;
  tipo: MaintenanceTipo;
  fecha: string;
  km_al_service: number | null;
  costo: number | null;
  taller: string | null;
  notas: string | null;
  proximo_km: number | null;
  proximo_fecha: string | null;
  created_at: string;
  truck: { name: string | null; patente: string | null };
}

export type MaintenanceCreate = {
  truck_id: number;
  tipo?: MaintenanceTipo;
  fecha: string;
  km_al_service?: number | null;
  costo?: number | null;
  taller?: string | null;
  notas?: string | null;
  proximo_km?: number | null;
  proximo_fecha?: string | null;
};

export type MaintenanceUpdate = Partial<Omit<MaintenanceCreate, "truck_id">>;

/** Camión en el semáforo de alertas (con días hasta el próximo service). */
export interface MaintenanceTruckAlert {
  id: number;
  name: string;
  patente: string | null;
  km_actual: number | null;
  fecha_service: string | null;
  proximo_service: string | null;
  days_left: number | null;
}

/** Chofer con licencia por vencer / vencida. */
export interface MaintenanceLicenseAlert {
  id: number;
  nombre: string;
  categoria_licencia: string | null;
  vencimiento_licencia: string | null;
  days_left: number | null;
}

export interface MaintenanceAlerts {
  trucks: {
    vencidos: MaintenanceTruckAlert[];
    proximos: MaintenanceTruckAlert[];
    al_dia: MaintenanceTruckAlert[];
    total: number;
  };
  licencias: {
    vencidas: MaintenanceLicenseAlert[];
    por_vencer: MaintenanceLicenseAlert[];
  };
}

export async function fetchMaintenance(): Promise<MaintenanceRecord[]> {
  return apiRequest<MaintenanceRecord[]>("/api/maintenance");
}

export async function fetchMaintenanceByTruck(truckId: number): Promise<MaintenanceRecord[]> {
  return apiRequest<MaintenanceRecord[]>(`/api/maintenance/truck/${truckId}`);
}

export async function fetchMaintenanceAlerts(): Promise<MaintenanceAlerts> {
  return apiRequest<MaintenanceAlerts>("/api/maintenance/alerts");
}

export async function createMaintenance(data: MaintenanceCreate): Promise<MaintenanceRecord> {
  return apiRequest<MaintenanceRecord>("/api/maintenance", {
    method:  "POST",
    headers: JSON_HEADERS,
    body:    JSON.stringify(data),
  });
}

export async function updateMaintenance(id: number, data: MaintenanceUpdate): Promise<MaintenanceRecord> {
  return apiRequest<MaintenanceRecord>(`/api/maintenance/${id}`, {
    method:  "PATCH",
    headers: JSON_HEADERS,
    body:    JSON.stringify(data),
  });
}

export async function deleteMaintenance(id: number): Promise<void> {
  await apiRequest<void>(`/api/maintenance/${id}`, { method: "DELETE" });
}
