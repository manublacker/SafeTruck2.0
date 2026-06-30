/*******************************************************
 * search.ts
 *
 * Endpoint GET /api/search
 * Busca calles en la base de datos usando similitud de
 * trigramas sobre el nombre normalizado (nombre_buscable).
 * Si no hay resultados suficientes, consulta Nominatim
 * para cubrir toda Argentina.
 *******************************************************/
import { Router, Request, Response } from "express";
import { Pool } from "pg";

const aivenPool = new Pool({
  connectionString: process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const router = Router();
const MAX_RESULTS = 10;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

async function searchNominatim(q: string): Promise<Array<{ nombre: string; nombreOriginal: string; lat: number; lon: number; score: string; source: string }>> {
  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("q", `${q}, Argentina`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "ar");

    const res = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "User-Agent": "SafeTruck/1.0",
      },
    });

    if (!res.ok) return [];

    const raw = await res.json() as any[];
    return raw.map((r) => {
      const parts = r.display_name.split(",").slice(0, 3).join(",").trim();
      return {
        nombre: parts,
        nombreOriginal: r.display_name,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        score: "0.90",
        source: "nominatim",
      };
    });
  } catch {
    return [];
  }
}

// "X y Y" / "X e Y" / "X esq. Y": consulta de intersección.
const INTERSECTION_RE = /^\s*(.+?)\s+(?:y|e|esq\.?|esquina)\s+(.+?)\s*$/i;

function titleCaseEs(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyMuni(m: string | null | undefined): string {
  if (!m || m.toUpperCase() === "CABA") return "";
  return " · " + m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Busca el/los punto(s) donde se cruzan dos calles ("X y Y"). Una intersección
 * real es un NODO compartido por una arista de X y una de Y, así que la
 * encontramos con un join por id de nodo (índices btree en source/target) —
 * mucho más rápido y preciso que geocodificar el texto entero o usar
 * ST_Intersects geométrico. Devuelve hasta 4 candidatos deduplicados, con
 * municipio para desambiguar calles homónimas del conurbano.
 */
async function findIntersections(q: string) {
  const m = q.match(INTERSECTION_RE);
  if (!m) return [];
  const a = m[1].trim();
  const b = m[2].trim();
  if (a.length < 3 || b.length < 3) return [];

  try {
    const r = await aivenPool.query(
      `WITH a AS (
         SELECT source AS node FROM pgr_edges WHERE unaccent_immutable(lower(street_name)) ILIKE '%'||unaccent_immutable(lower($1))||'%'
         UNION SELECT target FROM pgr_edges WHERE unaccent_immutable(lower(street_name)) ILIKE '%'||unaccent_immutable(lower($1))||'%'
       ),
       b AS (
         SELECT source AS node FROM pgr_edges WHERE unaccent_immutable(lower(street_name)) ILIKE '%'||unaccent_immutable(lower($2))||'%'
         UNION SELECT target FROM pgr_edges WHERE unaccent_immutable(lower(street_name)) ILIKE '%'||unaccent_immutable(lower($2))||'%'
       )
       SELECT ST_Y(n.geom) AS lat, ST_X(n.geom) AS lon,
              (SELECT municipality FROM pgr_edges e WHERE e.source = n.id OR e.target = n.id LIMIT 1) AS muni
       FROM a JOIN b ON a.node = b.node
       JOIN pgr_nodes n ON n.id = a.node
       LIMIT 12`,
      [a, b]
    );

    const seen = new Set<string>();
    const out: Array<{ nombre: string; nombreOriginal: string; lat: number; lon: number; score: string; source: string }> = [];
    for (const row of r.rows) {
      const lat = parseFloat(row.lat);
      const lon = parseFloat(row.lon);
      const key = `${lat.toFixed(4)},${lon.toFixed(4)}`; // dedup ~11m
      if (seen.has(key)) continue;
      seen.add(key);
      const label = `${titleCaseEs(a)} y ${titleCaseEs(b)}${prettyMuni(row.muni)}`;
      out.push({ nombre: label, nombreOriginal: label, lat, lon, score: "0.99", source: "local" });
      if (out.length >= 4) break;
    }
    return out;
  } catch (err) {
    console.error("Error buscando intersección:", err);
    return [];
  }
}

router.get("/", async (req: Request, res: Response) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q || q.length < 2) {
    res.json({ results: [] });
    return;
  }

  let localResults: Array<{ nombre: string; nombreOriginal: string; lat: number; lon: number; score: string; source: string }> = [];

  // Intersecciones "X y Y": van PRIMERO (score 0.99). Si q no es intersección,
  // devuelve [] y seguimos con la búsqueda normal por nombre de calle.
  const intersections = await findIntersections(q);

  try {
    const result = await aivenPool.query(
      `
      SELECT
        street_name AS nombre,
        street_name AS nombre_buscable,
        ST_Y(ST_Centroid(ST_Union(geom))) AS lat,
        ST_X(ST_Centroid(ST_Union(geom))) AS lon,
        GREATEST(
          MAX(similarity(unaccent_immutable(lower(street_name)), unaccent_immutable(lower($1)))),
          CASE WHEN unaccent_immutable(lower(street_name)) ILIKE '%' || unaccent_immutable(lower($1)) || '%' THEN 0.5 ELSE 0 END
        ) AS score
      FROM pgr_edges
      WHERE street_name IS NOT NULL
        AND (
          unaccent_immutable(lower(street_name)) ILIKE '%' || unaccent_immutable(lower($1)) || '%'
          -- Operador % de pg_trgm (no la FUNCIÓN similarity()>x): ESTE sí usa el
          -- índice GIN idx_pgr_edges_street_trgm. Con similarity()>0.2 el planner
          -- hacía Seq Scan de las 539k aristas → 6-14s POR TECLA. Con % es <2s.
          OR unaccent_immutable(lower(street_name)) % unaccent_immutable(lower($1))
        )
      GROUP BY street_name
      ORDER BY score DESC
      LIMIT $2
      `,
      [q, MAX_RESULTS]
    );

    localResults = result.rows.map((row) => ({
      nombre: row.nombre_buscable,
      nombreOriginal: row.nombre,
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      score: parseFloat(row.score).toFixed(2),
      source: "local",
    }));
  } catch (err) {
    console.error("Error en búsqueda local (Aiven):", err);
  }

  // Las intersecciones (si las hay) van al frente del resultado.
  if (intersections.length) localResults = [...intersections, ...localResults];

  try {
    if (localResults.length >= 10) {
      res.json({ results: localResults });
      return;
    }

    const nominatimResults = await searchNominatim(q);

    const combined = [...localResults];
    for (const nr of nominatimResults) {
      const yaTiene = combined.some(
        (r) => Math.abs(r.lat - nr.lat) < 0.001 && Math.abs(r.lon - nr.lon) < 0.001
      );
      if (!yaTiene) combined.push(nr);
    }

    combined.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
    res.json({ results: combined.slice(0, MAX_RESULTS) });
  } catch (err) {
    console.error("Error en búsqueda:", err);
    res.status(500).json({ results: [], error: "Error interno al buscar." });
  }
});

export default router;