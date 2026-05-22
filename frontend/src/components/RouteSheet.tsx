/**
 * RouteSheet.tsx
 *
 * Port de frontend/scripts/ui/routePanel.js.
 * Panel inferior flotante con resumen, instrucciones agrupadas
 * por calle y botón "Iniciar trayecto".
 */

import type { RouteResponse, RouteNode } from "@/types/route";

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function haversineM(a: RouteNode, b: RouteNode): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat  = toRad(b.lat - a.lat);
  const dLon  = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}

interface Instruccion { calle: string; distanciaM: number; }

function buildInstrucciones(path: RouteNode[]): Instruccion[] {
  const instrucciones: Instruccion[] = [];
  let calleActual: string | null = null;
  let distanciaActual = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const calle = path[i].label || "Calle sin nombre";
    const distM = haversineM(path[i], path[i + 1]);

    if (calle === calleActual) {
      distanciaActual += distM;
    } else {
      if (calleActual !== null) {
        instrucciones.push({ calle: calleActual, distanciaM: distanciaActual });
      }
      calleActual     = calle;
      distanciaActual = distM;
    }
  }
  if (calleActual) instrucciones.push({ calle: calleActual, distanciaM: distanciaActual });

  // Filtra segmentos muy cortos (< 10 m) que son ruido del grafo
  return instrucciones.filter((i) => i.distanciaM >= 10);
}

interface Props {
  routeResponse: RouteResponse | null;
  onFocusStart:  () => void;
}

export default function RouteSheet({ routeResponse, onFocusStart }: Props) {
  const found = routeResponse?.found ?? false;

  const title = !routeResponse
    ? "Esperando búsqueda"
    : found
      ? `${routeResponse.originLabel} → ${routeResponse.destinationLabel}`
      : "No se encontró una ruta";

  const summary = !routeResponse
    ? "Completá origen, destino y buscá una ruta para ver el recorrido."
    : found
      ? `${routeResponse.routeSummary} Distancia estimada: ${formatDistance(routeResponse.distanceM)}. Tiempo estimado: ${routeResponse.estimatedDurationMin} min.`
      : routeResponse.routeSummary || "Probá cambiar origen, destino o restricciones del camión.";

  const instrucciones = found && routeResponse
    ? buildInstrucciones(routeResponse.path)
    : [];

  return (
    <article className="route-sheet">
      <div className="sheet-handle" />

      <div className="sheet-header">
        <div>
          <p className="result-label">Ruta sugerida</p>
          <h2 id="route-title">{title}</h2>
        </div>
      </div>

      <p id="route-summary" className="route-summary">{summary}</p>

      <div className="route-actions">
        <button
          id="focus-start-button"
          className="secondary-button"
          type="button"
          disabled={!found}
          onClick={onFocusStart}
        >
          Iniciar trayecto
        </button>
      </div>

      {instrucciones.length > 0 && (
        <ul id="route-steps" className="route-steps">
          {instrucciones.map((inst, i) => (
            <li key={i}>
              <strong>{i + 1}.</strong> {inst.calle}
              <small>{formatDistance(inst.distanciaM)}</small>
            </li>
          ))}
        </ul>
      )}

      {routeResponse?.warnings && routeResponse.warnings.length > 0 && (
        <ul className="route-steps">
          {routeResponse.warnings.map((w, i) => (
            <li key={`w-${i}`} className="warning-item">{w}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
