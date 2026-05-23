import { Request, Response, NextFunction } from "express";
import { supabase } from "../supabaseClient";

export interface AuthPayload {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token requerido." });
    return;
  }

  const token = header.slice(7);

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "Token inválido o expirado." });
    return;
  }

  req.user = {
    id: user.id,
    email: user.email!,
    user_metadata: user.user_metadata ?? {},
  };

  next();
}
