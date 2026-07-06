/*******************************************************
 * routes/maintenance.ts
 *
 * Módulo de Mantenimiento y Vencimientos.
 *
 * - CRUD del historial de mantenimiento (tabla maintenance_records).
 * - GET /alerts: cruza los vencimientos de service (trucks) y de licencia
 *   (drivers) para armar el semáforo del dashboard.
 *
 * Todas las queries filtran por user_id (tomado del JWT), igual que trucks.ts.
 * Es puramente aditivo: no toca ruteo, viajes ni nada existente.
 *******************************************************/
import { Router, Request, Response } from "express";
import pool from "../db";
import { runMaintenanceAlerts } from "../jobs/maintenanceAlerts";

const router = Router();

/** Ventana (en días) para considerar un vencimiento como "próximo". */
const SERVICE_WARN_DAYS = 30;
const LICENSE_WARN_DAYS = 30;

const ALLOWED_TIPOS = new Set([
  "service",
  "reparacion",
  "neumaticos",
  "vtv",
  "seguro",
  "otro",
]);

/**
 * Rehace el espejo de mantenimiento en `trucks` (fecha_service / proximo_service
 * / km_actual) a partir del registro activo más reciente del camión. Si ya no
 * queda ninguno, limpia fecha_service y proximo_service. El POST espeja estos
 * campos al cargar un service; este helper mantiene la consistencia cuando se
 * edita (PATCH) o elimina (DELETE) un registro, para que "Estado de la flota"
 * no muestre datos fantasma.
 */
async function resyncTruckServiceMirror(truckId: number, userId: string): Promise<void> {
  await pool.query(
    `UPDATE trucks t
       SET fecha_service   = last.fecha,
           proximo_service = last.proximo_fecha,
           km_actual       = last.km_al_service,
           updated_at      = NOW()
     FROM (
       SELECT fecha, proximo_fecha, km_al_service
       FROM maintenance_records
       WHERE truck_id = $1 AND user_id = $2 AND is_active = true
       ORDER BY fecha DESC, created_at DESC
       LIMIT 1
     ) AS last
     WHERE t.id = $1 AND t.user_id = $2`,
    [truckId, userId]
  );

  // Si no quedó ningún registro activo, el subquery no matchea (no hace UPDATE)
  // → limpiamos los campos espejados a mano.
  await pool.query(
    `UPDATE trucks
       SET fecha_service = NULL, proximo_service = NULL, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM maintenance_records
         WHERE truck_id = $1 AND user_id = $2 AND is_active = true
       )`,
    [truckId, userId]
  );
}

const UPDATABLE_FIELDS = [
  "tipo",
  "fecha",
  "km_al_service",
  "costo",
  "taller",
  "notas",
  "proximo_km",
  "proximo_fecha",
] as const;

type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

interface MaintenanceRow {
  id: number;
  truck_id: number;
  tipo: string;
  fecha: string;
  km_al_service: number | null;
  costo: number | null;
  taller: string | null;
  notas: string | null;
  proximo_km: number | null;
  proximo_fecha: string | null;
  created_at: string;
  truck_name: string | null;
  truck_patente: string | null;
}

interface MaintenanceResponse {
  id: number;
  truck_id: number;
  tipo: string;
  fecha: string;
  km_al_service: number | null;
  costo: number | null;
  taller: string | null;
  notas: string | null;
  proximo_km: number | null;
  proximo_fecha: string | null;
  created_at: string;
  truck: { name: string | null; patente: string | null };
}

const MAINT_BASE_SELECT = `
  SELECT
    m.id, m.truck_id, m.tipo, m.fecha, m.km_al_service, m.costo, m.taller,
    m.notas, m.proximo_km, m.proximo_fecha, m.created_at,
    t.name    AS truck_name,
    t.patente AS truck_patente
  FROM maintenance_records m
  JOIN trucks t ON t.id = m.truck_id
`;

function mapMaintenanceRow(row: MaintenanceRow): MaintenanceResponse {
  const { truck_name, truck_patente, ...rest } = row;
  return { ...rest, truck: { name: truck_name, patente: truck_patente } };
}

function pickUpdates(body: Record<string, unknown>): Partial<Record<UpdatableField, unknown>> {
  const updates: Partial<Record<UpdatableField, unknown>> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  return updates;
}

