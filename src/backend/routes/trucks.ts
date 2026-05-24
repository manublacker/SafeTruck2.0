/*******************************************************
 * routes/trucks.ts
 *
 * CRUD de camiones del usuario autenticado.
 * Todas las queries filtran por user_id (tomado del JWT).
 *******************************************************/
import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

const ALLOWED_ESTADOS = new Set([
  "Activo",
  "En ruta",
  "Mantenimiento",
  "Inactivo",
]);

const UPDATABLE_FIELDS = [
  "name",
  "max_weight_kg",
  "max_height_m",
  "max_width_m",
  "max_length_m",
  "patente",
  "modelo",
  "anio",
  "km_actual",
  "fecha_service",
  "proximo_service",
  "estado",
] as const;

type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

interface TruckRow {
  id: number;
  name: string;
  max_weight_kg: number;
  max_height_m: number;
  max_width_m: number;
  max_length_m: number;
  patente: string | null;
  modelo: string | null;
  anio: number | null;
  km_actual: number | null;
  fecha_service: string | null;
  proximo_service: string | null;
  estado: string;
  created_at: string;
  driver_id: number | null;
  driver_nombre: string | null;
  driver_telefono: string | null;
}

interface TruckResponse {
  id: number;
  name: string;
  max_weight_kg: number;
  max_height_m: number;
  max_width_m: number;
  max_length_m: number;
  patente: string | null;
  modelo: string | null;
  anio: number | null;
  km_actual: number | null;
  fecha_service: string | null;
  proximo_service: string | null;
  estado: string;
  created_at: string;
  driver: { id: number; nombre: string; telefono: string | null } | null;
}

const TRUCK_BASE_SELECT = `
  SELECT
    t.id, t.name, t.max_weight_kg, t.max_height_m, t.max_width_m, t.max_length_m,
    t.patente, t.modelo, t.anio, t.km_actual, t.fecha_service, t.proximo_service,
    t.estado, t.created_at,
    d.id       AS driver_id,
    d.nombre   AS driver_nombre,
    d.telefono AS driver_telefono
  FROM trucks t
  LEFT JOIN truck_drivers td ON td.truck_id = t.id
  LEFT JOIN drivers d        ON d.id = td.driver_id AND d.is_active = true
`;

function mapTruckRow(row: TruckRow): TruckResponse {
  const { driver_id, driver_nombre, driver_telefono, ...truck } = row;
  return {
    ...truck,
    driver:
      driver_id !== null && driver_nombre !== null
        ? { id: driver_id, nombre: driver_nombre, telefono: driver_telefono }
        : null,
  };
}

function pickUpdates(body: Record<string, unknown>): Partial<Record<UpdatableField, unknown>> {
  const updates: Partial<Record<UpdatableField, unknown>> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  return updates;
}

// ---------------------------------------------------------------------------
// GET /api/trucks — Lista todos los trucks activos del usuario con su driver
// ---------------------------------------------------------------------------
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const result = await pool.query<TruckRow>(
      `${TRUCK_BASE_SELECT}
       WHERE t.user_id = $1 AND t.is_active = true
       ORDER BY t.created_at ASC`,
      [userId]
    );
    res.json(result.rows.map(mapTruckRow));
  } catch (err) {
    console.error("Error en GET /api/trucks:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/trucks — Crea un nuevo truck para el usuario
// ---------------------------------------------------------------------------
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const {
    name,
    max_weight_kg,
    max_height_m,
    max_width_m,
    max_length_m,
    patente,
    modelo,
    anio,
    km_actual,
    fecha_service,
    proximo_service,
    estado,
  } = req.body ?? {};

  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name es requerido." });
    return;
  }
  if (
    max_weight_kg == null ||
    max_height_m == null ||
    max_width_m == null ||
    max_length_m == null
  ) {
    res.status(400).json({ error: "Dimensiones del camión incompletas." });
    return;
  }
  if (estado && !ALLOWED_ESTADOS.has(estado)) {
    res.status(400).json({ error: "Estado inválido." });
    return;
  }

  try {
    const insert = await pool.query<{ id: number }>(
      `INSERT INTO trucks (
         user_id, name, max_weight_kg, max_height_m, max_width_m, max_length_m,
         patente, modelo, anio, km_actual, fecha_service, proximo_service, estado
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, 'Activo'))
       RETURNING id`,
      [
        userId,
        name,
        max_weight_kg,
        max_height_m,
        max_width_m,
        max_length_m,
        patente ?? null,
        modelo ?? null,
        anio ?? null,
        km_actual ?? null,
        fecha_service ?? null,
        proximo_service ?? null,
        estado ?? null,
      ]
    );

    const created = await pool.query<TruckRow>(
      `${TRUCK_BASE_SELECT} WHERE t.id = $1 AND t.user_id = $2`,
      [insert.rows[0].id, userId]
    );

    res.status(201).json(mapTruckRow(created.rows[0]));
  } catch (err) {
    console.error("Error en POST /api/trucks:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/trucks/:id — Actualiza campos de un truck del usuario
// ---------------------------------------------------------------------------
router.patch("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const truckId = Number(req.params.id);

  if (!Number.isFinite(truckId)) {
    res.status(400).json({ error: "id de camión inválido." });
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
      "SELECT id FROM trucks WHERE id = $1 AND user_id = $2 AND is_active = true",
      [truckId, userId]
    );
    if (!owner.rowCount) {
      res.status(404).json({ error: "Camión no encontrado." });
      return;
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
    const values = fields.map((f) => updates[f] ?? null);
    values.push(truckId, userId);

    await pool.query(
      `UPDATE trucks SET ${setClauses}, updated_at = NOW()
       WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}`,
      values
    );

    const updated = await pool.query<TruckRow>(
      `${TRUCK_BASE_SELECT} WHERE t.id = $1 AND t.user_id = $2`,
      [truckId, userId]
    );

    res.json(mapTruckRow(updated.rows[0]));
  } catch (err) {
    console.error("Error en PATCH /api/trucks/:id:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/trucks/:id — Soft delete del truck
// ---------------------------------------------------------------------------
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const truckId = Number(req.params.id);

  if (!Number.isFinite(truckId)) {
    res.status(400).json({ error: "id de camión inválido." });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE trucks SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [truckId, userId]
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Camión no encontrado." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error("Error en DELETE /api/trucks/:id:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

export default router;
