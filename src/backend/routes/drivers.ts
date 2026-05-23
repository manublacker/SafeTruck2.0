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

export default router;
