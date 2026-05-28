import type { AssignedTrip } from "@/services/api";

const STATUS_CFG: Record<string, { label: string; stripe: string; badgeBg: string; badgeFg: string }> = {
  pending:     { label: "Pendiente",  stripe: "#9ca3af", badgeBg: "#f3f4f6", badgeFg: "#6b7280" },
  accepted:    { label: "Aceptado",   stripe: "#2563eb", badgeBg: "#eff6ff", badgeFg: "#2563eb" },
  in_progress: { label: "En curso",   stripe: "#f59e0b", badgeBg: "#fffbeb", badgeFg: "#d97706" },
  completed:   { label: "Completado", stripe: "#22c55e", badgeBg: "#f0fdf4", badgeFg: "#16a34a" },
  cancelled:   { label: "Cancelado",  stripe: "#dc2626", badgeBg: "#fef2f2", badgeFg: "#dc2626" },
};

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
            border: "1px dashed #e0e0e0",
            borderRadius: 12,
            padding: "28px 20px",
            textAlign: "center",
            background: "#fafafa",
          }}
        >
          <p style={{ margin: 0, color: "#9ca3af", fontSize: "0.88rem" }}>
            No hay viajes próximos
          </p>
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((trip) => {
            const cfg = STATUS_CFG[trip.status] ?? STATUS_CFG.pending;
            const isLive = trip.status === "in_progress";
            return (
              <div
                key={trip.id}
                className="upcoming-card"
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "stretch",
                  border: "1px solid #f0f0f0",
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: "#fff",
                  cursor: "default",
                }}
              >
                <div
                  style={{
                    width: 3,
                    borderRadius: 999,
                    background: cfg.stripe,
                    flexShrink: 0,
                    alignSelf: "stretch",
                    minHeight: 40,
                  }}
                />
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
                          fontWeight: 700,
                          fontSize: "0.88rem",
                          color: "#0d0d0d",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {trip.driver_nombre ?? `Conductor #${trip.driver_id}`}
                      </span>
                    </div>
                    <span
                      className="st-tbadge"
                      style={{ background: cfg.badgeBg, color: cfg.badgeFg, flexShrink: 0 }}
                    >
                      {cfg.label}
                    </span>
                  </div>

                  <p
                    style={{
                      margin: "0 0 3px",
                      fontSize: "0.8rem",
                      color: "#6b7280",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {trip.origin_label ?? "—"} → {trip.destination_label ?? "—"}
                  </p>

                  <p style={{ margin: 0, fontSize: "0.75rem", color: "#9ca3af" }}>
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
