import { useCallback, useEffect, useMemo, useState } from "react";
import { Icons } from "./DashboardIcons";
import { fetchAssignedTrips, type AssignedTrip } from "@/services/api";

// ── Estados: etiqueta y badge ──────────────────────────────────────────────

const STATUS_LABELS: Record<AssignedTrip["status"], string> = {
  pending:     "Pendiente",
  accepted:    "Aceptado",
  in_progress: "En curso",
  completed:   "Completado",
  cancelled:   "Cancelado",
};

function badgeClass(status: AssignedTrip["status"]) {
  if (status === "in_progress") return "st-badge st-badge-encurso";
  if (status === "completed")   return "st-badge st-badge-completado";
  if (status === "cancelled")   return "st-badge st-badge-cancelado";
  return "st-badge st-badge-inactivo"; // pending / accepted
}

// ── Helpers de presentación ────────────────────────────────────────────────

/** Fecha representativa del viaje: cuándo terminó, o empezó, o está agendado. */
function tripDate(t: AssignedTrip): Date | null {
  const iso = t.completed_at ?? t.started_at ?? t.scheduled_at ?? t.created_at;
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function formatTripDate(t: AssignedTrip): string {
  const d = tripDate(t);
  if (!d) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

/** Duración real (completed - started) si existe; si no, la estimada de la ruta. */
function formatDuration(t: AssignedTrip): string {
  let minutes: number | null = null;

  if (t.started_at && t.completed_at) {
    const start = new Date(t.started_at).getTime();
    const end   = new Date(t.completed_at).getTime();
    if (!isNaN(start) && !isNaN(end) && end > start) {
      minutes = Math.round((end - start) / 60000);
    }
  }
  if (minutes === null && t.duration_min != null) {
    minutes = Math.round(t.duration_min);
  }
  if (minutes === null) return "—";

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ── Vista ──────────────────────────────────────────────────────────────────

export default function TripHistoryView() {
  const [trips, setTrips]     = useState<AssignedTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const [filterDriver, setFilterDriver] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to,   setTo]   = useState("");

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAssignedTrips();
      setTrips(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar el historial.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTrips(); }, [loadTrips]);

  const reset = () => { setFilterDriver(""); setFilterStatus(""); setFrom(""); setTo(""); };

  // Conductores que aparecen en los viajes (para el select de filtro)
  const driverNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of trips) if (t.driver_nombre) names.add(t.driver_nombre);
    return [...names].sort((a, b) => a.localeCompare(b, "es"));
  }, [trips]);

  const filtered = useMemo(() =>
    trips.filter((t) => {
      if (filterDriver && t.driver_nombre !== filterDriver) return false;
      if (filterStatus && t.status !== filterStatus) return false;

      const d = tripDate(t);
      if (from) {
        const fromDate = new Date(`${from}T00:00:00`);
        if (!d || d < fromDate) return false;
      }
      if (to) {
        const toDate = new Date(`${to}T23:59:59`);
        if (!d || d > toDate) return false;
      }
      return true;
    }),
    [trips, filterDriver, filterStatus, from, to]
  );

  return (
    <div style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div className="st-section-eyebrow">Operaciones</div>
          <h2 className="st-section-title">Historial de viajes</h2>
        </div>
        <button
          className="st-btn-secondary"
          style={{ padding: "8px 14px", fontSize: "0.82rem" }}
          onClick={() => void loadTrips()}
          disabled={loading}
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ minWidth: 200 }}>
          <label className="st-label">Conductor</label>
          <select
            className={`st-select${!filterDriver ? " placeholder" : ""}`}
            value={filterDriver}
            onChange={(e) => setFilterDriver(e.target.value)}
          >
            <option value="">Todos los conductores</option>
            {driverNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 180 }}>
          <label className="st-label">Estado</label>
          <select
            className={`st-select${!filterStatus ? " placeholder" : ""}`}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 160 }}>
          <label className="st-label">Desde</label>
          <input type="date" className="st-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div style={{ minWidth: 160 }}>
          <label className="st-label">Hasta</label>
          <input type="date" className="st-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button
          onClick={reset}
          style={{
            background: "transparent", border: "none", color: "#e53935",
            fontSize: "0.82rem", fontWeight: 700, cursor: "pointer",
            padding: "14px 4px", fontFamily: "inherit",
          }}
        >
          Restablecer
        </button>
      </div>

      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0" }}>
          <p style={{ margin: 0, color: "#c62828", fontSize: "0.88rem" }}>{error}</p>
          <button
            className="st-btn-secondary"
            style={{ padding: "6px 12px", fontSize: "0.8rem" }}
            onClick={() => void loadTrips()}
          >
            Reintentar
          </button>
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="st-skeleton" style={{ height: 48 }} />
          ))}
        </div>
      )}

      {!loading && !error && (
        <table className="st-table">
          <thead>
            <tr>
              <th>Origen → Destino</th>
              <th>Conductor</th>
              <th>Camión</th>
              <th>Fecha</th>
              <th>Duración</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                    <span>{t.origin_label ?? "—"}</span>
                    <span style={{ color: "#e53935" }}><Icons.Arrow /></span>
                    <span>{t.destination_label ?? "—"}</span>
                  </div>
                </td>
                <td style={{ color: "#0d0d0d" }}>{t.driver_nombre ?? `Conductor #${t.driver_id}`}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{t.truck_patente ?? "—"}</td>
                <td style={{ color: "#6b7280" }}>{formatTripDate(t)}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{formatDuration(t)}</td>
                <td><span className={badgeClass(t.status)}>{STATUS_LABELS[t.status] ?? t.status}</span></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "#9ca3af", padding: 32 }}>
                  {trips.length === 0
                    ? "Todavía no hay viajes asignados. Crealos desde el Live Map."
                    : "No hay viajes que coincidan con los filtros."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
