/*******************************************************
 * route.ts
 *
 * Define el endpoint POST /api/routes.
 * Calcula la ruta usando A* en Node.js sobre las aristas
 * del bounding box entre origen y destino.
 *
 * Flujo de una request:
 *   1. Valido que lleguen los campos obligatorios
 *   2. Calculo el bounding box con margen
 *   3. Traigo aristas y nodos del bounding box desde la DB
 *   4. Construyo el grafo en memoria
 *   5. Ejecuto A* entre los nodos más cercanos al origen y destino
 *   6. Armo y devuelvo la respuesta
 *******************************************************/

import { Router, Request, Response } from "express";
import { findTruckRoute, EdgeOverlay } from "../algorithm/astar";
import { getCachedGraph, isInAMBA } from "../graphCache";
import pool from "../db";

const router = Router();
// Límites del margen (colchón) que se suma al bounding box origen↔destino.
// Antes era fijo 0.15 (~16 km), que traía ~550k aristas y forzaba un Seq Scan.
const MARGIN_MIN = 0.02;
const MARGIN_MAX = 0.08;

async function snapToRoads(points: Array<{lat: number, lon: number}>): Promise<Array<{lat: number, lon: number}>> {
  const apiKey = process.env.GOOGLE_ROADS_API_KEY;
  if (!apiKey || points.length === 0) return points;
  const path = points.map(p => `${p.lat},${p.lon}`).join('|');
  const url = `https://roads.googleapis.com/v1/snapToRoads?path=${encodeURIComponent(path)}&interpolate=true&key=${apiKey}`;
  try {
    const res = await fetch(url);
    const data: any = await res.json();
    if (!data.snappedPoints) return points;
    return data.snappedPoints.map((p: any) => ({ lat: p.location.latitude, lon: p.location.longitude }));
  } catch {
    return points;
  }
}

