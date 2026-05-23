/*******************************************************
 * reports.ts
 *
 * Define el endpoint POST /api/reports.
 * Recibe un reporte de un camionero (multa o sin problemas)
 * sobre una arista específica del grafo, lo persiste en
 * street_reports y actualiza el score en edge_trust_scores
 * llamando a la función registrar_reporte() de la DB.
 *
 * El camionero puede reportar de tres formas:
 *   1. Tocando un punto en el mapa (snap-to-edge)
 *   2. Desde el historial de un viaje (arista_id directo)
 *   3. Manualmente en cualquier momento
 *******************************************************/

import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

// POST /api/reports
// Body esperado:
//   - report_type: 'multa' | 'sin_problemas'
//   - lat + lon: coordenada donde tocó el mapa (snap-to-edge)
//   - arista_id: id directo de la arista (opcional, si viene del historial)
//   - trip_id: id del viaje relacionado (opcional)
//   - notes: comentario libre (opcional)
router.post("/", async (req: Request, res: Response) => {
  const { report_type, lat, lon, arista_id, trip_id, notes } = req.body;

  // valido que llegue el tipo de reporte
  if (!report_type || !["multa", "sin_problemas"].includes(report_type)) {
    res.status(400).json({
      error: "report_type debe ser 'multa' o 'sin_problemas'.",
    });
    return;
  }

  // valido que llegue al menos una forma de identificar la arista
  if (!arista_id && (!lat || !lon)) {
    res.status(400).json({
      error: "Enviá arista_id o coordenadas lat/lon para identificar la calle.",
    });
    return;
  }

  try {
    let aristaIdFinal: number | null = arista_id ?? null;

    // si no vino arista_id directo, busco la arista más cercana al punto tocado
    if (!aristaIdFinal && lat && lon) {
      const resSnap = await pool.query(
        `SELECT a.id
         FROM aristas a
         ORDER BY a.geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
         LIMIT 1`,
        [lon, lat]
      );

      if (resSnap.rows.length === 0) {
        res.status(404).json({
          error: "No se encontró una calle cercana al punto indicado.",
        });
        return;
      }

      aristaIdFinal = resSnap.rows[0].id;
    }

    // inserto el reporte individual
    await pool.query(
      `INSERT INTO street_reports 
        (user_id, trip_id, arista_id, report_type, report_lat, report_lon, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user?.id ?? null,
        trip_id ?? null,
        aristaIdFinal,
        report_type,
        lat ?? null,
        lon ?? null,
        notes ?? null,
      ]
    );

    // actualizo el score de confianza de la arista
    await pool.query("SELECT registrar_reporte($1, $2)", [
      aristaIdFinal,
      report_type,
    ]);

    res.status(201).json({
      ok: true,
      arista_id: aristaIdFinal,
      message: "Reporte registrado. Gracias por contribuir a SafeTruck.",
    });
  } catch (error) {
    console.error("Error en POST /api/reports:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

export default router;