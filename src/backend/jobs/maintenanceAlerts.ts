/*******************************************************
 * jobs/maintenanceAlerts.ts
 *
 * Alertas proactivas push de mantenimiento y licencia. Corre a diario (lo agenda
 * server.ts) y también se puede disparar a mano vía POST /api/maintenance/run-alerts.
 *
 * A cada CONDUCTOR con push token le avisa sobre:
 *   - el vencimiento de SU licencia de conducir, y
 *   - el próximo service de SU camión asignado.
 *
 * Dedupe vía la tabla alert_notifications (UNIQUE por driver/kind/phase/fecha):
 * como mucho 2 pushes por vencimiento — 'warn' (≤30 días) y 'overdue' (vencido).
 *******************************************************/
import pool from "../db";
import { sendExpoPush } from "../lib/push";

/** Días de anticipación para avisar (igual que el semáforo del panel). */
const WARN_DAYS = 30;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

interface AlertRow {
  app_user_id: string;
  nombre: string;
  vencimiento_licencia: string | null; // 'YYYY-MM-DD' (to_char) o null
  lic_days: number | null;
  truck_name: string | null;
  patente: string | null;
  proximo_service: string | null;      // 'YYYY-MM-DD' (to_char) o null
  svc_days: number | null;
}

/** Formatea 'YYYY-MM-DD' → 'DD/mes' sin líos de timezone. */
function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, "0")}/${MESES[m - 1] ?? m}`;
}

/** 'overdue' si ya venció, 'warn' si está dentro de la ventana, null si falta. */
function phaseFor(days: number): "warn" | "overdue" | null {
  if (days < 0) return "overdue";
  if (days <= WARN_DAYS) return "warn";
  return null;
}

/**
 * Reclama el aviso en alert_notifications. Devuelve true si es NUEVO (no se había
 * avisado ese vencimiento/fase). El UNIQUE + ON CONFLICT DO NOTHING evita duplicar
 * aunque dos corridas se solapen.
 */
async function claimAlert(
  appUserId: string,
  kind: "license" | "service",
  phase: "warn" | "overdue",
  targetDate: string
): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO alert_notifications (driver_app_user_id, kind, phase, target_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (driver_app_user_id, kind, phase, target_date) DO NOTHING
     RETURNING id`,
    [appUserId, kind, phase, targetDate]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Revisa todos los conductores con push token y manda los avisos pendientes.
 * Devuelve un resumen para logs / el endpoint manual.
 */
export async function runMaintenanceAlerts(): Promise<{ sent: number; checked: number }> {
  const { rows } = await pool.query<AlertRow>(
    `SELECT d.app_user_id,
            d.nombre,
            to_char(d.vencimiento_licencia::date, 'YYYY-MM-DD') AS vencimiento_licencia,
            (d.vencimiento_licencia::date - CURRENT_DATE)       AS lic_days,
            t.name    AS truck_name,
            t.patente,
            to_char(t.proximo_service::date, 'YYYY-MM-DD')      AS proximo_service,
            (t.proximo_service::date - CURRENT_DATE)            AS svc_days
       FROM drivers d
       JOIN push_tokens pt   ON pt.driver_app_user_id = d.app_user_id
       LEFT JOIN truck_drivers td ON td.driver_id = d.id
       LEFT JOIN trucks t     ON t.id = td.truck_id AND t.is_active = true
      WHERE d.is_active = true AND d.app_user_id IS NOT NULL`
  );

  let sent = 0;

  for (const row of rows) {
    // ── Licencia del conductor ──────────────────────────────────────────────
    if (row.vencimiento_licencia && row.lic_days != null) {
      const phase = phaseFor(row.lic_days);
      if (phase && (await claimAlert(row.app_user_id, "license", phase, row.vencimiento_licencia))) {
        const title = phase === "overdue" ? "⚠️ Licencia vencida" : "📋 Tu licencia vence pronto";
        const body =
          phase === "overdue"
            ? `Tu licencia de conducir venció el ${fmtDate(row.vencimiento_licencia)}. Renovala cuanto antes.`
            : `Tu licencia vence el ${fmtDate(row.vencimiento_licencia)} (en ${row.lic_days} días). Renovala a tiempo.`;
        try {
          if (await sendExpoPush(row.app_user_id, title, body, { kind: "license" })) sent++;
        } catch (e: any) {
          console.error("[alerts] push licencia falló:", e?.message ?? e);
        }
      }
    }

    // ── Service del camión asignado ─────────────────────────────────────────
    if (row.proximo_service && row.svc_days != null && row.patente) {
      const phase = phaseFor(row.svc_days);
      if (phase && (await claimAlert(row.app_user_id, "service", phase, row.proximo_service))) {
        const title = phase === "overdue" ? "⚠️ Service vencido" : "🔧 Service próximo";
        const body =
          phase === "overdue"
            ? `El service de tu camión ${row.patente} venció el ${fmtDate(row.proximo_service)}.`
            : `El service de tu camión ${row.patente} vence el ${fmtDate(row.proximo_service)} (en ${row.svc_days} días).`;
        try {
          if (await sendExpoPush(row.app_user_id, title, body, { kind: "service" })) sent++;
        } catch (e: any) {
          console.error("[alerts] push service falló:", e?.message ?? e);
        }
      }
    }
  }

  return { sent, checked: rows.length };
}