router.post("/", async (req: Request, res: Response) => {
  const { originLabel, destinationLabel, vehicle, origin, destination } = req.body;

  if (!origin || !destination || !vehicle) {
    res.status(400).json({
      found: false, routeId: null,
      originLabel: originLabel ?? "", destinationLabel: destinationLabel ?? "",
      distanceM: 0, estimatedDurationMin: 0,
      routeSummary: "Faltan campos obligatorios.",
      path: [], warnings: ["Enviá origin, destination y vehicle en el body."],
    });
    return;
  }

  try {
    type Grafo = { nodes: Record<string, { id: string; lat: number; lon: number }>; adjacency: Record<string, any[]> };
    let grafo: Grafo;

    // ¿Usamos el grafo cacheado del AMBA? Solo si está listo y ambos extremos
    // caen dentro del AMBA. Si no, fallback: traer el bbox por query.
    const cached = getCachedGraph();
    const usarCache = cached !== null &&
      isInAMBA(origin.lat, origin.lon) && isInAMBA(destination.lat, destination.lon);

    if (usarCache) {
      grafo = cached as Grafo;
    } else {
      // Margen adaptativo: proporcional a la separación origen↔destino, acotado.
      // El bbox ya contiene ambos puntos; el margen es solo el colchón para desvíos.
      const span = Math.max(
        Math.abs(origin.lon - destination.lon),
        Math.abs(origin.lat - destination.lat)
      );
      const MARGIN = Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, span * 0.5));

      const minLon = Math.min(origin.lon, destination.lon) - MARGIN;
      const maxLon = Math.max(origin.lon, destination.lon) + MARGIN;
      const minLat = Math.min(origin.lat, destination.lat) - MARGIN;
      const maxLat = Math.max(origin.lat, destination.lat) + MARGIN;

      // aristas del bbox (incluye x1,y1=source y x2,y2=target → nodos sin 2ª query)
      const resAristas = await pool.query(
        `SELECT a.id AS arista_id, a.source, a.target, a.costo, a.costo_reverso, a.camion_permitido,
                a.x1, a.y1, a.x2, a.y2
         FROM aristas a
         WHERE a.costo > 0
           AND a.x1 BETWEEN $1 AND $2
           AND a.y1 BETWEEN $3 AND $4
           -- descarta aristas-salto espurias (extremos a >~5,5 km en línea recta)
           AND abs(a.x2 - a.x1) < 0.06 AND abs(a.y2 - a.y1) < 0.05`,
        [minLon, maxLon, minLat, maxLat]
      );

      if (resAristas.rows.length === 0) {
        res.status(200).json({
          found: false, routeId: null,
          originLabel: originLabel ?? "", destinationLabel: destinationLabel ?? "",
          distanceM: 0, estimatedDurationMin: 0,
          routeSummary: "No se encontraron calles en el área seleccionada.",
          path: [], warnings: ["Probá con un destino diferente."],
        });
        return;
      }

      const nodes: Record<string, { id: string; lat: number; lon: number }> = {};
      const adjacency: Record<string, any[]> = {};
      for (const row of resAristas.rows) {
        const src = String(row.source);
        const tgt = String(row.target);
        if (!nodes[src]) nodes[src] = { id: src, lat: row.y1, lon: row.x1 };
        if (!nodes[tgt]) nodes[tgt] = { id: tgt, lat: row.y2, lon: row.x2 };
        if (!adjacency[src]) adjacency[src] = [];
        if (!adjacency[tgt]) adjacency[tgt] = [];
        if (row.costo > 0) {
          adjacency[src].push({ to: tgt, lengthM: row.costo, truckAllowed: row.camion_permitido, aristaId: row.arista_id });
        }
        if (row.costo_reverso > 0) {
          adjacency[tgt].push({ to: src, lengthM: row.costo_reverso, truckAllowed: row.camion_permitido, aristaId: row.arista_id });
        }
      }
      grafo = { nodes, adjacency };
    }

    // nodos más cercanos (siempre por query: requiere búsqueda espacial con índice)
    const resOrigen = await pool.query("SELECT id FROM nearest_graph_node($1, $2)", [origin.lon, origin.lat]);
    const resDestino = await pool.query("SELECT id FROM nearest_graph_node($1, $2)", [destination.lon, destination.lat]);

    if (resOrigen.rows.length === 0 || resDestino.rows.length === 0) {
      res.status(404).json({
        found: false, routeId: null,
        originLabel: originLabel ?? "", destinationLabel: destinationLabel ?? "",
        distanceM: 0, estimatedDurationMin: 0,
        routeSummary: "No se encontró un nodo cercano.",
        path: [], warnings: ["Verificá que las coordenadas estén dentro del área cubierta."],
      });
      return;
    }

    const nodoOrigen = String(resOrigen.rows[0].id);
    const nodoDestino = String(resDestino.rows[0].id);

    // Borde raro: el nodo más cercano cae fuera del grafo cacheado.
    if (!grafo.nodes[nodoOrigen] || !grafo.nodes[nodoDestino]) {
      res.status(404).json({
        found: false, routeId: null,
        originLabel: originLabel ?? "", destinationLabel: destinationLabel ?? "",
        distanceM: 0, estimatedDurationMin: 0,
        routeSummary: "No se encontró un nodo cercano dentro del área cubierta.",
        path: [], warnings: ["Probá con un punto un poco más cercano a una calle."],
      });
      return;
    }

    // Scores e incidentes → overlay (NO se mutan las aristas del grafo cacheado).
    const overlays = new Map<number, EdgeOverlay>();

    const resScores = await pool.query("SELECT arista_id, score, status FROM edge_trust_scores");
    for (const row of resScores.rows) {
      const o = overlays.get(row.arista_id) ?? {};
      o.trustScore = row.score;
      o.trustStatus = row.status;
      overlays.set(row.arista_id, o);
    }

    const resIncidents = await pool.query("SELECT * FROM get_active_incidents()");
    const incidentMap: Record<number, { type: string; count: number }> = {};
    for (const row of resIncidents.rows) {
      if (!incidentMap[row.arista_id]) incidentMap[row.arista_id] = { type: row.incident_type, count: 0 };
      incidentMap[row.arista_id].count += row.confirmed_count;
    }
    for (const aristaIdStr of Object.keys(incidentMap)) {
      const aid = Number(aristaIdStr);
      const inc = incidentMap[aid];
      const o = overlays.get(aid) ?? {};
      o.incidentType = inc.type;
      o.incidentCount = inc.count;
      overlays.set(aid, o);
    }

    // A*
    const resultado = findTruckRoute(grafo, nodoOrigen, nodoDestino, vehicle, 'normal', overlays);
    const resultadoAlternativo = findTruckRoute(grafo, nodoOrigen, nodoDestino, vehicle, 'alternative', overlays);

    if (!resultado.found) {
      res.status(200).json({
        found: false, routeId: null,
        originLabel: originLabel ?? "", destinationLabel: destinationLabel ?? "",
        distanceM: 0, estimatedDurationMin: 0,
        routeSummary: "No se encontró una ruta compatible con el perfil del camión.",
        path: [], warnings: ["Probá modificar restricciones o seleccionar otro destino."],
      });
      return;
    }

    // Devuelve la mejor arista (menor longitud) que sale de `src` hacia `tgt`,
    // tomándola del grafo ya cargado en memoria — sin consultar la DB.
    function findEdge(src: string, tgt: string): any | null {
      const edges = grafo.adjacency[src] ?? [];
      let best: any = null;
      for (const e of edges) {
        if (e.to === tgt && (best === null || e.lengthM < best.lengthM)) best = e;
      }
      return best;
    }

    // Recolecta los aristaId de un camino reusando las aristas en memoria.
    function aristaIdsDePath(nodePath: string[]): number[] {
      const ids: number[] = [];
      for (let i = 0; i < nodePath.length - 1; i++) {
        const e = findEdge(nodePath[i], nodePath[i + 1]);
        if (e?.aristaId !== undefined) ids.push(e.aristaId);
      }
      return ids;
    }

    // UNA sola query trae nombre + geometría de todas las aristas usadas por
    // ambos caminos (antes era una query por cada par de nodos, ×2 caminos).
    const aristaIdsNecesarios = Array.from(new Set([
      ...aristaIdsDePath(resultado.path),
      ...(resultadoAlternativo.found ? aristaIdsDePath(resultadoAlternativo.path) : []),
    ]));

    const edgeDetailMap: Record<number, { nombre: string; geomJson: string | null; src: number }> = {};
    if (aristaIdsNecesarios.length > 0) {
      const resDetalles = await pool.query(
        `SELECT a.id AS arista_id,
                COALESCE(a.nombre, rv.nombre_buscable, '') AS nombre_buscable,
                ST_AsGeoJSON(a.geom) AS geom_json,
                a.source AS src
         FROM aristas a LEFT JOIN red_vial rv ON rv.id = a.red_vial_id
         WHERE a.id = ANY($1::bigint[])`,
        [aristaIdsNecesarios]
      );
      for (const row of resDetalles.rows) {
        edgeDetailMap[row.arista_id] = {
          nombre: row.nombre_buscable ?? "",
          geomJson: row.geom_json ?? null,
          src: row.src,
        };
      }
    }

    // Arma el path en memoria, sin tocar la DB.
    function buildPath(nodePath: string[]) {
      return nodePath.map((nodeId: string, index: number) => {
        let label = "";
        let geometry: Array<{lat: number, lon: number}> = [];
        let aristaId: number | undefined = undefined;
        if (index < nodePath.length - 1) {
          const edge = findEdge(nodeId, nodePath[index + 1]);
          if (edge?.aristaId !== undefined) {
            aristaId = edge.aristaId;
            const detalle = edgeDetailMap[edge.aristaId];
            if (detalle) {
              label = detalle.nombre;
              if (detalle.geomJson) {
                const geoj = JSON.parse(detalle.geomJson);
                const coords = geoj.coordinates.map(([lon, lat]: [number, number]) => ({ lat, lon }));
                const esInversa = detalle.src !== Number(nodeId);
                geometry = esInversa ? [...coords].reverse() : coords;
              }
            }
          }
        }
        return { nodeId, lat: grafo.nodes[nodeId]?.lat ?? 0, lon: grafo.nodes[nodeId]?.lon ?? 0, label, geometry, aristaId };
      });
    }


    const path = buildPath(resultado.path);
    const sonIguales = resultadoAlternativo.path.join(',') === resultado.path.join(',');
    const pathAlternativo = resultadoAlternativo.found && !sonIguales ? buildPath(resultadoAlternativo.path) : null;

    // distancia real: suma de longitudes desde el grafo en memoria (sin queries).
    function distanciaDePath(nodePath: string[]): number {
      let total = 0;
      for (let i = 0; i < nodePath.length - 1; i++) {
        const e = findEdge(nodePath[i], nodePath[i + 1]);
        if (e) total += Math.min(e.lengthM, 10000);
      }
      return total;
    }

    const distanciaRealM = distanciaDePath(resultado.path);
    const distanciaAlternativaM = pathAlternativo ? distanciaDePath(resultadoAlternativo.path) : 0;

    // snap-to-road
    const allGeometryPoints: Array<{lat: number, lon: number}> = [];
    for (const point of path) {
      if (point.geometry && point.geometry.length > 0) allGeometryPoints.push(...point.geometry);
      else allGeometryPoints.push({ lat: point.lat, lon: point.lon });
    }
    const CHUNK_SIZE = 100;
    const chunks: Array<Array<{lat: number, lon: number}>> = [];
    for (let i = 0; i < allGeometryPoints.length; i += CHUNK_SIZE) {
      chunks.push(allGeometryPoints.slice(i, i + CHUNK_SIZE));
    }
    // los chunks se snapean en paralelo; map preserva el orden original
    const snappedChunks = await Promise.all(chunks.map((c) => snapToRoads(c)));
    const snappedPoints: Array<{lat: number, lon: number}> = ([] as Array<{lat: number, lon: number}>).concat(...snappedChunks);

    // guardo viaje
    const aristaIds: number[] = path.filter(p => p.aristaId !== undefined).map(p => p.aristaId as number);
    let tripId: number | null = null;
    try {
      const resTrip = await pool.query(
        `INSERT INTO trips (user_id, origin_lat, origin_lon, destination_lat, destination_lon, arista_ids, distance_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.user?.id ?? null, origin.lat, origin.lon, destination.lat, destination.lon, aristaIds, Math.round(distanciaRealM)]
      );
      tripId = resTrip.rows[0].id;
    } catch (err) {
      console.error("No se pudo guardar el viaje en trips:", err);
    }

    const velocidadMs = 30000 / 3600;

    res.status(200).json({
      found: true,
      routeId: `route-${Date.now()}`,
      tripId,
      originLabel: originLabel ?? "",
      destinationLabel: destinationLabel ?? "",
      distanceM: Math.round(distanciaRealM),
      estimatedDurationMin: Math.round(distanciaRealM / velocidadMs / 60),
      routeSummary: "Ruta calculada correctamente.",
      path,
      snappedPoints,
      alternativeRoute: pathAlternativo ? {
        path: pathAlternativo,
        distanceM: Math.round(distanciaAlternativaM),
        estimatedDurationMin: Math.round(distanciaAlternativaM / velocidadMs / 60),
      } : null,
      warnings: [],
    });

  } catch (error) {
    console.error("Error en /api/routes:", error);
    res.status(500).json({
      found: false, routeId: null,
      originLabel: originLabel ?? "", destinationLabel: destinationLabel ?? "",
      distanceM: 0, estimatedDurationMin: 0,
      routeSummary: "Error interno del servidor.",
      path: [], warnings: ["Contactá al equipo de backend."],
    });
  }
});

export default router;