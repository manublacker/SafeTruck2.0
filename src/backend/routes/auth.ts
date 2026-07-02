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

  // Estas 3 operaciones son independientes entre sí, así que las corremos EN
  // PARALELO en vez de en serie: antes cada una era un round-trip a la base uno
  // atrás del otro (login lento); ahora el endpoint tarda ~lo de la más lenta.
  //
  //  1. Sync del usuario en public.users (FK requerida por trucks y drivers).
  //  2. Upsert silencioso en profiles (no sobreescribe plan ni otros campos).
  //  3. Lectura del plan: subscriptions (fuente de verdad) con fallback a profiles.
  const syncUser = pool
    .query(
      `INSERT INTO users (id, email, full_name, company, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET email     = EXCLUDED.email,
             full_name = COALESCE(EXCLUDED.full_name, users.full_name),
             company   = COALESCE(EXCLUDED.company,   users.company),
             role      = EXCLUDED.role`,
      [user.id, user.email, full_name, company, role]
    )
    .catch((err) => console.error("[auth/profile] Error sincronizando usuario:", err));

  const ensureProfile = Promise.resolve(
    supabase.from("profiles").upsert(
      { id: user.id, full_name: full_name ?? user.email },
      { onConflict: "id", ignoreDuplicates: true }
    )
  ).then(() => {}, () => { /* no bloqueante */ });

  const readPlan = (async (): Promise<string | null> => {
    try {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("plan, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sub?.plan) return sub.plan;

      const { data: profile } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", user.id)
        .maybeSingle();
      return profile?.plan ?? null;
    } catch {
      // silencioso — el frontend maneja plan null como "starter"
      return null;
    }
  })();

  const [, , plan] = await Promise.all([syncUser, ensureProfile, readPlan]);

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
