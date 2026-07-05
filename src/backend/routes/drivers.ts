/*******************************************************
 * routes/drivers.ts
 *
 * CRUD de conductores del usuario autenticado.
 *******************************************************/
import { Router, Request, Response } from "express";
import pool from "../db";
import { supabase } from "../supabaseClient";

const router = Router();

/**
 * Sincroniza el teléfono de la ficha (drivers) hacia la cuenta del conductor
 * (profiles en Supabase), si el driver está vinculado a un usuario de la app.
 * Best-effort: nunca rompe la operación principal.
 */
async function syncPhoneToProfile(driverId: number, telefono: unknown): Promise<void> {
  try {
    const r = await pool.query<{ app_user_id: string | null }>(
      "SELECT app_user_id FROM drivers WHERE id = $1",
      [driverId]
    );
    const appUserId = r.rows[0]?.app_user_id;
    if (!appUserId) return;
    await supabase.from("profiles").update({ phone: telefono ?? null }).eq("id", appUserId);
  } catch (err) {
    console.error("syncPhoneToProfile falló (no bloqueante):", err);
  }
}

const ALLOWED_ESTADOS = new Set(["Activo", "De licencia", "Inactivo"]);

const UPDATABLE_FIELDS = [
  "nombre",
  "telefono",
  "estado",
  "is_active",
] as const;

type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

interface DriverRow {
  id: number;
  user_id: string;
  app_user_id: string | null;
  nombre: string;
  telefono: string | null;
  estado: string;
  is_active: boolean;
  created_at: string;
}

const DRIVER_COLUMNS = `
  id, user_id, app_user_id, nombre, telefono, estado, is_active, created_at
`;

function pickUpdates(body: Record<string, unknown>): Partial<Record<UpdatableField, unknown>> {
  const updates: Partial<Record<UpdatableField, unknown>> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  return updates;
}

