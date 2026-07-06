import pool from "../db";

/**
 * Manda una push notification al conductor (identificado por su app_user_id de
 * Supabase) usando el Expo push token guardado en push_tokens.
 *
 * No bloqueante por diseño: si el conductor no tiene token registrado, no hace
 * nada y devuelve false. Devuelve true si había token e intentó el envío.
 *
 * Extraído desde routes/assigned-trips.ts para compartirlo con el job de alertas
 * de mantenimiento/licencia (jobs/maintenanceAlerts.ts).
 */
export async function sendExpoPush(
  driverAppUserId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<boolean> {
  const r = await pool.query<{ token: string }>(
    "SELECT token FROM push_tokens WHERE driver_app_user_id = $1",
    [driverAppUserId]
  );
  const token = r.rows[0]?.token;
  if (!token) return false;

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ to: token, title, body, data }),
  });
  return true;
}
