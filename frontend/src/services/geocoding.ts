/**
 * services/geocoding.ts
 *
 * Port de frontend/scripts/services/geocodingService.js.
 * Combina búsqueda en el backend propio (/api/search) con
 * Nominatim (OpenStreetMap) como fallback para direcciones.
 */

import { searchStreets } from "@/services/api";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export interface GeoSuggestion {
  label:  string;
  lat:    number;
  lon:    number;
  score:  number;
  source: "backend" | "nominatim";
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

// Busca calles en el backend propio usando trigramas
async function searchBackend(query: string): Promise<GeoSuggestion[]> {
  try {
    const results = await searchStreets(query);
    return results.map((r) => ({
      label:  r.nombre.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
      lat:    r.lat,
      lon:    r.lon,
      score:  parseFloat(r.score),
      source: "backend" as const,
    }));
  } catch {
    return [];
  }
}

// Busca en Nominatim — cubre direcciones y lugares conocidos
async function searchNominatim(query: string): Promise<GeoSuggestion[]> {
  try {
    const params = new URLSearchParams({
      q:            `${query}, Buenos Aires, Argentina`,
      format:       "jsonv2",
      limit:        "5",
      countrycodes: "ar",
      viewbox:      "-58.5312,-34.5270,-58.3351,-34.7058",
      bounded:      "1",
    });

    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];

    const raw = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;

    return raw.map((r) => {
      const parts = r.display_name.split(",").map((s) => s.trim());
      const label =
        /^\d+$/.test(parts[0]) && parts[1]
          ? `${parts[1]} ${parts[0]}`
          : parts.slice(0, 2).join(", ");
      return { label, lat: Number(r.lat), lon: Number(r.lon), score: 0, source: "nominatim" as const };
    });
  } catch {
    return [];
  }
}

/**
 * Combina backend + Nominatim, deduplica por label.
 * Orden: buenos del backend (score >= 0.4) → Nominatim → resto del backend.
 */
export async function searchLocations(query: string): Promise<GeoSuggestion[]> {
  const q = normalizeQuery(query);
  if (q.length < 3) return [];

  const [backendResults, nominatimResults] = await Promise.all([
    searchBackend(q),
    searchNominatim(q),
  ]);

  const buenos    = backendResults.filter((r) => r.score >= 0.4);
  const mediocres = backendResults.filter((r) => r.score < 0.4);
  const combined  = [...buenos, ...nominatimResults, ...mediocres];

  const seen = new Set<string>();
  return combined.filter((r) => {
    const key = r.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Geocodifica texto libre — devuelve el primer resultado o lanza un error.
 */
export async function geocodeLocation(query: string): Promise<GeoSuggestion> {
  const results = await searchLocations(query);
  if (!results.length) {
    throw new Error("No encontramos una ubicacion valida para ese texto.");
  }
  return results[0];
}
