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
// se reduce a devolver los datos del token + plan de profiles.
router.post("/profile", authMiddleware, async (req: Request, res: Response) => {
  const user = req.user!;
  const meta = user.user_metadata ?? {};
  const token = req.headers.authorization!.slice(7);

  const full_name = (req.body?.full_name ?? meta["full_name"] ?? null) as string | null;
  const company = (req.body?.company ?? meta["company"] ?? null) as string | null;
  const role = (meta["role"] as string | undefined) ?? "admin";

  // Sincronizar usuario en Supabase public.users (FK requerida por trucks y drivers).
  try {
    await pool.query(
      `INSERT INTO users (id, email, full_name, company, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET email     = EXCLUDED.email,
             full_name = COALESCE(EXCLUDED.full_name, users.full_name),
             company   = COALESCE(EXCLUDED.company,   users.company),
             role      = EXCLUDED.role`,
      [user.id, user.email, full_name, company, role]
    );
  } catch (err) {
    console.error("[auth/profile] Error sincronizando usuario:", err);
  }

  // Garantizar que existe una fila en profiles para este usuario.
  // Upsert silencioso: si ya existe, no sobreescribe el plan ni otros campos.
  try {
    await supabase.from("profiles").upsert(
      { id: user.id, full_name: full_name ?? user.email },
      { onConflict: "id", ignoreDuplicates: true }
    );
  } catch { /* no bloqueante */ }

  // Leer el plan: primero desde subscriptions (fuente de verdad de billing),
  // luego fallback a profiles (usuarios mobile), luego null.
  let plan: string | null = null;
  try {
    const { data: sub } = await supabase
      .from("subscriptions")
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
        .from("profiles")
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
      role,
      trucks: [],
    },
  });
});

export default router;
