/**
 * Detección de desvío de ruta (paso 1: geometría pura).
 *
 * Dado el punto GPS actual del chofer y la polyline de la ruta planificada,
 * calcula la distancia perpendicular mínima del punto a la ruta y decide si
 * superó el umbral de tolerancia. NO toca UI, estado ni red: es una función
 * pura y testeable, pensada para llamarse en el loop de GPS.
 *
 * La confirmación temporal (varias lecturas seguidas), el cooldown y las zonas
 * muertas cerca de origen/destino se construyen ENCIMA de esto en pasos
 * posteriores; acá solo respondemos "¿a cuántos metros de la ruta está?".
 */

/** Tolerancia, en metros, antes de considerar que el chofer se salió de la ruta. */
export const DEVIATION_THRESHOLD_M = 50

/** Metros por grado de latitud (constante a cualquier latitud). */
const M_PER_DEG_LAT = 111_320

export interface LatLng {
  lat: number
  lng: number
}

/**
 * Punto de ruta tal como llega del backend/store: el destino usa `lng` y el
 * path de viajes a veces usa `lon`. `toLatLng` normaliza ambos a `LatLng`.
 */
export type RoutePoint = { lat: number; lng?: number; lon?: number }

export interface DeviationResult {
  /** Distancia perpendicular mínima del punto a la polyline, en metros. */
  distanceM: number
  /** `true` si `distanceM` supera el umbral (el chofer se desvió). */
  isOff: boolean
  /** Índice del segmento más cercano de la polyline (`-1` si no hay ruta válida). */
  segmentIndex: number
}

/**
 * Normaliza un punto de ruta (`lng` o `lon`) a `LatLng`.
 *
 * Si faltan ambos campos (dato corrupto) la longitud queda en `NaN`, no en `0`:
 * un 0 caería en el Golfo de Guinea y dispararía un desvío espurio, mientras que
 * `NaN` lo descarta `Number.isFinite` aguas abajo en `checkDeviation`.
 */
export function toLatLng(p: RoutePoint): LatLng {
  return { lat: p.lat, lng: p.lng ?? p.lon ?? NaN }
}

/**
 * Distancia, en metros, entre el punto `p` y el segmento recto `a`–`b`.
 *
 * Usa una proyección equirectangular local centrada en `p` (el punto pasa a ser
 * el origen). A escala de cuadras el error es despreciable y evita el costo de
 * la trigonometría de Haversine por cada segmento.
 */
function pointToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180)
  // Coordenadas planas en metros, relativas a `p` (que queda en (0,0)).
  const ax = (a.lng - p.lng) * mPerDegLng
  const ay = (a.lat - p.lat) * M_PER_DEG_LAT
  const bx = (b.lng - p.lng) * mPerDegLng
  const by = (b.lat - p.lat) * M_PER_DEG_LAT

  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(ax, ay) // segmento degenerado: a === b

  // Proyección de `p` (origen) sobre la recta a–b, recortada al tramo [a, b].
  // Recortar es lo que captura el caso "doblé en la esquina": al pasarse del
  // final del segmento, la distancia se mide contra el vértice, no contra la
  // recta infinita.
  let t = (-ax * dx + -ay * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(cx, cy)
}

/**
 * Distancia perpendicular mínima, en metros, del punto a la polyline completa,
 * junto con el índice del segmento más cercano.
 *
 * Devuelve `Infinity` / `segmentIndex: -1` si la ruta tiene menos de 2 puntos
 * (no hay nada contra qué comparar).
 */
export function distanceToRoute(point: LatLng, route: LatLng[]): { distanceM: number; segmentIndex: number } {
  if (route.length < 2) return { distanceM: Infinity, segmentIndex: -1 }
  let min = Infinity
  let idx = -1
  for (let i = 0; i < route.length - 1; i++) {
    const d = pointToSegmentM(point, route[i], route[i + 1])
    if (d < min) {
      min = d
      idx = i
    }
  }
  return { distanceM: min, segmentIndex: idx }
}

/**
 * Evalúa si el punto GPS está fuera de la ruta.
 *
 * Si no hay ruta válida (menos de 2 puntos) devuelve `isOff: false`: no se puede
 * afirmar que se desvió sin una ruta contra la cual comparar.
 *
 * @param point     Posición GPS actual del chofer.
 * @param route     Polyline de la ruta planificada (ya normalizada a `LatLng`).
 * @param thresholdM Tolerancia en metros (default `DEVIATION_THRESHOLD_M`).
 */
export function checkDeviation(
  point: LatLng,
  route: LatLng[],
  thresholdM: number = DEVIATION_THRESHOLD_M,
): DeviationResult {
  const { distanceM, segmentIndex } = distanceToRoute(point, route)
  return {
    distanceM,
    segmentIndex,
    isOff: Number.isFinite(distanceM) && distanceM > thresholdM,
  }
}
