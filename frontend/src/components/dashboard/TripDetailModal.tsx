import { useEffect } from "react";
import type { AssignedTrip } from "@/services/api";

// Factor de escala del modal: todas las medidas del diseño se multiplican por
// esto, así crece TODO proporcionalmente (subí/bajá este número para ajustar).
const S = 1.08;
const r = (n: number) => Math.round(n * S);

const STATUS_LABELS: Record<string, string> = {
  pending:     "Pendiente",
  accepted:    "Aceptado",
  in_progress: "En curso",
  completed:   "Completado",
  cancelled:   "Cancelado",
};

// Colores del badge de estado (mismo criterio que el diseño).
function statusColors(status: string): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "completed":   return { bg: "#dcfce7", fg: "#15803d", dot: "#16a34a" };
    case "in_progress": return { bg: "#dbeafe", fg: "#1d4ed8", dot: "#2563eb" };
    case "accepted":    return { bg: "#e0e7ff", fg: "#4338ca", dot: "#6366f1" };
    case "cancelled":   return { bg: "#fee2e2", fg: "#b91c1c", dot: "#dc2626" };
    default:            return { bg: "#fef3c7", fg: "#b45309", dot: "#d97706" }; // pending
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function distanceParts(m: number | null | undefined): { value: string; unit: string } {
  if (m == null) return { value: "—", unit: "" };
  if (m >= 1000) return { value: (m / 1000).toFixed(1), unit: "km" };
  return { value: String(Math.round(m)), unit: "m" };
}

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
  const sc   = statusColors(trip.status);
  const dist = distanceParts(trip.distance_m);
  const dur  = durationParts(trip);

  const times = [
    { label: "Agendado",   value: fmtDateTime(trip.scheduled_at), divider: true },
    { label: "Iniciado",   value: fmtDateTime(trip.started_at),   divider: true },
    { label: "Finalizado", value: fmtDateTime(trip.completed_at), divider: false },
    { label: "Creado",     value: fmtDateTime(trip.created_at),   divider: false },
  ];

  return (
    <div className="st-modal-backdrop" onClick={onClose}>
      <div
        className="st-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: r(720), padding: 0, border: "none", borderRadius: r(20), overflow: "hidden",
          background: "#fff",
          boxShadow: "0 24px 60px -16px rgba(24,24,27,.28), 0 4px 14px -6px rgba(24,24,27,.14)",
        }}
      >
        {/* Header */}
        <div style={{ padding: `${r(22)}px ${r(26)}px ${r(18)}px`, borderBottom: "1px solid #f1f1f3", display: "flex", alignItems: "center", justifyContent: "space-between", gap: r(16) }}>
          <div style={{ display: "flex", alignItems: "center", gap: r(14), flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: r(21), lineHeight: 1.1, fontWeight: 700, color: "#18181b", letterSpacing: "-.02em" }}>
              Detalle del viaje
            </h2>
            <div style={{ display: "flex", gap: r(8) }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: r(7), padding: `${r(4)}px ${r(11)}px ${r(4)}px ${r(10)}px`, borderRadius: 999, fontSize: r(12.5), fontWeight: 600, background: sc.bg, color: sc.fg }}>
                <span style={{ width: r(7), height: r(7), borderRadius: "50%", background: sc.dot }} />
                {STATUS_LABELS[trip.status] ?? trip.status}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", padding: `${r(4)}px ${r(11)}px`, borderRadius: 999, fontSize: r(12.5), fontWeight: 600, ...(isPersonal ? { background: "#eef2ff", color: "#4338ca" } : { background: "#f4f4f5", color: "#52525b" }) }}>
                {isPersonal ? "Personal" : "Empresa"}
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            style={{ flex: "none", width: r(32), height: r(32), display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "#f4f4f5", borderRadius: r(9), cursor: "pointer", color: "#52525b" }}
          >
            <svg width={r(15)} height={r(15)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: `${r(22)}px ${r(26)}px`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: `${r(22)}px ${r(28)}px` }}>

          {/* Ruta */}
          <section>
            <SectionLabel>Ruta</SectionLabel>
            <div style={{ display: "flex", gap: r(13) }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: r(5) }}>
                <span style={{ width: r(11), height: r(11), borderRadius: "50%", background: "#16a34a", boxShadow: "0 0 0 3px rgba(22,163,74,.14)" }} />
                <span style={{ flex: 1, width: 2, background: "#d4d4d8", margin: `${r(5)}px 0`, borderRadius: 2, minHeight: r(20) }} />
                <span style={{ width: r(11), height: r(11), borderRadius: "50%", background: "#dc2626", boxShadow: "0 0 0 3px rgba(220,38,38,.14)" }} />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: r(16), minWidth: 0 }}>
                <div>
                  <div style={{ fontSize: r(12), fontWeight: 600, color: "#a1a1aa", marginBottom: r(3) }}>Origen</div>
                  <div style={{ fontSize: r(14.5), fontWeight: 500, color: "#27272a", lineHeight: 1.4 }}>{trip.origin_label ?? "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: r(12), fontWeight: 600, color: "#a1a1aa", marginBottom: r(3) }}>Destino</div>
                  <div style={{ fontSize: r(14.5), fontWeight: 500, color: "#27272a", lineHeight: 1.4 }}>{trip.destination_label ?? "—"}</div>
                </div>
              </div>
            </div>
          </section>

          {/* Asignación y recorrido */}
          <section>
            <SectionLabel>Asignación y recorrido</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: r(10) }}>
              <Card label="Conductor" value={trip.driver_nombre ?? `Conductor #${trip.driver_id}`} />
              <Card label="Camión"    value={trip.truck_patente ?? "—"} mono />
              <Card label="Distancia" value={dist.value} unit={dist.unit} big />
              <Card label="Duración"  value={dur.value}  unit={dur.unit}  big />
            </div>
          </section>

          {/* Tiempos (a todo el ancho) */}
          <section style={{ gridColumn: "1 / -1" }}>
            <SectionLabel>Tiempos</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `0 ${r(32)}px` }}>
              {times.map((t) => (
                <div
                  key={t.label}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: r(12), padding: `${r(8)}px 0`, borderBottom: t.divider ? "1px solid #f1f1f3" : "none" }}
                >
                  <span style={{ fontSize: r(13.5), fontWeight: 500, color: "#71717a" }}>{t.label}</span>
                  <span style={{ fontSize: r(13.5), fontWeight: 600, color: "#27272a", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{t.value}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div style={{ padding: `${r(14)}px ${r(26)}px ${r(18)}px`, borderTop: "1px solid #f1f1f3", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: `${r(10)}px ${r(22)}px`, border: "none", borderRadius: r(11), background: "#18181b", color: "#fff", fontSize: r(14.5), fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponentes ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: r(11), fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#a1a1aa", marginBottom: r(13) }}>
      {children}
    </div>
  );
}

function Card({ label, value, unit, big, mono }: { label: string; value: string; unit?: string; big?: boolean; mono?: boolean }) {
  return (
    <div style={{ background: "#f7f7f8", border: "1px solid #efeff1", borderRadius: r(13), padding: `${r(11)}px ${r(14)}px`, minWidth: 0 }}>
      <div style={{ fontSize: r(11.5), fontWeight: 600, color: "#a1a1aa", marginBottom: r(4) }}>{label}</div>
      <div
        title={value}
        style={{ fontSize: big ? r(17) : r(15), fontWeight: big ? 700 : 600, color: "#18181b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: mono ? "tabular-nums" : undefined }}
      >
        {value}
        {unit ? <span style={{ fontSize: r(13), fontWeight: 600, color: "#71717a", marginLeft: r(4) }}>{unit}</span> : null}
      </div>
    </div>
  );
}
