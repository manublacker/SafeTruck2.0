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

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

const TOKEN_KEY = "safetruck_token";

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

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) {
      _onUnauthorized?.();
    }
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
