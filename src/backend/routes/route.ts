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
import { findTruckRoute } from "../algorithm/astar";
import pool from "../db";

const router = Router();
const MARGIN = 0.15;

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
    const minLon = Math.min(origin.lon, destination.lon) - MARGIN;
    const maxLon = Math.max(origin.lon, destination.lon) + MARGIN;
    const minLat = Math.min(origin.lat, destination.lat) - MARGIN;
    const maxLat = Math.max(origin.lat, destination.lat) + MARGIN;

    // traigo aristas del bounding box
    const resAristas = await pool.query(
      `SELECT a.id AS arista_id, a.source, a.target, a.costo, a.costo_reverso, a.camion_permitido
       FROM aristas a
       WHERE a.costo > 0
         AND a.x1 BETWEEN $1 AND $2
         AND a.y1 BETWEEN $3 AND $4`,
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

    // traigo nodos únicos
    const nodeIds = new Set<number>();
    for (const row of resAristas.rows) {
      nodeIds.add(row.source);
      nodeIds.add(row.target);
    }
    const resNodos = await pool.query(
      `SELECT id, ST_Y(geom) AS lat, ST_X(geom) AS lon FROM nodos WHERE id = ANY($1::bigint[])`,
      [Array.from(nodeIds)]
    );

    // construyo el grafo
    const nodes: Record<string, { id: string; lat: number; lon: number }> = {};
    for (const row of resNodos.rows) {
      nodes[String(row.id)] = { id: String(row.id), lat: row.lat, lon: row.lon };
    }

    const adjacency: Record<string, any[]> = {};
    for (const row of resAristas.rows) {
      const src = String(row.source);
      const tgt = String(row.target);
      if (!adjacency[src]) adjacency[src] = [];
      if (!adjacency[tgt]) adjacency[tgt] = [];
      if (row.costo > 0) {
        adjacency[src].push({ to: tgt, lengthM: row.costo, truckAllowed: row.camion_permitido, aristaId: row.arista_id });
      }
      if (row.costo_reverso > 0) {
        adjacency[tgt].push({ to: src, lengthM: row.costo_reverso, truckAllowed: row.camion_permitido, aristaId: row.arista_id });
      }
    }

    const grafo = { nodes, adjacency };

    // nodos más cercanos
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

    // scores cooperativos
    const resScores = await pool.query("SELECT arista_id, score, status FROM edge_trust_scores");
    const scoreMap: Record<number, { score: number; status: string }> = {};
    for (const row of resScores.rows) scoreMap[row.arista_id] = { score: row.score, status: row.status };
    for (const nodeId of Object.keys(grafo.adjacency)) {
      for (const edge of grafo.adjacency[nodeId]) {
        const s = scoreMap[edge.aristaId];
        if (s) { edge.trustScore = s.score; edge.trustStatus = s.status; }
      }
    }

    // incidentes
    const resIncidents = await pool.query("SELECT * FROM get_active_incidents()");
    const incidentMap: Record<number, { type: string; count: number }> = {};
    for (const row of resIncidents.rows) {
      if (!incidentMap[row.arista_id]) incidentMap[row.arista_id] = { type: row.incident_type, count: 0 };
      incidentMap[row.arista_id].count += row.confirmed_count;
    }
    for (const nodeId of Object.keys(grafo.adjacency)) {
      for (const edge of grafo.adjacency[nodeId]) {
        const incident = incidentMap[edge.aristaId];
        if (incident) { edge.incidentType = incident.type; edge.incidentCount = incident.count; }
      }
    }

    // A*
    const resultado = findTruckRoute(grafo, nodoOrigen, nodoDestino, vehicle, 'normal');
    const resultadoAlternativo = findTruckRoute(grafo, nodoOrigen, nodoDestino, vehicle, 'alternative');

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

    async function buildPath(nodePath: string[]) {
      return Promise.all(nodePath.map(async (nodeId: string, index: number) => {
        let label = "";
        let geometry: Array<{lat: number, lon: number}> = [];
        let aristaId: number | undefined = undefined;
        if (index < nodePath.length - 1) {
          const siguienteId = nodePath[index + 1];
          const resArista = await pool.query(
            `SELECT COALESCE(a.nombre, rv.nombre_buscable, '') AS nombre_buscable,
                ST_AsGeoJSON(a.geom) AS geom_json, a.source AS src, a.id AS arista_id
             FROM aristas a LEFT JOIN red_vial rv ON rv.id = a.red_vial_id
             WHERE (a.source = $1::integer AND a.target = $2::integer)
                OR (a.source = $2::integer AND a.target = $1::integer)
             ORDER BY a.costo ASC LIMIT 1`,
            [nodeId, siguienteId]
          );
          if (resArista.rows.length > 0) {
            label = resArista.rows[0].nombre_buscable ?? "";
            aristaId = resArista.rows[0].arista_id ?? undefined;
            if (resArista.rows[0].geom_json) {
              const geoj = JSON.parse(resArista.rows[0].geom_json);
              const coords = geoj.coordinates.map(([lon, lat]: [number, number]) => ({ lat, lon }));
              const esInversa = resArista.rows[0].src !== Number(nodeId);
              geometry = esInversa ? [...coords].reverse() : coords;
            }
          }
        }
        return { nodeId, lat: grafo.nodes[nodeId]?.lat ?? 0, lon: grafo.nodes[nodeId]?.lon ?? 0, label, geometry, aristaId };
      }));
    }

    const path = await buildPath(resultado.path);
    const sonIguales = resultadoAlternativo.path.join(',') === resultado.path.join(',');
    const pathAlternativo = resultadoAlternativo.found && !sonIguales ? await buildPath(resultadoAlternativo.path) : null;

    // distancia real
    let distanciaRealM = 0;
    for (let i = 0; i < resultado.path.length - 1; i++) {
      const resArista = await pool.query(
        `SELECT LEAST(costo, 10000) AS costo FROM aristas WHERE source = $1::integer AND target = $2::integer ORDER BY costo ASC LIMIT 1`,
        [resultado.path[i], resultado.path[i + 1]]
      );
      if (resArista.rows.length > 0) distanciaRealM += resArista.rows[0].costo;
    }

    let distanciaAlternativaM = 0;
    if (pathAlternativo) {
      for (let i = 0; i < resultadoAlternativo.path.length - 1; i++) {
        const resArista = await pool.query(
          `SELECT LEAST(costo, 10000) AS costo FROM aristas WHERE source = $1::integer AND target = $2::integer ORDER BY costo ASC LIMIT 1`,
          [resultadoAlternativo.path[i], resultadoAlternativo.path[i + 1]]
        );
        if (resArista.rows.length > 0) distanciaAlternativaM += resArista.rows[0].costo;
      }
    }

    // snap-to-road
    const allGeometryPoints: Array<{lat: number, lon: number}> = [];
    for (const point of path) {
      if (point.geometry && point.geometry.length > 0) allGeometryPoints.push(...point.geometry);
      else allGeometryPoints.push({ lat: point.lat, lon: point.lon });
    }
    const CHUNK_SIZE = 100;
    const snappedPoints: Array<{lat: number, lon: number}> = [];
    for (let i = 0; i < allGeometryPoints.length; i += CHUNK_SIZE) {
      snappedPoints.push(...await snapToRoads(allGeometryPoints.slice(i, i + CHUNK_SIZE)));
    }

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