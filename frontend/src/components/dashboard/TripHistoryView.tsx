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
  if (status === "accepted")    return "st-badge st-badge-aceptado";
  if (status === "completed")   return "st-badge st-badge-completado";
  if (status === "cancelled")   return "st-badge st-badge-cancelado";
  return "st-badge st-badge-pendiente"; // pending
}

// Origen del viaje: lo asignó la empresa o lo armó el propio conductor.
function tripSource(t: AssignedTrip): "company" | "personal" {
  return t.trip_source === "personal" ? "personal" : "company";
}
const SOURCE_LABELS: Record<"company" | "personal", string> = {
  company:  "Empresa",
  personal: "Personal",
};

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

/** Escapa un valor para CSV (separador ';', compatible con Excel en español). */
function csvEscape(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// ── Vista ──────────────────────────────────────────────────────────────────

interface Props {
  /** Estados que muestra esta vista (ej. finalizados, o pendientes/en curso). */
  statuses: AssignedTrip["status"][];
  emptyTitle: string;
  emptySubtitle: string;
}

export default function TripHistoryView({ statuses, emptyTitle, emptySubtitle }: Props) {
  const [trips, setTrips]     = useState<AssignedTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const [filterDriver, setFilterDriver] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
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

  const reset = () => { setFilterDriver(""); setFilterStatus(""); setFilterSource(""); setFrom(""); setTo(""); };

  // Exporta a CSV exactamente lo que está filtrado en pantalla.
  const exportCSV = () => {
    const headers = ["Origen", "Destino", "Conductor", "Camión", "Fecha", "Duración", "Tipo", "Estado"];
    const rows = filtered.map((t) => [
      t.origin_label ?? "",
      t.destination_label ?? "",
      t.driver_nombre ?? (t.driver_id ? `Conductor #${t.driver_id}` : ""),
      t.truck_patente ?? "",
      formatTripDate(t),
      formatDuration(t),
      SOURCE_LABELS[tripSource(t)],
      STATUS_LABELS[t.status] ?? t.status,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => csvEscape(String(c))).join(";"))
      .join("\r\n");
    // BOM (﻿) para que Excel respete los acentos.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `viajes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Conductores que aparecen en los viajes (para el select de filtro)
  const driverNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of trips) if (t.driver_nombre) names.add(t.driver_nombre);
    return [...names].sort((a, b) => a.localeCompare(b, "es"));
  }, [trips]);

  const filtered = useMemo(() =>
    trips.filter((t) => {
      if (!statuses.includes(t.status)) return false;
      if (filterDriver && t.driver_nombre !== filterDriver) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      if (filterSource && tripSource(t) !== filterSource) return false;

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
    [trips, statuses, filterDriver, filterStatus, filterSource, from, to]
  );

  return (
    <div style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      {/* Filtros */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 9, flexWrap: "wrap", marginBottom: 16, background: "#fff", border: "1px solid var(--c-border)", borderRadius: "var(--r-lg)", padding: 18 }}>
        <div style={{ minWidth: 175 }}>
          <label className="st-label" style={{ paddingLeft: 14 }}>Conductor</label>
          <select
            className={`st-select${!filterDriver ? " placeholder" : ""}`}
            value={filterDriver}
            onChange={(e) => setFilterDriver(e.target.value)}
          >
            <option value="">Todos los conductores</option>
            {driverNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 150 }}>
          <label className="st-label" style={{ paddingLeft: 14 }}>Estado</label>
          <select
            className={`st-select${!filterStatus ? " placeholder" : ""}`}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS)
              .filter(([value]) => statuses.includes(value as AssignedTrip["status"]))
              .map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
          </select>
        </div>
        <div style={{ minWidth: 160 }}>
          <label className="st-label" style={{ paddingLeft: 14 }}>Tipo</label>
          <select
            className={`st-select${!filterSource ? " placeholder" : ""}`}
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
          >
            <option value="">Todos los tipos</option>
            <option value="company">Empresa</option>
            <option value="personal">Personal</option>
          </select>
        </div>
        <div style={{ minWidth: 140 }}>
          <label className="st-label" style={{ paddingLeft: 14 }}>Desde</label>
          <input type="date" className="st-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div style={{ minWidth: 140 }}>
          <label className="st-label" style={{ paddingLeft: 14 }}>Hasta</label>
          <input type="date" className="st-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(filterDriver || filterStatus || filterSource || from || to) && (
          <button className="st-btn-ghost" onClick={reset}>
            Restablecer
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            className="st-btn-secondary"
            onClick={exportCSV}
            disabled={loading || filtered.length === 0}
            title={filtered.length === 0 ? "No hay viajes para exportar" : "Descargar CSV con los filtros aplicados"}
          >
            Exportar CSV
          </button>
          <button
            className="st-btn-secondary"
            style={{ minWidth: 134 }}
            onClick={() => void loadTrips()}
            disabled={loading}
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0" }}>
          <p style={{ margin: 0, color: "#c62828", fontSize: "0.88rem" }}>{error}</p>
          <button className="st-btn-secondary" onClick={() => void loadTrips()}>
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
              <th>Tipo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                    <span>{t.origin_label ?? "—"}</span>
                    <span style={{ color: "var(--c-ink-3)" }}><Icons.Arrow /></span>
                    <span>{t.destination_label ?? "—"}</span>
                  </div>
                </td>
                <td style={{ color: "#0d0d0d" }}>{t.driver_nombre ?? `Conductor #${t.driver_id}`}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{t.truck_patente ?? "—"}</td>
                <td style={{ color: "#6b7280" }}>{formatTripDate(t)}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{formatDuration(t)}</td>
                <td>
                  <span
                    className="st-badge"
                    style={
                      tripSource(t) === "personal"
                        ? { background: "#EEF2FF", color: "#4338CA" }
                        : { background: "var(--c-surface-2)", color: "var(--c-ink-2)" }
                    }
                  >
                    {SOURCE_LABELS[tripSource(t)]}
                  </span>
                </td>
                <td><span className={badgeClass(t.status)}>{STATUS_LABELS[t.status] ?? t.status}</span></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "center",
                      gap: 6,
                      padding: "56px 24px",
                    }}
                  >
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 16,
                        background: "var(--c-surface-2)",
                        color: "var(--c-ink-3)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 10,
                      }}
                    >
                      <Icons.Clock size={26} />
                    </div>
                    <p style={{ margin: 0, color: "var(--c-ink)", fontSize: "1.05rem", fontWeight: 700 }}>
                      {(filterDriver || filterStatus || filterSource || from || to) ? "Sin resultados" : emptyTitle}
                    </p>
                    <p style={{ margin: 0, color: "var(--c-ink-3)", fontSize: "0.9rem", lineHeight: 1.5, maxWidth: 360 }}>
                      {(filterDriver || filterStatus || filterSource || from || to)
                        ? "No hay viajes que coincidan con los filtros aplicados."
                        : emptySubtitle}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
