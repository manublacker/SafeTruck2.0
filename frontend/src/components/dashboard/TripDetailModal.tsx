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

/** Distancia separada en número + unidad (para resaltar el número en la tarjeta). */
function distanceParts(m: number | null | undefined): { value: string; unit: string } {
  if (m == null) return { value: "—", unit: "" };
  if (m >= 1000) return { value: (m / 1000).toFixed(1), unit: "km" };
  return { value: String(Math.round(m)), unit: "m" };
}

/** Duración real (finalizado - iniciado) si existe; si no, la estimada de la ruta. */
function durationMinutes(t: AssignedTrip): number | null {
  if (t.started_at && t.completed_at) {
    const s = new Date(t.started_at).getTime();
    const e = new Date(t.completed_at).getTime();
    if (!isNaN(s) && !isNaN(e) && e > s) return Math.round((e - s) / 60000);
  }
  return t.duration_min != null ? Math.round(t.duration_min) : null;
}

function durationParts(t: AssignedTrip): { value: string; unit: string } {
  const minutes = durationMinutes(t);
  if (minutes == null) return { value: "—", unit: "" };
  if (minutes < 60)    return { value: String(minutes), unit: "min" };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? { value: String(h), unit: "h" } : { value: `${h} h ${m}`, unit: "min" };
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
  const dist = distanceParts(trip.distance_m);
  const dur  = durationParts(trip);

  return (
    <div className="st-modal-backdrop" onClick={onClose}>
      <div
        className="st-modal"
        style={{ maxWidth: 900, padding: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado: título + badges de estado/tipo + cerrar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#0d0d0d", margin: 0 }}>
              Detalle del viaje
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <span className={statusBadgeClass(trip.status)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
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
              background: "var(--c-surface-2)", border: "none", cursor: "pointer", color: "#6b7280",
              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Icons.Close />
          </button>
        </div>

        {/* Cuerpo en 2 columnas: Ruta (timeline) | Asignación y recorrido (tarjetas) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginBottom: 30 }}>
          <Section title="Ruta">
            <Timeline origin={trip.origin_label} destination={trip.destination_label} />
          </Section>

          <Section title="Asignación y recorrido">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Card label="Conductor" value={trip.driver_nombre ?? `Conductor #${trip.driver_id}`} />
              <Card label="Camión"    value={trip.truck_patente ?? "—"} />
              <Card label="Distancia" value={dist.value} unit={dist.unit} />
              <Card label="Duración"  value={dur.value}  unit={dur.unit} />
            </div>
          </Section>
        </div>

        {/* Tiempos: grilla de 2 columnas (Agendado/Iniciado · Finalizado/Creado) */}
        <div style={{ borderTop: "1px solid var(--c-border)", paddingTop: 26 }}>
          <Section title="Tiempos">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 48px" }}>
              <TimeRow label="Agendado"   value={fmtDateTime(trip.scheduled_at)} />
              <TimeRow label="Iniciado"   value={fmtDateTime(trip.started_at)} />
              <TimeRow label="Finalizado" value={fmtDateTime(trip.completed_at)} />
              <TimeRow label="Creado"     value={fmtDateTime(trip.created_at)} />
            </div>
          </Section>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 28 }}>
          <button
            type="button"
            className="st-btn-secondary"
            style={{ padding: "8px 20px", fontSize: "0.85rem" }}
            onClick={onClose}
          >
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
    <div>
      <div style={{
        fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.04em",
        textTransform: "uppercase", color: "var(--c-ink-3)", marginBottom: 14,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

/** Línea de tiempo origen → destino con puntos de color y línea de unión. */
function Timeline({ origin, destination }: { origin: string | null; destination: string | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch" }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--c-success)", flexShrink: 0, marginTop: 2 }} />
          <span style={{ flex: 1, width: 2, background: "var(--c-border)", marginTop: 5, marginBottom: 5, minHeight: 24 }} />
        </div>
        <div style={{ minWidth: 0, paddingBottom: 28 }}>
          <div style={{ fontSize: "0.78rem", color: "var(--c-ink-3)", fontWeight: 600, marginBottom: 3 }}>Origen</div>
          <div style={{ fontSize: "0.95rem", color: "var(--c-ink)", fontWeight: 600, lineHeight: 1.35 }}>{origin ?? "—"}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--c-accent)", flexShrink: 0, marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.78rem", color: "var(--c-ink-3)", fontWeight: 600, marginBottom: 3 }}>Destino</div>
          <div style={{ fontSize: "0.95rem", color: "var(--c-ink)", fontWeight: 600, lineHeight: 1.35 }}>{destination ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}

/** Tarjeta con etiqueta arriba y valor resaltado abajo (con unidad opcional). */
function Card({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{
      background: "var(--c-surface-2)", border: "1px solid var(--c-border)",
      borderRadius: 14, padding: "16px 18px", minWidth: 0,
    }}>
      <div style={{ fontSize: "0.78rem", color: "var(--c-ink-3)", marginBottom: 8 }}>{label}</div>
      <div
        title={value}
        style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--c-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {value}
        {unit ? <span style={{ fontSize: "0.82rem", fontWeight: 500, color: "var(--c-ink-2)", marginLeft: 4 }}>{unit}</span> : null}
      </div>
    </div>
  );
}

function TimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: "0.9rem" }}>
      <span style={{ color: "var(--c-ink-3)" }}>{label}</span>
      <span style={{ color: "var(--c-ink)", fontWeight: 500, textAlign: "right", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}
