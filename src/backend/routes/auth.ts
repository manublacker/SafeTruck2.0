import { Router, Request, Response } from "express";
import pool from "../db";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

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
}

async function getTrucksForUser(userId: string): Promise<TruckRow[]> {
  const result = await pool.query<TruckRow>(
    `SELECT id, name, max_weight_kg, max_height_m, max_width_m, max_length_m,
            patente, modelo, anio, km_actual, fecha_service, proximo_service,
            estado, created_at
     FROM trucks
     WHERE user_id = $1 AND is_active = true
     ORDER BY created_at ASC`,
    [userId]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// GET /api/auth/me — Devuelve perfil + camiones del usuario autenticado
// ---------------------------------------------------------------------------
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const result = await pool.query(
      "SELECT id, email, full_name, company, created_at FROM users WHERE id = $1",
      [userId]
    );

    if (!result.rowCount || result.rowCount === 0) {
      res.status(404).json({ error: "Perfil no encontrado." });
      return;
    }

    const trucks = await getTrucksForUser(userId);
    const token  = req.headers.authorization!.slice(7);

    res.json({ token, user: { ...result.rows[0], trucks } });
  } catch (err) {
    console.error("Error en /me:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/profile — Crea o devuelve el perfil del usuario.
// Llamado después del signup o del primer login.
// Si el perfil ya existe lo devuelve; si no, lo crea.
// ---------------------------------------------------------------------------
router.post("/profile", authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const email  = req.user!.email;
  const meta   = req.user!.user_metadata;

  const full_name = req.body.full_name ?? meta["full_name"] ?? null;
  const company   = req.body.company   ?? meta["company"]   ?? null;
  const trucks    = Array.isArray(req.body.trucks) ? req.body.trucks : [];

  const client = await pool.connect();
  try {
    const existing = await client.query(
      "SELECT id, email, full_name, company, created_at FROM users WHERE id = $1",
      [userId]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      const savedTrucks = await getTrucksForUser(userId);
      const token = req.headers.authorization!.slice(7);
      res.json({ token, user: { ...existing.rows[0], trucks: savedTrucks } });
      return;
    }

    if (!full_name) {
      res.status(400).json({ error: "full_name es requerido." });
      return;
    }

    await client.query("BEGIN");

    await client.query(
      `INSERT INTO users (id, email, full_name, company) VALUES ($1, $2, $3, $4)`,
      [userId, email, full_name, company ?? null]
    );

    for (const truck of trucks) {
      const { name, max_weight_kg, max_height_m, max_width_m, max_length_m } = truck;
      if (!name || max_weight_kg == null || max_height_m == null || max_width_m == null || max_length_m == null) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Datos de camión incompletos." });
        return;
      }
      await client.query(
        `INSERT INTO trucks (user_id, name, max_weight_kg, max_height_m, max_width_m, max_length_m)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, name, max_weight_kg, max_height_m, max_width_m, max_length_m]
      );
    }

    await client.query("COMMIT");

    const savedTrucks = await getTrucksForUser(userId);
    const token = req.headers.authorization!.slice(7);

    res.status(201).json({
      token,
      user: { id: userId, email, full_name, company: company ?? null, trucks: savedTrucks },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error en /profile:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  } finally {
    client.release();
  }
});

export default router;
