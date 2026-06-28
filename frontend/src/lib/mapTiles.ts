/**
 * mapTiles.ts
 *
 * Config centralizada del basemap (tiles) de Leaflet para toda la web.
 * Cambiar el estilo del mapa = cambiar ACTIVE_TILE acá. No toca lógica.
 *
 * Todos los estilos con `key: false` son gratuitos y NO requieren API key.
 * Los de `key: true` usan tiles raster de MapTiler (look más cercano a Google
 * Maps) y se activan poniendo VITE_MAPTILER_KEY en el .env — sin tocar código.
 *
 * Nota raster: `{r}` se reemplaza por `@2x` en pantallas retina => tiles más
 * nítidos automáticamente. Sigue siendo Leaflet (raster), cero cambio estructural.
 */

export interface TileStyle {
  url: string;
  attribution: string;
  maxZoom: number;
}

// API key opcional de MapTiler (free tier ~100k cargas/mes). Si no está, se usa
// un estilo gratis sin key como fallback.
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

export const TILE_STYLES: Record<string, TileStyle> = {
  // ── Gratis, sin API key (CartoDB) ──────────────────────────────
  // OpenStreetMap clásico (el que se usaba antes).
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  },
  // CartoDB Positron — claro, minimalista, gris. Estilo "limpio".
  positron: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 20,
  },
  // CartoDB Dark Matter — modo oscuro.
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 20,
  },
  // CartoDB Voyager — claro con calles/POIs, lo más parecido a Google Maps
  // dentro de lo gratis-sin-key. RECOMENDADO como default sin key.
  voyager: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 20,
  },

  // ── MapTiler raster (requieren VITE_MAPTILER_KEY) ──────────────
  // Estética muy cercana a Google Maps. Raster, así que sigue siendo Leaflet.
  maptilerStreets: {
    url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}{r}.png?key=${MAPTILER_KEY}`,
    attribution:
      '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; OpenStreetMap contributors',
    maxZoom: 20,
  },
  maptilerBasic: {
    url: `https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}{r}.png?key=${MAPTILER_KEY}`,
    attribution:
      '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; OpenStreetMap contributors',
    maxZoom: 20,
  },
};

/**
 * Estilo activo en toda la web. Cambiá esta línea para repintar el mapa.
 *
 * Si hay key de MapTiler => usa el estilo "streets" (más tipo Google Maps).
 * Si no => cae a Voyager (mejor opción gratis-sin-key). Cambialo a mano por
 * cualquier entrada de TILE_STYLES (positron / dark / voyager / osm / ...).
 */
export const ACTIVE_TILE: TileStyle = MAPTILER_KEY
  ? TILE_STYLES.maptilerStreets
  : TILE_STYLES.voyager;
