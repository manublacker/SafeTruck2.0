/*******************************************************
 * incidents.ts
 *
 * Endpoints para el sistema de incidentes en vía.
 * Permite reportar y consultar eventos temporales
 * como accidentes, tráfico, obras, controles, etc.
 *******************************************************/

import { Router, Request, Response } from "express";
import pool from "../db";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

// POST /api/incidents
// Recibe un reporte de incidente en vía.
// Busca la arista más cercana al punto tocado y llama a reportar_incidente().
router.post("/", async (req: Request, res: Response) => {
  const { incident_type, lat, lon, notes } = req.body;

  // Tipos del mobile (inglés) + tipos legacy (español)
  const validTypes = [
    'fine', 'police_check', 'accident', 'road_work', 'low_bridge', 'road_closed', 'weight_check', 'other',
    'accidente', 'trafico', 'obra', 'control_policial', 'objeto_en_via', 'corte',
  ];

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
    const result = await pool.query(
      `SELECT id, arista_id, incident_type, lat, lon,
              expires_at, confirmed_count, reported_at, user_id
       FROM incidents
       WHERE active = TRUE AND expires_at > NOW()
       ORDER BY reported_at DESC`
    );
    res.status(200).json({ incidents: result.rows });
  } catch (error) {
    console.error("Error en GET /api/incidents:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// PATCH /api/incidents/:id/deactivate
// El conductor que creó el incidente lo marca como resuelto.
router.patch("/:id/deactivate", authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE incidents SET active = FALSE
       WHERE id = $1 AND user_id = $2 AND active = TRUE
       RETURNING id`,
      [id, userId]
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Incidente no encontrado o sin permiso." });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("Error en PATCH /api/incidents/:id/deactivate:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

export default router;