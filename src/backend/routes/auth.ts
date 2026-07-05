import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { supabase } from "../supabaseClient";
import pool, { withTransaction } from "../db";

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

// POST /api/auth/independent-setup — Convierte la cuenta en camionero
// independiente ("empresa de uno"): crea la fila de drivers con
// user_id = app_user_id = el propio usuario. Con ese auto-vínculo el resto del
// sistema funciona sin cambios: los viajes personales encuentran su fila de
// drivers, la suscripción propia pasa el gate, la sala de WebSocket es la suya
// y el camión activo sale de truck_drivers como siempre.
// Idempotente: repetir la llamada reactiva el vínculo si estaba desactivado.
router.post("/independent-setup", authMiddleware, async (req: Request, res: Response) => {
  const user = req.user!;
  const meta = user.user_metadata ?? {};
  const fullName = ((req.body?.full_name ?? meta["full_name"]) as string | undefined)?.trim() || user.email;
  const telefono = ((req.body?.telefono as string | undefined) ?? null)?.trim() || null;

  try {
    // Si ya está vinculado a una empresa ajena, no puede volverse independiente
    // sin desvincularse antes (decisión explícita, no silenciosa).
    // Nota: en producción drivers.app_user_id es TEXT y user_id es UUID, así
    // que casteamos explícitamente; sin el cast Postgres no puede tipar $1
    // ("operator does not exist: uuid <> text").
    const companyLink = await pool.query(
      `SELECT id FROM drivers
       WHERE app_user_id::text = $1 AND user_id::text <> $1 AND is_active = true
       LIMIT 1`,
      [user.id]
    );
    if (companyLink.rowCount) {
      res.status(409).json({
        error: "Tu cuenta ya está vinculada a una empresa. Pedile al administrador que te desvincule para usar SafeTruck como independiente.",
      });
      return;
    }

    // FK: drivers.user_id referencia a users(id).
    await pool.query(
      `INSERT INTO users (id, email, full_name, role)
       VALUES ($1, $2, $3, 'independent')
       ON CONFLICT (id) DO UPDATE
         SET role      = 'independent',
             full_name = COALESCE(users.full_name, EXCLUDED.full_name)`,
      [user.id, user.email, fullName]
    );

    const driverId = await withTransaction(async (client) => {
      const existing = await client.query<{ id: number }>(
        "SELECT id FROM drivers WHERE user_id::text = $1 AND app_user_id::text = $1 LIMIT 1",
        [user.id]
      );
      if (existing.rowCount) {
        await client.query(
          `UPDATE drivers
           SET is_active = true, estado = 'Activo',
               telefono = COALESCE($2, telefono), updated_at = NOW()
           WHERE id = $1`,
          [existing.rows[0].id, telefono]
        );
        return existing.rows[0].id;
      }
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO drivers (user_id, nombre, telefono, estado, is_active, app_user_id)
         VALUES ($1::uuid, $2, $3, 'Activo', true, $1::text)
         RETURNING id`,
        [user.id, fullName, telefono]
      );
      return inserted.rows[0].id;
    });

    // Marcador explícito en profiles y user_metadata para que web y móvil
    // distingan la cuenta sin heurísticas. No bloqueante: el vínculo en drivers
    // ya quedó creado, que es lo que hace funcionar al resto del sistema.
    // profiles.role requiere la migración 004 en Supabase.
    // Update primero e insert solo si no había fila: un upsert pisaría el
    // full_name editado por el usuario, y un insert de {id, role} solo viola
    // el NOT NULL de full_name.
    const markProfile = async () => {
      const { data: updated, error: updErr } = await supabase
        .from("profiles")
        .update({ role: "independent" })
        .eq("id", user.id)
        .select("id");
      if (updErr) throw updErr;
      if (!updated?.length) {
        const { error: insErr } = await supabase
          .from("profiles")
          .insert({ id: user.id, full_name: fullName, email: user.email, role: "independent" });
        if (insErr) throw insErr;
      }
    };

    const [profileRes, metaRes] = await Promise.allSettled([
      markProfile(),
      supabase.auth.admin.updateUserById(user.id, {
        user_metadata: { ...meta, role: "independent" },
      }).then(({ error }) => { if (error) throw error; }),
    ]);
    if (profileRes.status === "rejected") {
      console.error("[auth/independent-setup] profiles.role no actualizado:", profileRes.reason?.message ?? profileRes.reason);
    }
    if (metaRes.status === "rejected") {
      console.error("[auth/independent-setup] user_metadata no actualizado:", metaRes.reason?.message ?? metaRes.reason);
    }

    res.status(201).json({ success: true, driver_id: driverId });
  } catch (err: any) {
    console.error("[auth/independent-setup]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
