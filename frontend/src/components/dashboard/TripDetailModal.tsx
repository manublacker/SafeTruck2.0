import { useEffect } from "react";
import type { AssignedTrip } from "@/services/api";
import { Icons } from "./DashboardIcons";

// Mismas etiquetas/estilos de estado y tipo que la tabla del historial.
const STATUS_LABELS: Record<string, string> = {
  pending:     "Pendiente",
  accepted:    "Aceptado",
  in_progress: "En curso",
  completed:   "Completado",
  cancelled:   "Cancelado",
};

function statusBadgeClass(status: string) {
  if (status === "in_progress") return "st-badge st-badge-encurso";
  if (status === "accepted")    return "st-badge st-badge-aceptado";
  if (status === "completed")   return "st-badge st-badge-completado";
  if (status === "cancelled")   return "st-badge st-badge-cancelado";
  return "st-badge st-badge-pendiente"; // pending
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDistance(m: number | null | undefined): string {
  if (m == null) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Duración real (finalizado - iniciado) si existe; si no, la estimada de la ruta. */
function fmtDuration(t: AssignedTrip): string {
  let minutes: number | null = null;
  if (t.started_at && t.completed_at) {
    const s = new Date(t.started_at).getTime();
    const e = new Date(t.completed_at).getTime();
    if (!isNaN(s) && !isNaN(e) && e > s) minutes = Math.round((e - s) / 60000);
  }
  if (minutes == null && t.duration_min != null) minutes = Math.round(t.duration_min);
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

interface Props {
  trip: AssignedTrip;
  onClose: () => void;
}

export default function TripDetailModal({ trip, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPersonal = trip.trip_source === "personal";

  return (
    <div className="st-modal-backdrop" onClick={onClose}>
      <div
        className="st-modal"
        style={{ maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado: título + badges de estado/tipo + cerrar */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#0d0d0d", margin: "0 0 10px" }}>
              Detalle del viaje
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <span className={statusBadgeClass(trip.status)}>
                {STATUS_LABELS[trip.status] ?? trip.status}
              </span>
              <span
                className="st-badge"
                style={isPersonal
                  ? { background: "#EEF2FF", color: "#4338CA" }
                  : { background: "var(--c-surface-2)", color: "var(--c-ink-2)" }}
              >
                {isPersonal ? "Personal" : "Empresa"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: "transparent", border: "none", cursor: "pointer", color: "#6b7280",
              width: 32, height: 32, borderRadius: 8,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Icons.Close />
          </button>
        </div>

        {/* Ruta: origen y destino completos */}
        <Section title="Ruta">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Endpoint color="var(--c-success)" label="Origen"  value={trip.origin_label} />
            <Endpoint color="var(--c-accent)"  label="Destino" value={trip.destination_label} />
          </div>
        </Section>

        <Section title="Asignación">
          <Row label="Conductor" value={trip.driver_nombre ?? `Conductor #${trip.driver_id}`} />
          <Row label="Camión"    value={trip.truck_patente ?? "—"} />
        </Section>

        <Section title="Recorrido">
          <Row label="Distancia" value={fmtDistance(trip.distance_m)} />
          <Row label="Duración"  value={fmtDuration(trip)} />
        </Section>

        <Section title="Tiempos">
          <Row label="Agendado"   value={fmtDateTime(trip.scheduled_at)} />
          <Row label="Iniciado"   value={fmtDateTime(trip.started_at)} />
          <Row label="Finalizado" value={fmtDateTime(trip.completed_at)} />
          <Row label="Creado"     value={fmtDateTime(trip.created_at)} />
        </Section>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="st-btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponentes ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.04em",
        textTransform: "uppercase", color: "var(--c-ink-3)", marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: "0.9rem" }}>
      <span style={{ color: "var(--c-ink-3)" }}>{label}</span>
      <span style={{ color: "var(--c-ink)", fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function Endpoint({ color, label, value }: { color: string; label: string; value: string | null }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, marginTop: 5, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "0.72rem", color: "var(--c-ink-3)", fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: "0.92rem", color: "var(--c-ink)", fontWeight: 500 }}>{value ?? "—"}</div>
      </div>
    </div>
  );
}