// ---------------------------------------------------------------------------
// GET /api/maintenance — Historial completo del usuario (todos los camiones)
// ---------------------------------------------------------------------------
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const result = await pool.query<MaintenanceRow>(
      `${MAINT_BASE_SELECT}
       WHERE m.user_id = $1 AND m.is_active = true
       ORDER BY m.fecha DESC, m.id DESC`,
      [userId]
    );
    res.json(result.rows.map(mapMaintenanceRow));
  } catch (err) {
    console.error("Error en GET /api/maintenance:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/maintenance/alerts — Semáforo de vencimientos (service + licencias)
// Debe ir ANTES de /truck/:id para que Express no lo tome como :id.
// ---------------------------------------------------------------------------
router.get("/alerts", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    // Camiones con su estado de service. days_left = días hasta el próximo
    // service (por fecha). NULL si el camión no tiene próximo service cargado.
    const trucks = await pool.query<{
      id: number;
      name: string;
      patente: string | null;
      km_actual: number | null;
      fecha_service: string | null;
      proximo_service: string | null;
      days_left: number | null;
    }>(
      `SELECT
         id, name, patente, km_actual, fecha_service, proximo_service,
         CASE WHEN proximo_service IS NULL THEN NULL
              ELSE (proximo_service::date - CURRENT_DATE) END AS days_left
       FROM trucks
       WHERE user_id = $1 AND is_active = true
       ORDER BY proximo_service ASC NULLS LAST`,
      [userId]
    );

    // Choferes con licencia por vencer / vencida.
    const drivers = await pool.query<{
      id: number;
      nombre: string;
      categoria_licencia: string | null;
      vencimiento_licencia: string | null;
      days_left: number | null;
    }>(
      `SELECT
         id, nombre, categoria_licencia, vencimiento_licencia,
         CASE WHEN vencimiento_licencia IS NULL THEN NULL
              ELSE (vencimiento_licencia::date - CURRENT_DATE) END AS days_left
       FROM drivers
       WHERE user_id = $1 AND is_active = true
       ORDER BY vencimiento_licencia ASC NULLS LAST`,
      [userId]
    );

    const vencidos: typeof trucks.rows = [];
    const proximos: typeof trucks.rows = [];
    const al_dia: typeof trucks.rows = [];
    for (const t of trucks.rows) {
      if (t.days_left === null) al_dia.push(t);
      else if (t.days_left < 0) vencidos.push(t);
      else if (t.days_left <= SERVICE_WARN_DAYS) proximos.push(t);
      else al_dia.push(t);
    }

    const licencias_vencidas: typeof drivers.rows = [];
    const licencias_por_vencer: typeof drivers.rows = [];
    for (const d of drivers.rows) {
      if (d.days_left === null) continue;
      if (d.days_left < 0) licencias_vencidas.push(d);
      else if (d.days_left <= LICENSE_WARN_DAYS) licencias_por_vencer.push(d);
    }

    res.json({
      trucks: { vencidos, proximos, al_dia, total: trucks.rows.length },
      licencias: {
        vencidas: licencias_vencidas,
        por_vencer: licencias_por_vencer,
      },
    });
  } catch (err) {
    console.error("Error en GET /api/maintenance/alerts:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/maintenance/truck/:id — Historial de un camión puntual
// ---------------------------------------------------------------------------
router.get("/truck/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const truckId = Number(req.params.id);

  if (!Number.isFinite(truckId)) {
    res.status(400).json({ error: "id de camión inválido." });
    return;
  }

  try {
    const result = await pool.query<MaintenanceRow>(
      `${MAINT_BASE_SELECT}
       WHERE m.user_id = $1 AND m.truck_id = $2 AND m.is_active = true
       ORDER BY m.fecha DESC, m.id DESC`,
      [userId, truckId]
    );
    res.json(result.rows.map(mapMaintenanceRow));
  } catch (err) {
    console.error("Error en GET /api/maintenance/truck/:id:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/maintenance — Carga un registro de mantenimiento
// ---------------------------------------------------------------------------
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const {
    truck_id,
    tipo,
    fecha,
    km_al_service,
    costo,
    taller,
    notas,
    proximo_km,
    proximo_fecha,
  } = req.body ?? {};

  const truckId = Number(truck_id);
  if (!Number.isFinite(truckId)) {
    res.status(400).json({ error: "truck_id es requerido." });
    return;
  }
  if (!fecha || typeof fecha !== "string") {
    res.status(400).json({ error: "fecha es requerida." });
    return;
  }
  if (tipo && !ALLOWED_TIPOS.has(tipo)) {
    res.status(400).json({ error: "Tipo de mantenimiento inválido." });
    return;
  }

  try {
    // El camión debe pertenecer al usuario (evita cargar servicios a camiones
    // ajenos falsificando el truck_id).
    const owner = await pool.query<{ id: number }>(
      "SELECT id FROM trucks WHERE id = $1 AND user_id = $2 AND is_active = true",
      [truckId, userId]
    );
    if (!owner.rowCount) {
      res.status(404).json({ error: "Camión no encontrado." });
      return;
    }

    const insert = await pool.query<{ id: number }>(
      `INSERT INTO maintenance_records (
         user_id, truck_id, tipo, fecha, km_al_service, costo, taller, notas,
         proximo_km, proximo_fecha
       ) VALUES ($1, $2, COALESCE($3, 'service'), $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        userId,
        truckId,
        tipo ?? null,
        fecha,
        km_al_service ?? null,
        costo ?? null,
        taller ?? null,
        notas ?? null,
        proximo_km ?? null,
        proximo_fecha ?? null,
      ]
    );

    // Espejamos los datos "de cabecera" en trucks para que el resto de la app
    // (FleetView ya muestra proximo_service / km_actual) quede consistente.
    await pool.query(
      `UPDATE trucks
         SET fecha_service   = $1,
             proximo_service = COALESCE($2, proximo_service),
             km_actual       = COALESCE($3, km_actual),
             updated_at      = NOW()
       WHERE id = $4 AND user_id = $5`,
      [fecha, proximo_fecha ?? null, km_al_service ?? null, truckId, userId]
    );

    const created = await pool.query<MaintenanceRow>(
      `${MAINT_BASE_SELECT} WHERE m.id = $1 AND m.user_id = $2`,
      [insert.rows[0].id, userId]
    );

    res.status(201).json(mapMaintenanceRow(created.rows[0]));
  } catch (err) {
    console.error("Error en POST /api/maintenance:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/maintenance/:id — Edita un registro de mantenimiento
// ---------------------------------------------------------------------------
router.patch("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const recordId = Number(req.params.id);

  if (!Number.isFinite(recordId)) {
    res.status(400).json({ error: "id de registro inválido." });
    return;
  }

  const updates = pickUpdates(req.body ?? {});
  const fields = Object.keys(updates) as UpdatableField[];

  if (fields.length === 0) {
    res.status(400).json({ error: "Sin campos para actualizar." });
    return;
  }
  if (
    updates.tipo !== undefined &&
    typeof updates.tipo === "string" &&
    !ALLOWED_TIPOS.has(updates.tipo)
  ) {
    res.status(400).json({ error: "Tipo de mantenimiento inválido." });
    return;
  }

  try {
    const owner = await pool.query<{ id: number; truck_id: number }>(
      "SELECT id, truck_id FROM maintenance_records WHERE id = $1 AND user_id = $2 AND is_active = true",
      [recordId, userId]
    );
    if (!owner.rowCount) {
      res.status(404).json({ error: "Registro no encontrado." });
      return;
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
    const values = fields.map((f) => updates[f] ?? null);
    values.push(recordId, userId);

    await pool.query(
      `UPDATE maintenance_records SET ${setClauses}, updated_at = NOW()
       WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}`,
      values
    );

    // Editar fecha/proximo_fecha/km puede cambiar cuál es el "último service" o
    // sus valores → rehacemos el espejo en trucks (mismo motivo que en DELETE).
    await resyncTruckServiceMirror(owner.rows[0].truck_id, userId);

    const updated = await pool.query<MaintenanceRow>(
      `${MAINT_BASE_SELECT} WHERE m.id = $1 AND m.user_id = $2`,
      [recordId, userId]
    );

    res.json(mapMaintenanceRow(updated.rows[0]));
  } catch (err) {
    console.error("Error en PATCH /api/maintenance/:id:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/maintenance/:id — Soft delete del registro
// ---------------------------------------------------------------------------
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const recordId = Number(req.params.id);

  if (!Number.isFinite(recordId)) {
    res.status(400).json({ error: "id de registro inválido." });
    return;
  }

  try {
    const result = await pool.query<{ truck_id: number }>(
      `UPDATE maintenance_records SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_active = true
       RETURNING truck_id`,
      [recordId, userId]
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Registro no encontrado." });
      return;
    }

    // El POST espeja fecha_service/proximo_service/km_actual en trucks. Al borrar
    // hay que rehacer ese espejo para que "Estado de la flota" no siga mostrando
    // el service eliminado.
    await resyncTruckServiceMirror(result.rows[0].truck_id, userId);

    res.status(204).send();
  } catch (err) {
    console.error("Error en DELETE /api/maintenance/:id:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/maintenance/run-alerts — Dispara el job de alertas push a demanda
// (para probar sin esperar la corrida diaria). No filtra por user_id: el job
// recorre todos los conductores con token. Requiere sesión + plan activo.
// ---------------------------------------------------------------------------
router.post("/run-alerts", async (_req: Request, res: Response) => {
  try {
    const result = await runMaintenanceAlerts();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Error en POST /api/maintenance/run-alerts:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

export default router;