// ---------------------------------------------------------------------------
// GET /api/drivers — Lista drivers activos del usuario
// ---------------------------------------------------------------------------
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const result = await pool.query<DriverRow>(
      `SELECT ${DRIVER_COLUMNS} FROM drivers
       WHERE user_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error en GET /api/drivers:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/drivers — Crea un driver
// ---------------------------------------------------------------------------
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { nombre, telefono, estado } = req.body ?? {};

  if (!nombre || typeof nombre !== "string") {
    res.status(400).json({ error: "nombre es requerido." });
    return;
  }
  if (estado && !ALLOWED_ESTADOS.has(estado)) {
    res.status(400).json({ error: "Estado inválido." });
    return;
  }

  try {
    const result = await pool.query<DriverRow>(
      `INSERT INTO drivers (user_id, nombre, telefono, estado)
       VALUES ($1, $2, $3, COALESCE($4, 'Activo'))
       RETURNING ${DRIVER_COLUMNS}`,
      [userId, nombre, telefono ?? null, estado ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error en POST /api/drivers:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ⚠️ IMPORTANTE: las rutas literales "/me*" van ANTES que las paramétricas
// "/:id" / "/:driver_id". Si no, Express matchea "/me" contra "/:id" (id="me"),
// y el handler corta en 400 ("id inválido") sin llegar nunca al de /me.

// ---------------------------------------------------------------------------
// GET /api/drivers/me — Conductor obtiene su propio perfil (por app_user_id)
// ---------------------------------------------------------------------------
router.get('/me', async (req: Request, res: Response) => {
  const appUserId = req.user!.id
  try {
    const result = await pool.query(
      `SELECT id, nombre, telefono, estado
       FROM drivers WHERE app_user_id = $1 AND is_active = true LIMIT 1`,
      [appUserId]
    )
    res.json(result.rows[0] ?? null)
  } catch (err: any) {
    console.error('Error en GET /api/drivers/me:', err)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/drivers/me/truck — Conductor consulta el camión que le asignó el admin
// ---------------------------------------------------------------------------
router.get('/me/truck', async (req: Request, res: Response) => {
  const appUserId = req.user!.id
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.patente, t.modelo, t.anio,
              t.max_weight_kg, t.max_height_m, t.max_width_m, t.max_length_m, t.estado
       FROM drivers d
       JOIN truck_drivers td ON td.driver_id = d.id
       JOIN trucks t         ON t.id = td.truck_id AND t.is_active = true
       WHERE d.app_user_id = $1 AND d.is_active = true
       LIMIT 1`,
      [appUserId]
    )
    res.json(result.rows[0] ?? null)
  } catch (err: any) {
    console.error('Error en GET /api/drivers/me/truck:', err)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/drivers/me/maintenance — El conductor consulta el estado de
// mantenimiento de SU camión asignado + el vencimiento de SU licencia.
// Read-only. Resuelve la identidad por app_user_id (JWT del mobile), igual que
// /me y /me/truck. days_left = días hasta el vencimiento (negativo = vencido).
// ---------------------------------------------------------------------------
router.get('/me/maintenance', async (req: Request, res: Response) => {
  const appUserId = req.user!.id
  try {
    const driverRes = await pool.query<{
      id: number
      categoria_licencia: string | null
      vencimiento_licencia: string | null
      license_days_left: number | null
    }>(
      `SELECT id, categoria_licencia, vencimiento_licencia,
              CASE WHEN vencimiento_licencia IS NULL THEN NULL
                   ELSE (vencimiento_licencia::date - CURRENT_DATE) END AS license_days_left
       FROM drivers WHERE app_user_id = $1 AND is_active = true LIMIT 1`,
      [appUserId]
    )
    if (!driverRes.rowCount) { res.json(null); return }
    const driver = driverRes.rows[0]

    const truckRes = await pool.query<{
      id: number
      name: string
      patente: string | null
      km_actual: number | null
      fecha_service: string | null
      proximo_service: string | null
      days_left: number | null
    }>(
      `SELECT t.id, t.name, t.patente, t.km_actual, t.fecha_service, t.proximo_service,
              CASE WHEN t.proximo_service IS NULL THEN NULL
                   ELSE (t.proximo_service::date - CURRENT_DATE) END AS days_left
       FROM truck_drivers td
       JOIN trucks t ON t.id = td.truck_id AND t.is_active = true
       WHERE td.driver_id = $1
       LIMIT 1`,
      [driver.id]
    )
    const truck = truckRes.rows[0] ?? null

    let last_maintenance = null
    if (truck) {
      const m = await pool.query(
        `SELECT tipo, fecha, km_al_service, costo, taller, notas, proximo_fecha, proximo_km
         FROM maintenance_records
         WHERE truck_id = $1 AND is_active = true
         ORDER BY fecha DESC, id DESC
         LIMIT 1`,
        [truck.id]
      )
      last_maintenance = m.rows[0] ?? null
    }

    res.json({
      truck,
      last_maintenance,
      license: {
        categoria_licencia: driver.categoria_licencia,
        vencimiento_licencia: driver.vencimiento_licencia,
        days_left: driver.license_days_left,
      },
    })
  } catch (err: any) {
    console.error('Error en GET /api/drivers/me/maintenance:', err)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// PATCH /api/drivers/me — Conductor actualiza sus propios datos desde el mobile
// (usa app_user_id del JWT en lugar de admin user_id)
// ---------------------------------------------------------------------------
router.patch("/me", async (req: Request, res: Response) => {
  const appUserId = req.user!.id;
  const allowed = ["nombre", "telefono"] as const;
  const updates: Record<string, unknown> = {};

  for (const field of allowed) {
    if (field in req.body) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Sin campos para actualizar." });
    return;
  }

  try {
    const existing = await pool.query<{ id: number }>(
      "SELECT id FROM drivers WHERE app_user_id = $1 AND is_active = true LIMIT 1",
      [appUserId]
    );
    if (!existing.rowCount) {
      res.status(404).json({ error: "No estás vinculado a ningún conductor." });
      return;
    }

    const fields = Object.keys(updates);
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
    const values = [...fields.map(f => updates[f] ?? null), existing.rows[0].id];

    const result = await pool.query(
      `UPDATE drivers SET ${setClauses}, updated_at = NOW()
       WHERE id = $${fields.length + 1}
       RETURNING id, nombre, telefono, estado`,
      values
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error en PATCH /api/drivers/me:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/drivers/:id — Actualiza un driver
// ---------------------------------------------------------------------------
router.patch("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const driverId = Number(req.params.id);

  if (!Number.isFinite(driverId)) {
    res.status(400).json({ error: "id de conductor inválido." });
    return;
  }

  const updates = pickUpdates(req.body ?? {});
  const fields = Object.keys(updates) as UpdatableField[];

  if (fields.length === 0) {
    res.status(400).json({ error: "Sin campos para actualizar." });
    return;
  }
  if (
    updates.estado !== undefined &&
    typeof updates.estado === "string" &&
    !ALLOWED_ESTADOS.has(updates.estado)
  ) {
    res.status(400).json({ error: "Estado inválido." });
    return;
  }

  try {
    const owner = await pool.query<{ id: number }>(
      "SELECT id FROM drivers WHERE id = $1 AND user_id = $2",
      [driverId, userId]
    );
    if (!owner.rowCount) {
      res.status(404).json({ error: "Conductor no encontrado." });
      return;
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
    const values = fields.map((f) => updates[f] ?? null);
    values.push(driverId, userId);

    const result = await pool.query<DriverRow>(
      `UPDATE drivers SET ${setClauses}, updated_at = NOW()
       WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}
       RETURNING ${DRIVER_COLUMNS}`,
      values
    );

    if ("telefono" in updates) await syncPhoneToProfile(driverId, updates.telefono);

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error en PATCH /api/drivers/:id:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/drivers/:id — Soft delete
// ---------------------------------------------------------------------------
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const driverId = Number(req.params.id);

  if (!Number.isFinite(driverId)) {
    res.status(400).json({ error: "id de conductor inválido." });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE drivers SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [driverId, userId]
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Conductor no encontrado." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error("Error en DELETE /api/drivers/:id:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

export default router;
