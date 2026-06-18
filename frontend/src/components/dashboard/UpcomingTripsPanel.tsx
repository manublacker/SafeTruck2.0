import type { AssignedTrip } from "@/services/api";

// Misma semántica de estado que TripHistoryView (paleta de tokens en admin.css).
const STATUS_LABELS: Record<string, string> = {
  pending:     "Pendiente",
  accepted:    "Aceptado",
  in_progress: "En curso",
  completed:   "Completado",
  cancelled:   "Cancelado",
};

function badgeClass(status: string) {
  if (status === "in_progress") return "st-badge st-badge-encurso";
  if (status === "accepted")    return "st-badge st-badge-aceptado";
  if (status === "completed")   return "st-badge st-badge-completado";
  if (status === "cancelled")   return "st-badge st-badge-cancelado";
  return "st-badge st-badge-pendiente"; // pending
}

function formatHour(iso: string | null): string {
  if (!iso) return "Sin hora";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Sin hora";
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

interface Props {
  trips: AssignedTrip[];
  loading: boolean;
}

export default function UpcomingTripsPanel({ trips, loading }: Props) {
  const sorted = [...trips]
    .filter((t) => t.status !== "completed" && t.status !== "cancelled")
    .sort((a, b) => {
      if (!a.scheduled_at && !b.scheduled_at) return 0;
      if (!a.scheduled_at) return 1;
      if (!b.scheduled_at) return -1;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    })
    .slice(0, 10);

  return (
    <div>
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="st-skeleton" style={{ height: 72 }} />
          ))}
        </div>
      )}

      {!loading && sorted.length === 0 && (
        <div
          style={{
            border: "1px dashed var(--c-border)",
            borderRadius: "var(--r-md)",
            padding: "28px 20px",
            textAlign: "center",
            background: "var(--c-surface)",
          }}
        >
          <p style={{ margin: 0, color: "var(--c-ink-3)", fontSize: "0.88rem" }}>
            No hay viajes próximos
          </p>
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((trip) => {
            const isLive = trip.status === "in_progress";
            return (
              <div
                key={trip.id}
                className={`upcoming-card${isLive ? " live" : ""}`}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "stretch",
                  border: isLive ? "1px solid var(--c-success)" : "1px solid var(--c-border)",
                  borderLeft: isLive ? "4px solid var(--c-success)" : "1px solid var(--c-border)",
                  borderRadius: "var(--r-md)",
                  padding: "10px 12px",
                  background: isLive ? "var(--c-success-soft)" : "var(--c-bg)",
                  cursor: "default",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 3,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      {isLive && <span className="live-dot" />}
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "0.88rem",
                          color: "var(--c-ink)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {trip.driver_nombre ?? `Conductor #${trip.driver_id}`}
                      </span>
                    </div>
                    <span className={badgeClass(trip.status)} style={{ flexShrink: 0 }}>
                      {STATUS_LABELS[trip.status] ?? trip.status}
                    </span>
                  </div>

                  <p
                    style={{
                      margin: "0 0 3px",
                      fontSize: "0.8rem",
                      color: "var(--c-ink-2)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {trip.origin_label ?? "—"} → {trip.destination_label ?? "—"}
                  </p>

                  <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-ink-3)" }}>
                    {trip.scheduled_at
                      ? `${formatDate(trip.scheduled_at)} · ${formatHour(trip.scheduled_at)}`
                      : "Sin hora asignada"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
