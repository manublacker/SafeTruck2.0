import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/authMiddleware";

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
// se reduce a devolver los datos del token.
router.post("/profile", authMiddleware, async (req: Request, res: Response) => {
  const user = req.user!;
  const meta = user.user_metadata ?? {};
  const token = req.headers.authorization!.slice(7);

  const full_name = (req.body?.full_name ?? meta["full_name"] ?? null) as string | null;
  const company = (req.body?.company ?? meta["company"] ?? null) as string | null;

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name,
      company,
      trucks: [],
    },
  });
});

export default router;
