/**
 * Monitor de desvío de ruta (paso 2: confirmación temporal).
 *
 * Construye sobre la geometría pura de `routeDeviation.ts`. Mientras esa capa
 * responde "¿a cuántos metros de la ruta está este punto?", este monitor decide
 * "¿hay que avisar y recalcular AHORA?" mirando una secuencia de lecturas GPS.
 *
 * Sigue siendo una función pura: no toca UI, estado de React ni red. El reloj
 * entra como dato (`now`), así que es 100% testeable y determinístico.
 *
 * Reglas (acordadas en diseño):
 *  - Un solo punto fuera de ruta NO dispara: hace falta confirmación en varias
 *    lecturas seguidas (`confirmCount`) Y que la distancia esté creciendo, para
 *    no reaccionar ante el ruido del GPS ni cuando el chofer se está corrigiendo.
 *  - Requerir que la distancia crezca cubre de paso el caso "vehículo detenido
 *    fuera de ruta": si no se aleja, no se confirma.
 *  - Tras disparar, un `cooldown` evita recalcular en loop.
 *  - Cerca de origen y destino la detección se apaga (las maniobras finales
 *    siempre "se salen" de la línea).
 */
import { checkDeviation, metersBetween, DEVIATION_THRESHOLD_M, type LatLng } from './routeDeviation'

export interface DeviationMonitorConfig {
  /** Tolerancia perpendicular en metros antes de contar una lectura como "fuera". */
  thresholdM: number
  /** Lecturas consecutivas fuera-de-ruta y alejándose para confirmar el desvío. */
  confirmCount: number
  /** Tiempo, en ms, durante el cual no se vuelve a disparar tras un recálculo. */
  cooldownMs: number
  /** Radio, en metros, alrededor de origen/destino donde se ignora el desvío. */
  deadZoneM: number
  /**
   * Margen, en metros, para considerar que la distancia "creció". Absorbe el
   * jitter del GPS: una caída menor a esto no rompe la racha, pero un regreso
   * real hacia la ruta sí la resetea.
   */
  growToleranceM: number
}

export const DEFAULT_MONITOR_CONFIG: DeviationMonitorConfig = {
  thresholdM: DEVIATION_THRESHOLD_M,
  confirmCount: 3,
  cooldownMs: 30_000,
  deadZoneM: 80,
  growToleranceM: 5,
}

export interface DeviationMonitorState {
  /** Lecturas consecutivas fuera de ruta y alejándose acumuladas hasta ahora. */
  offStreak: number
  /** Distancia perpendicular de la lectura anterior, para evaluar si crece. */
  lastDistanceM: number
  /** Timestamp (ms) hasta el cual la detección queda suprimida por cooldown. */
  cooldownUntil: number
}

export type DeviationStatus =
  | 'no_route'   // ruta inválida: nada contra qué comparar
  | 'cooldown'   // recién se disparó, en período de gracia
  | 'dead_zone'  // cerca de origen/destino, detección apagada
  | 'on_route'   // dentro de tolerancia
  | 'pending'    // fuera de ruta pero todavía sin confirmar
  | 'confirmed'  // desvío confirmado: hay que avisar + recalcular

export interface DeviationReading {
  /** Posición GPS actual del chofer. */
  point: LatLng
  /** Polyline de la ruta planificada (ya normalizada a `LatLng`). */
  route: LatLng[]
  /** Origen del viaje (para la zona muerta). */
  origin: LatLng
  /** Destino del viaje (para la zona muerta). */
  destination: LatLng
  /** Reloj actual en ms (ej: `Date.now()`); inyectado para mantener la pureza. */
  now: number
}

export interface DeviationMonitorResult {
  /** Nuevo estado a guardar para la próxima lectura. */
  state: DeviationMonitorState
  /** `true` solo en la lectura exacta que confirma el desvío (dispara la acción). */
  triggered: boolean
  /** Si la lectura individual cayó fuera de la tolerancia. */
  isOff: boolean
  /** Distancia perpendicular de esta lectura, en metros. */
  distanceM: number
  /** Estado legible de esta lectura (útil para depurar / mostrar en UI). */
  status: DeviationStatus
}

