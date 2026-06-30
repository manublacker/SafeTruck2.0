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
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  const { incident_type, lat, lon, notes } = req.body;

  const validTypes = ['multa', 'accidente', 'control_policial', 'obra', 'puente_bajo', 'corte', 'control_peso', 'otro', 'trafico', 'objeto_en_via'];

  if (!incident_type || !validTypes.includes(incident_type)) {
    res.status(400).json({ error: "incident_type inválido." });
    return;
  }

  // `== null` para no rechazar coordenadas válidas en 0 (consistente con
  // /api/locations y /api/reports).
  if (lat == null || lon == null) {
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
      [aristaId, incident_type, lat, lon, req.user!.id, notes ?? null]
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

// PATCH /api/incidents/:id/confirm
// Otro conductor confirma que el incidente SIGUE activo (tipo Waze).
// Suma una confirmación y renueva la expiración (mínimo +20 min) para que no
// caduque mientras la calle siga afectada. No se puede confirmar el propio.
router.patch("/:id/confirm", authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE incidents
          SET confirmed_count = confirmed_count + 1,
              expires_at = GREATEST(expires_at, NOW() + INTERVAL '20 minutes')
        WHERE id = $1 AND active = TRUE AND expires_at > NOW() AND user_id <> $2
        RETURNING id, confirmed_count, expires_at`,
      [id, userId]
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Incidente no disponible para confirmar." });
      return;
    }
    res.json({ ok: true, ...result.rows[0] });
  } catch (error) {
    console.error("Error en PATCH /api/incidents/:id/confirm:", error);
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