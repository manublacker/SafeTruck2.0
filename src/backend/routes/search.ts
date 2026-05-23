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
import pool from "../db";

const router = Router();
const SIMILARITY_THRESHOLD = 0.2;
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

router.get("/", async (req: Request, res: Response) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q || q.length < 2) {
    res.json({ results: [] });
    return;
  }

  try {
    // busco primero en red_vial (calles de CABA/AMBA)
    const result = await pool.query(
      `
      SELECT
        MIN(nombre) AS nombre,
        nombre_buscable,
        ST_Y(ST_Centroid(ST_Union(geom))) AS lat,
        ST_X(ST_Centroid(ST_Union(geom))) AS lon,
        GREATEST(
          MAX(similarity(unaccent_immutable(lower(nombre_buscable)), unaccent_immutable(lower($1)))),
          CASE WHEN unaccent_immutable(lower(MIN(nombre_buscable))) ILIKE '%' || unaccent_immutable(lower($1)) || '%' THEN 0.5 ELSE 0 END
        ) AS score
      FROM red_vial
      WHERE nombre_buscable IS NOT NULL
        AND (
          unaccent_immutable(lower(nombre_buscable)) ILIKE '%' || unaccent_immutable(lower($1)) || '%'
          OR similarity(unaccent_immutable(lower(nombre_buscable)), unaccent_immutable(lower($1))) > $2
        )
      GROUP BY nombre_buscable
      ORDER BY score DESC
      LIMIT $3
      `,
      [q, SIMILARITY_THRESHOLD, MAX_RESULTS]
    );

    const localResults = result.rows.map((row) => ({
      nombre: row.nombre_buscable,
      nombreOriginal: row.nombre,
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      score: parseFloat(row.score).toFixed(2),
      source: "local",
    }));

    // si hay resultados locales suficientes, los devuelvo sin consultar Nominatim
    if (localResults.length >= 10) {
      res.json({ results: localResults });
      return;
    }

    // si hay pocos resultados locales, consulto Nominatim para toda Argentina
    const nominatimResults = await searchNominatim(q);

    // combino: primero los locales, después los de Nominatim sin duplicar
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