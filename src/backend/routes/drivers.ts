/*******************************************************
 * routes/drivers.ts
 *
 * CRUD de conductores del usuario autenticado.
 *******************************************************/
import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

const ALLOWED_ESTADOS = new Set(["Activo", "De licencia", "Inactivo"]);

const UPDATABLE_FIELDS = [
  "nombre",
  "telefono",
  "licencia",
  "categoria_licencia",
  "vencimiento_licencia",
  "estado",
  "is_active",
] as const;

type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

interface DriverRow {
  id: number;
  user_id: string;
  nombre: string;
  telefono: string | null;
  licencia: string | null;
  categoria_licencia: string | null;
  vencimiento_licencia: string | null;
  estado: string;
  is_active: boolean;
  created_at: string;
}

const DRIVER_COLUMNS = `
  id, user_id, nombre, telefono, licencia, categoria_licencia,
  vencimiento_licencia, estado, is_active, created_at
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
  const {
    nombre,
    telefono,
    licencia,
    categoria_licencia,
    vencimiento_licencia,
    estado,
  } = req.body ?? {};

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
      `INSERT INTO drivers (
         user_id, nombre, telefono, licencia, categoria_licencia,
         vencimiento_licencia, estado
       ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'Activo'))
       RETURNING ${DRIVER_COLUMNS}`,
      [
        userId,
        nombre,
        telefono ?? null,
        licencia ?? null,
        categoria_licencia ?? null,
        vencimiento_licencia ?? null,
        estado ?? null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error en POST /api/drivers:", err);
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

// ---------------------------------------------------------------------------
// GET /api/drivers/me — Conductor obtiene su propio perfil (por app_user_id)
// ---------------------------------------------------------------------------
router.get('/me', async (req: Request, res: Response) => {
  const appUserId = req.user!.id
  try {
    const result = await pool.query(
      `SELECT id, nombre, telefono, licencia, categoria_licencia, vencimiento_licencia, estado
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
// PATCH /api/drivers/me — Conductor actualiza sus propios datos desde el mobile
// (usa app_user_id del JWT en lugar de admin user_id)
// ---------------------------------------------------------------------------
router.patch("/me", async (req: Request, res: Response) => {
  const appUserId = req.user!.id;
  const allowed = ["nombre", "telefono", "licencia", "categoria_licencia", "vencimiento_licencia"] as const;
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
       RETURNING id, nombre, telefono, licencia, categoria_licencia, vencimiento_licencia, estado`,
      values
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error en PATCH /api/drivers/me:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

export default router;
