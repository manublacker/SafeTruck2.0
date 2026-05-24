/*******************************************************
 * incidents.ts
 *
 * Endpoints para el sistema de incidentes en vía.
 * Permite reportar y consultar eventos temporales
 * como accidentes, tráfico, obras, controles, etc.
 *******************************************************/

import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

// POST /api/incidents
// Recibe un reporte de incidente en vía.
// Busca la arista más cercana al punto tocado y llama a reportar_incidente().
router.post("/", async (req: Request, res: Response) => {
  const { incident_type, lat, lon, notes } = req.body;

  const validTypes = ['accidente', 'trafico', 'obra', 'control_policial', 'objeto_en_via', 'corte'];

  if (!incident_type || !validTypes.includes(incident_type)) {
    res.status(400).json({ error: "incident_type inválido." });
    return;
  }

  if (!lat || !lon) {
    res.status(400).json({ error: "Coordenadas lat/lon requeridas." });
    return;
  }

  try {
    // busco la arista más cercana al punto tocado
    const resSnap = await pool.query(
      `SELECT a.id
       FROM aristas a
       ORDER BY a.geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
       LIMIT 1`,
      [lon, lat]
    );

    if (resSnap.rows.length === 0) {
      res.status(404).json({ error: "No se encontró una calle cercana." });
      return;
    }

    const aristaId = resSnap.rows[0].id;

    // inserto el incidente con su tiempo de expiración
    const resIncident = await pool.query(
      "SELECT reportar_incidente($1, $2, $3, $4, $5, $6) AS id",
      [aristaId, incident_type, lat, lon, req.user?.id ?? null, notes ?? null]
    );

    res.status(201).json({
      ok: true,
      incident_id: resIncident.rows[0].id,
      arista_id: aristaId,
    });
  } catch (error) {
    console.error("Error en POST /api/incidents:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// GET /api/incidents
// Devuelve todos los incidentes activos para mostrar en el mapa.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM get_active_incidents()");
    res.status(200).json({ incidents: result.rows });
  } catch (error) {
    console.error("Error en GET /api/incidents:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

export default router;