/** Estado inicial de un monitor, antes de la primera lectura. */
export function createDeviationMonitor(): DeviationMonitorState {
  return { offStreak: 0, lastDistanceM: 0, cooldownUntil: 0 }
}

/**
 * Procesa una lectura GPS y devuelve el nuevo estado del monitor.
 *
 * `triggered` es `true` únicamente en la lectura que confirma el desvío; el
 * llamador reacciona a ese flanco (avisa al chofer + recalcula la ruta). El
 * estado devuelto debe pasarse tal cual a la siguiente llamada.
 */
export function stepDeviationMonitor(
  prev: DeviationMonitorState,
  reading: DeviationReading,
  config: Partial<DeviationMonitorConfig> = {},
): DeviationMonitorResult {
  const cfg = { ...DEFAULT_MONITOR_CONFIG, ...config }
  const { point, route, origin, destination, now } = reading
  const { distanceM, isOff } = checkDeviation(point, route, cfg.thresholdM)

  // Helper: arma un resultado que NO dispara y resetea la racha. Conserva el
  // cooldown vigente y actualiza la referencia de distancia (si es finita).
  const idle = (status: DeviationStatus): DeviationMonitorResult => ({
    state: {
      offStreak: 0,
      lastDistanceM: Number.isFinite(distanceM) ? distanceM : prev.lastDistanceM,
      cooldownUntil: prev.cooldownUntil,
    },
    triggered: false,
    isOff,
    distanceM,
    status,
  })

  // Sin ruta válida (menos de 2 puntos o coordenada corrupta): no se evalúa.
  if (!Number.isFinite(distanceM)) return idle('no_route')

  // Cooldown activo: ignorar hasta que venza.
  if (now < prev.cooldownUntil) return idle('cooldown')

  // Zona muerta: cerca de origen o destino las maniobras siempre se salen.
  // Si origen/destino traen una coordenada corrupta (NaN), `metersBetween` da
  // NaN y `NaN <= deadZoneM` sería `false`, desactivando la zona muerta en
  // silencio. Tratamos ese caso como "apagá la detección" (conservador), igual
  // que `no_route`: mejor no confirmar que confirmar en plena maniobra.
  const dOrigin = metersBetween(point, origin)
  const dDest = metersBetween(point, destination)
  if (
    !Number.isFinite(dOrigin) || !Number.isFinite(dDest) ||
    dOrigin <= cfg.deadZoneM || dDest <= cfg.deadZoneM
  ) {
    return idle('dead_zone')
  }

  // Dentro de tolerancia: en ruta, racha a cero.
  if (!isOff) return idle('on_route')

  // ¿Se está alejando? La PRIMERA lectura fuera siempre arranca la racha: no hay
  // una distancia "fuera" anterior contra la cual comparar (la previa podía ser
  // de hace rato, en ruta, o de antes de un cooldown). El requisito de "creciendo"
  // recién aplica de la 2ª lectura en adelante, para distinguir un desvío que se
  // profundiza de un rebote del GPS o una corrección del chofer.
  const growing = prev.offStreak === 0 || distanceM > prev.lastDistanceM - cfg.growToleranceM
  if (!growing) return idle('pending')

  // Fuera de ruta y alejándose: suma a la racha.
  const offStreak = prev.offStreak + 1
  if (offStreak >= cfg.confirmCount) {
    // Confirmado: dispara, arranca el cooldown y reinicia la racha.
    return {
      state: { offStreak: 0, lastDistanceM: distanceM, cooldownUntil: now + cfg.cooldownMs },
      triggered: true,
      isOff,
      distanceM,
      status: 'confirmed',
    }
  }

  return {
    state: { offStreak, lastDistanceM: distanceM, cooldownUntil: prev.cooldownUntil },
    triggered: false,
    isOff,
    distanceM,
    status: 'pending',
  }
}
