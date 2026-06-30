/*******************************************************
 * routes/truck-drivers.ts
 *
 * Asignación de conductor a camión (relación 1:1 efectiva
 * mediante DELETE + INSERT dentro de una transacción).
 * Verifica ownership de truck y driver contra el user_id
 * autenticado antes de mutar.
 *******************************************************/
import { Router, Request, Response } from "express";
import pool from "../db";
import { broadcastToCompany } from "../realtime/hub";

const router = Router();

interface OwnerRow {
  id: number;
}

/**
 * Avisa por WebSocket a los conductores cuyo camión cambió, para que su app
 * móvil vuelva a pedir el camión asignado (GET /me/truck) sin reiniciar.
 * Best-effort: nunca rompe la operación principal. Va DESPUÉS de responder.
 *
 * @param adminId  empresa dueña (sala del broadcast)
 * @param driverIds ids de drivers afectados (se deduplican y se ignoran nulos)
 */
async function notifyTruckChange(adminId: string, driverIds: Array<number | null | undefined>): Promise<void> {
  const unique = [...new Set(driverIds.filter((d): d is number => d != null))];
  for (const driverId of unique) {
    try {
      const r = await pool.query<{ app_user_id: string | null }>(
        "SELECT app_user_id FROM drivers WHERE id = $1",
        [driverId],
      );
      const appUserId = r.rows[0]?.app_user_id;
      // Solo si el conductor tiene cuenta en la app (app_user_id vinculado).
      if (appUserId) {
        broadcastToCompany(adminId, { type: "truck_update" }, { only: appUserId });
      }
    } catch {
      /* best-effort: si falla el aviso, el móvil igual se actualiza al re-enfocar */
    }
  }
}

async function userOwnsTruck(userId: string, truckId: number): Promise<boolean> {
  const result = await pool.query<OwnerRow>(
    "SELECT id FROM trucks WHERE id = $1 AND user_id = $2 AND is_active = true",
    [truckId, userId],
  );
  return Boolean(result.rowCount);
}

async function userOwnsDriver(userId: string, driverId: number): Promise<boolean> {
  const result = await pool.query<OwnerRow>(
    "SELECT id FROM drivers WHERE id = $1 AND user_id = $2 AND is_active = true",
    [driverId, userId],
  );
  return Boolean(result.rowCount);
}

// ---------------------------------------------------------------------------
// POST /api/truck-drivers — Asigna un conductor a un camión.
// Reemplaza la asignación anterior (DELETE + INSERT en una sola tx).
// ---------------------------------------------------------------------------
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { truck_id, driver_id } = req.body ?? {};

  const truckId  = Number(truck_id);
  const driverId = Number(driver_id);

  if (!Number.isFinite(truckId) || !Number.isFinite(driverId)) {
    res.status(400).json({ error: "truck_id y driver_id son requeridos." });
    return;
  }

  try {
    const [ownsTruck, ownsDriver] = await Promise.all([
      userOwnsTruck(userId, truckId),
      userOwnsDriver(userId, driverId),
    ]);
    if (!ownsTruck) {
      res.status(404).json({ error: "Camión no encontrado." });
      return;
    }
    if (!ownsDriver) {
      res.status(404).json({ error: "Conductor no encontrado." });
      return;
    }

    let prevDriverId: number | null = null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Quién tenía este camión antes (para avisarle que lo perdió).
      const prev = await client.query<{ driver_id: number }>(
        "SELECT driver_id FROM truck_drivers WHERE truck_id = $1",
        [truckId],
      );
      prevDriverId = prev.rows[0]?.driver_id ?? null;
      await client.query("DELETE FROM truck_drivers WHERE truck_id = $1", [truckId]);
      await client.query(
        `INSERT INTO truck_drivers (truck_id, driver_id, is_primary)
         VALUES ($1, $2, true)`,
        [truckId, driverId],
      );
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    res.status(201).json({ truck_id: truckId, driver_id: driverId });

    // Tiempo real: avisamos al NUEVO conductor (gana el camión) y al ANTERIOR
    // (lo pierde), para que su app móvil refresque el camión sin reiniciar.
    void notifyTruckChange(userId, [driverId, prevDriverId]);
  } catch (err) {
    console.error("Error en POST /api/truck-drivers:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/truck-drivers/:truck_id — Quita la asignación.
// ---------------------------------------------------------------------------
router.delete("/:truck_id", async (req: Request, res: Response) => {
  const userId  = req.user!.id;
  const truckId = Number(req.params.truck_id);

  if (!Number.isFinite(truckId)) {
    res.status(400).json({ error: "truck_id inválido." });
    return;
  }

  try {
    const ownsTruck = await userOwnsTruck(userId, truckId);
    if (!ownsTruck) {
      res.status(404).json({ error: "Camión no encontrado." });
      return;
    }

    // Quién tenía el camión (antes de borrar la asignación) para avisarle.
    const prev = await pool.query<{ driver_id: number }>(
      "SELECT driver_id FROM truck_drivers WHERE truck_id = $1",
      [truckId],
    );
    const prevDriverId = prev.rows[0]?.driver_id ?? null;

    await pool.query("DELETE FROM truck_drivers WHERE truck_id = $1", [truckId]);
    res.status(204).send();

    // Tiempo real: el conductor que perdió el camión refresca su app sin reiniciar.
    void notifyTruckChange(userId, [prevDriverId]);
  } catch (err) {
    console.error("Error en DELETE /api/truck-drivers/:truck_id:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

export default router;
