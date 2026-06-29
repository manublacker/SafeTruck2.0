// Geometría PURA de la simulación de recorrido (sin React ni mapas), para poder
// testearla en aislamiento y reutilizarla. Acá viven: la distancia entre dos
// puntos (haversine), el rumbo (bearing), el aplanado de los segmentos a un path
// de puntos, y el recorte gris/color según el progreso del vehículo.

/** Punto como tupla `[lat, lng]` (formato del path plano de la simulación). */
export type LatLng = [number, number]

/** Punto como objeto `{ lat, lng }` (formato de los segmentos de la ruta). */
export interface Coord {
  lat: number
  lng: number
}

/** Tramo de la ruta: una lista de puntos y su aptitud para el camión. */
export interface Segment {
  coordinates: Coord[]
  status?: string
}

/** Progreso de la simulación: índice del punto actual + fracción del tramo. */
export interface SimProgress {
  idx: number
  frac: number
}

const EARTH_RADIUS_M = 6371000

/** Distancia en METROS entre dos puntos (fórmula de haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2)
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x))
}

/** Rumbo en GRADOS (0 = norte, 90 = este) del punto `a` al `b`. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(la2)
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * Aplana los segmentos a un único path de puntos `[lat, lng]`, en orden. Incluye
 * los puntos de borde entre segmentos (el último de uno = el primero del
 * siguiente), igual que el path que recorre la simulación.
 */
export function flattenSegments(segments: Segment[]): LatLng[] {
  const pts: LatLng[] = []
  for (const seg of segments) {
    for (const c of seg.coordinates ?? []) pts.push([c.lat, c.lng])
  }
  return pts
}

export interface SplitResult {
  /** Tramo ya recorrido (para pintar en gris "atrás" del vehículo). */
  passed: { latitude: number; longitude: number }[]
  /** Tramo restante, con los colores reales por aptitud ("adelante"). */
  remaining: Segment[]
}

/**
 * Recorta los segmentos coloreados en dos partes según el progreso de la
 * simulación (`idx`/`frac` sobre el path plano): lo ya recorrido (gris) y lo que
 * falta (mantiene los colores). Estilo Waze: el camino recorrido se ve tenue
 * detrás del vehículo, y el gris llega EXACTAMENTE a la posición interpolada del
 * camión (ni se queda atrás ni se adelanta).
 *
 * El contador avanza en CADA punto (incluidos los de borde entre segmentos), igual
 * que el path plano; si no, el gris se iba adelantando al cruzar tramos.
 */
export function splitSegmentsByProgress(
  segments: Segment[],
  progress: SimProgress | null,
): SplitResult {
  if (!progress) return { passed: [], remaining: segments }
  let pointCounter = 0
  const passed: { latitude: number; longitude: number }[] = []
  const remaining: Segment[] = []
  for (const seg of segments) {
    const coords = seg.coordinates ?? []
    const segRemaining: Coord[] = []
    for (let i = 0; i < coords.length; i++) {
      if (pointCounter < progress.idx) {
        passed.push({ latitude: coords[i].lat, longitude: coords[i].lng })
      } else if (pointCounter === progress.idx && i < coords.length - 1) {
        const a = coords[i]
        const b = coords[i + 1]
        const interpLat = a.lat + (b.lat - a.lat) * progress.frac
        const interpLng = a.lng + (b.lng - a.lng) * progress.frac
        passed.push({ latitude: a.lat, longitude: a.lng })
        passed.push({ latitude: interpLat, longitude: interpLng })
        segRemaining.push({ lat: interpLat, lng: interpLng }, b)
      } else {
        segRemaining.push(coords[i])
      }
      pointCounter++
    }
    if (segRemaining.length >= 2) remaining.push({ ...seg, coordinates: segRemaining })
  }
  return { passed, remaining }
}
