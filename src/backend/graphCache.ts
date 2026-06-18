/*******************************************************
 * graphCache.ts
 *
 * Cache en memoria del grafo vial del AMBA (CABA + GBA).
 *
 * El grafo (calles + nodos) casi no cambia, pero pesa ~1,5M aristas.
 * Traerlo desde Supabase en cada ruta costaba ~6s. En su lugar lo
 * cargamos UNA vez al arrancar el servidor (en segundo plano) y lo
 * reusamos para todas las rutas.
 *
 * Lo que SÍ cambia seguido (scores cooperativos, incidentes) NO se
 * cachea: se sigue trayendo en vivo en cada request y se aplica como
 * "overlay" sin tocar este grafo compartido.
 *******************************************************/

import pool from "./db";

export interface CachedNode { id: string; lat: number; lon: number; }
export interface CachedGraph {
  nodes: Record<string, CachedNode>;
  adjacency: Record<string, any[]>;
}

// Bounding box del AMBA. Fuera de esta zona se usa el método por query (fallback).
export const AMBA_BBOX = { minLon: -59.0, maxLon: -58.1, minLat: -34.9, maxLat: -34.3 };

type CacheState = "idle" | "loading" | "ready" | "error";
let state: CacheState = "idle";
let graph: CachedGraph | null = null;

export function getCacheState(): CacheState { return state; }
export function getCachedGraph(): CachedGraph | null { return state === "ready" ? graph : null; }

// ¿El punto cae dentro del AMBA cacheado?
export function isInAMBA(lat: number, lon: number): boolean {
  return (
    lon >= AMBA_BBOX.minLon && lon <= AMBA_BBOX.maxLon &&
    lat >= AMBA_BBOX.minLat && lat <= AMBA_BBOX.maxLat
  );
}

// Carga el grafo del AMBA en memoria. Idempotente: si ya está cargando o
// listo, no hace nada. No lanza: ante un error deja el estado en 'error' y
// el endpoint sigue funcionando con el fallback por query.
const BATCH = 50000; // filas por tanda — el pooler de Supabase corta respuestas muy grandes

// Trae una tanda de aristas (id > lastId), con hasta 3 reintentos ante cortes de conexión.
async function fetchBatch(lastId: number): Promise<any[]> {
  let intento = 0;
  while (true) {
    try {
      const res = await pool.query(
        `SELECT a.id AS arista_id, a.source, a.target, a.costo, a.costo_reverso, a.camion_permitido,
                a.x1, a.y1, a.x2, a.y2
         FROM aristas a
         WHERE a.costo > 0
           AND a.x1 BETWEEN $1 AND $2
           AND a.y1 BETWEEN $3 AND $4
           -- descarta aristas-salto espurias (extremos a >~5,5 km en línea recta)
           AND abs(a.x2 - a.x1) < 0.06 AND abs(a.y2 - a.y1) < 0.05
           AND a.id > $5
         ORDER BY a.id
         LIMIT $6`,
        [AMBA_BBOX.minLon, AMBA_BBOX.maxLon, AMBA_BBOX.minLat, AMBA_BBOX.maxLat, lastId, BATCH]
      );
      return res.rows;
    } catch (err) {
      intento++;
      if (intento >= 3) throw err;
      console.warn(`[graphCache] tanda (id>${lastId}) falló, reintento ${intento}/3...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export async function loadGraphCache(): Promise<void> {
  if (state === "loading" || state === "ready") return;
  state = "loading";
  const t0 = Date.now();
  console.log("[graphCache] Cargando grafo del AMBA en memoria (en tandas)...");
  try {
    const nodes: Record<string, CachedNode> = {};
    const adjacency: Record<string, any[]> = {};
    let lastId = 0;
    let total = 0;
    let tanda = 0;

    while (true) {
      const rows = await fetchBatch(lastId);
      if (rows.length === 0) break;

      for (const row of rows) {
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

      lastId = rows[rows.length - 1].arista_id;
      total += rows.length;
      tanda++;
      console.log(`[graphCache] tanda ${tanda}: +${rows.length} aristas (acum ${total})`);

      if (rows.length < BATCH) break;
    }

    graph = { nodes, adjacency };
    state = "ready";
    console.log(
      `[graphCache] Grafo AMBA listo: ${total} aristas, ${Object.keys(nodes).length} nodos en ${Date.now() - t0}ms`
    );
  } catch (err) {
    state = "error";
    console.error("[graphCache] Error cargando grafo (se usará fallback por query):", err);
  }
}
