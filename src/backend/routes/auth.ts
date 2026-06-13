import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { supabase } from "../supabaseClient";
import pool from "../db";

const router = Router();

// GET /api/auth/me — Devuelve perfil del usuario autenticado (desde Supabase auth)
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  const user = req.user!;
  const meta = user.user_metadata ?? {};
  const token = req.headers.authorization!.slice(7);
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: meta["full_name"] ?? null,
      company: meta["company"] ?? null,
      trucks: [],
    },
  });
});

// POST /api/auth/profile — Devuelve el perfil del usuario.
// En el 2.0 el perfil vive en Supabase auth user_metadata, así que esto
// se reduce a devolver los datos del token + plan de st_profiles.
router.post("/profile", authMiddleware, async (req: Request, res: Response) => {
  const user = req.user!;
  const meta = user.user_metadata ?? {};
  const token = req.headers.authorization!.slice(7);

  const full_name = (req.body?.full_name ?? meta["full_name"] ?? null) as string | null;
  const company = (req.body?.company ?? meta["company"] ?? null) as string | null;

  // Sincronizar usuario en Aiven (FK requerida por trucks y drivers).
  // ON CONFLICT DO UPDATE para mantener email/nombre actualizados.
  try {
    await pool.query(
      `INSERT INTO users (id, email, full_name, company)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET email     = EXCLUDED.email,
             full_name = COALESCE(EXCLUDED.full_name, users.full_name),
             company   = COALESCE(EXCLUDED.company,   users.company)`,
      [user.id, user.email, full_name, company]
    );
  } catch (err) {
    // No bloqueante: si falla, el usuario igual puede operar.
    // El error más común aquí sería que la tabla no exista en Aiven.
    console.error("[auth/profile] Error sincronizando usuario en Aiven:", err);
  }

  // Leer el plan: primero desde st_subscriptions (fuente de verdad de billing),
  // luego fallback a st_profiles (usuarios mobile), luego null.
  let plan: string | null = null;
  try {
    const { data: sub } = await supabase
      .from("st_subscriptions")
      .select("plan, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub?.plan) {
      plan = sub.plan;
    } else {
      const { data: profile } = await supabase
        .from("st_profiles")
        .select("plan")
        .eq("id", user.id)
        .maybeSingle();
      plan = profile?.plan ?? null;
    }
  } catch {
    // silencioso — el frontend maneja plan null como "starter"
  }

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name,
      company,
      plan,
      trucks: [],
    },
  });
});

export default router;
