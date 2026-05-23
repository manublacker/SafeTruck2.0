/*******************************************************
 * users.ts
 *
 * Endpoints relacionados al perfil del usuario.
 * Por ahora solo maneja el registro del push token
 * para notificaciones diferidas del sistema cooperativo.
 *******************************************************/

import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

// POST /api/users/push-token
// Guarda o actualiza el push token del dispositivo del usuario.
// Se llama cada vez que la app abre para tener el token actualizado.
router.post("/push-token", async (req: Request, res: Response) => {
  const { push_token } = req.body;

  if (!push_token) {
    res.status(400).json({ error: "push_token es requerido." });
    return;
  }

  if (!req.user?.id) {
    res.status(401).json({ error: "Token requerido." });
    return;
  }

  try {
    await pool.query(
      "UPDATE users SET push_token = $1 WHERE id = $2",
      [push_token, req.user.id]
    );

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error guardando push token:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

export default router;