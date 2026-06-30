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

// Capitaliza tipo título pero deja los conectores en minúscula ("Cramer y
// Echeverría", "Avenida de Mayo"), en vez de "Cramer Y Echeverría".
const LOWER_WORDS = new Set(["y", "e", "de", "del", "la", "las", "los", "el", "da", "do"]);
function titleCaseEs(s: string): string {
  return s.toLowerCase().replace(/[a-zñáéíóúü]+/g, (w) =>
    LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  );
}

// Busca calles en el backend propio usando trigramas
async function searchBackend(query: string): Promise<GeoSuggestion[]> {
  try {
    const results = await searchStreets(query);
    return results.map((r) => ({
      label:  titleCaseEs(r.nombre),
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
      // Sin sufijo "Buenos Aires": sesgaba hacia CABA y ocultaba el conurbano
      // (Adrogué, Quilmes, etc.). El viewbox + countrycodes ya acotan al AMBA.
      q:            `${query}, Argentina`,
      format:       "jsonv2",
      limit:        "8",
      countrycodes: "ar",
      // Recuadro de sugerencias = AMBA completo (mismo bbox que el grafo cacheado).
      // Antes era solo CABA + sur, por eso no aparecían Tigre, Quilmes, etc.
      viewbox:      "-59.0,-34.3,-58.1,-34.9",
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
 *
 * Prioriza Nominatim (direcciones reales de todo el AMBA) porque la búsqueda
 * del backend infla el "parecido" con palabras genéricas (p. ej. cualquier
 * "Avenida X" matchea "Avenida Adrogué") y tapaba los resultados buenos.
 * El backend solo entra como complemento cuando la coincidencia es casi exacta,
 * o como respaldo total si Nominatim no respondió (rate limit / red).
 */
export async function searchLocations(query: string): Promise<GeoSuggestion[]> {
  const q = normalizeQuery(query);
  if (q.length < 3) return [];

  const [backendResults, nominatimResults] = await Promise.all([
    searchBackend(q),
    searchNominatim(q),
  ]);

  // Solo coincidencias casi exactas del backend (evita la basura por palabras comunes).
  const backendExactos = backendResults.filter((r) => r.score >= 0.6);

  const combined = nominatimResults.length > 0
    ? [...nominatimResults, ...backendExactos]               // direcciones reales primero
    : [...backendExactos, ...backendResults];                // sin Nominatim: respaldo al backend

  const seen = new Set<string>();
  return combined.filter((r) => {
    const key = r.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Geocodifica texto libre (cuando el usuario NO eligió una sugerencia).
 *
 * Para RUTEAR preferimos un punto del buscador propio (`source: "backend"`), que
 * está sobre el grafo de calles: pgr_route_truck lo engancha al instante. Un
 * punto de Nominatim puede caer fuera de las calles ruteables y hacer que el
 * motor se cuelgue hasta el timeout (de ahí el HTTP 500 al asignar a mano). Si
 * no hay resultado del backend, caemos al primero (Nominatim) igual.
 */
export async function geocodeLocation(query: string): Promise<GeoSuggestion> {
  const results = await searchLocations(query);
  if (!results.length) {
    throw new Error("No encontramos una ubicacion valida para ese texto.");
  }
  const onGraph = results.find((r) => r.source === "backend");
  return onGraph ?? results[0];
}
