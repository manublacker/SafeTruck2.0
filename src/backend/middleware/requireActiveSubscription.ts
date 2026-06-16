import { Request, Response, NextFunction } from "express";
import { supabase } from "../supabaseClient";
import pool from "../db";

async function hasActiveSubscription(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return !!data;
}

// Los conductores no pagan: heredan el acceso de la suscripción del admin
// que los invitó (drivers.user_id -> el admin, drivers.app_user_id -> el conductor).
async function adminOf(driverUserId: string): Promise<string | null> {
  const result = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM drivers WHERE app_user_id = $1 AND is_active = true LIMIT 1",
    [driverUserId]
  );
  return result.rows[0]?.user_id ?? null;
}

export async function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user!.id;

  try {
    if (await hasActiveSubscription(userId)) {
      next();
      return;
    }

    const adminId = await adminOf(userId);
    if (adminId && (await hasActiveSubscription(adminId))) {
      next();
      return;
    }

    res.status(402).json({ error: "subscription_required" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
