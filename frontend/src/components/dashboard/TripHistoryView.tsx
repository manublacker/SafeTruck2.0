import { useCallback, useEffect, useMemo, useState } from "react";
import { Icons } from "./DashboardIcons";
import { fetchAssignedTrips, deleteAssignedTrip, type AssignedTrip } from "@/services/api";
import TripDetailModal from "./TripDetailModal";
import ConfirmDialog from "./ConfirmDialog";
import { useToast } from "@/components/Toast";
import {
  STATUS_LABELS,
  SOURCE_LABELS,
  statusBadgeClass as badgeClass,
  tripSource,
  tripDate,
  formatDuration,
  csvEscape,
  sameAssignedTrip,
} from "@/lib/tripFormat";
import { reconcileById } from "@/lib/reconcile";

// Cache a nivel módulo (stale-while-revalidate), compartido por ambas instancias
// de esta vista (pendientes/en curso y finalizados): `fetchAssignedTrips` trae
// TODOS los viajes y cada instancia filtra por `statuses` en cliente. Al cambiar
// de pestaña el componente se DESMONTA (Dashboard usa montaje condicional); sin
// el cache, al volver arrancaría con skeleton y re-pediría toda la lista. Con el
// cache se ve al instante lo último y se revalida en segundo plano.
let cachedTrips: AssignedTrip[] | null = null;
let tripsInflight: Promise<AssignedTrip[]> | null = null;

// Carga (o prefetch) deduplicada de la lista de viajes. Llena el cache de módulo
// reconciliando contra lo previo. Si ya hay un pedido en vuelo lo reusa, para que
// el prefetch del Dashboard y el fetch de la vista al montar no se dupliquen.
// Exportada para que el Dashboard la dispare apenas entra el usuario.
export function prefetchTrips(): Promise<AssignedTrip[]> {
  if (tripsInflight) return tripsInflight;
  tripsInflight = fetchAssignedTrips()
    .then((data) => {
      cachedTrips = reconcileById(cachedTrips ?? [], data, sameAssignedTrip);
      return cachedTrips;
    })
    .finally(() => { tripsInflight = null; });
  return tripsInflight;
}

// ── Helpers de presentación ────────────────────────────────────────────────

/** Fecha del viaje formateada (es-AR). Usa `tripDate` del lib compartido. */
function formatTripDate(t: AssignedTrip): string {
  const d = tripDate(t);
  if (!d) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Vista ──────────────────────────────────────────────────────────────────

interface Props {
  /** Estados que muestra esta vista (ej. finalizados, o pendientes/en curso). */
  statuses: AssignedTrip["status"][];
  emptyTitle: string;
  emptySubtitle: string;
  /** Si se provee, el detalle del viaje muestra "Ver viaje" para abrirlo en el mapa. */
  onViewTrip?: (trip: AssignedTrip) => void;
  /** Muestra el filtro "Tipo" (Empresa/Personal). Default true. */
  showSourceFilter?: boolean;
  /** Permite eliminar viajes desde el detalle. Default false. */
  allowDelete?: boolean;
}

export default function TripHistoryView({ statuses, emptyTitle, emptySubtitle, onViewTrip, showSourceFilter = true, allowDelete = false }: Props) {
  const { showToast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState<AssignedTrip | null>(null);
  const [trips, setTrips]     = useState<AssignedTrip[]>(cachedTrips ?? []);
  // `loading` = primera carga (skeleton, sin cache); un refresco en segundo
  // plano (silent) no la activa.
  const [loading, setLoading] = useState(cachedTrips === null);
  const [error, setError]     = useState("");
  const [selected, setSelected] = useState<AssignedTrip | null>(null);

  const [filterDriver, setFilterDriver] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [from, setFrom] = useState("");
  const [to,   setTo]   = useState("");

  const loadTrips = useCallback(async (opts?: { silent?: boolean }) => {
    setError("");
    // Con cache mostramos lo que hay y revalidamos sin tapar la tabla; sin cache
    // (primera carga) sí mostramos el skeleton.
    if (cachedTrips === null) setLoading(true);
    try {
      // Reusa el prefetch en vuelo (si el Dashboard ya lo disparó) o pide ahora.
      // La reconciliación vive dentro de prefetchTrips.
      const data = await prefetchTrips();
      setTrips(data);
    } catch (err) {
      if (!opts?.silent) setError(err instanceof Error ? err.message : "Error al cargar el historial.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTrips(); }, [loadTrips]);

  // Refresco periódico en segundo plano: sin esto, un viaje que el conductor
  // inicia/completa seguía mostrándose con su estado viejo hasta refrescar a mano.
  useEffect(() => {
    const id = window.setInterval(() => { void loadTrips({ silent: true }); }, 30_000);
    return () => window.clearInterval(id);
  }, [loadTrips]);


  // Pide confirmación (modal lindo) antes de borrar.
  const handleDelete = (trip: AssignedTrip) => setConfirmDelete(trip);

  // Borra de verdad el viaje ya confirmado: lo saca de la lista y cierra el detalle.
  const doDelete = async () => {
    const trip = confirmDelete;
    if (!trip) return;
    setConfirmDelete(null);
    try {
      await deleteAssignedTrip(trip.id);
      setTrips((prev) => prev.filter((t) => t.id !== trip.id));
      // Reflejamos el borrado en el cache para que no reaparezca al remontar.
      if (cachedTrips) cachedTrips = cachedTrips.filter((t) => t.id !== trip.id);
      setSelected(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo eliminar el viaje.", "error");
    }
  };

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

  // Sangría chica y COMPARTIDA por el título y el contenido del campo, para que
  // el texto del label y el del desplegable/fecha arranquen en el mismo punto,
  // bien cerca del borde (ni el select corrido a la derecha, ni el label flotando).
  const flushPad = { paddingLeft: 6 };

  return (
    <div className="st-view-root" style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      {confirmDelete && (
        <ConfirmDialog
          title="¿Eliminar este viaje?"
          message={`${confirmDelete.origin_label ?? "—"} → ${confirmDelete.destination_label ?? "—"}\n\nEsta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          destructive
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {/* Filtros */}
      <div className="st-filters-bar" style={{ display: "flex", alignItems: "flex-end", gap: 9, flexWrap: "wrap", marginBottom: 16, background: "#fff", border: "1px solid var(--c-border)", borderRadius: "var(--r-lg)", padding: 18 }}>
        {/* En desktop este wrapper es transparente (display:contents); en mobile
            se vuelve una fila de chips con scroll horizontal. */}
        <div className="st-filters-scroll">
          <div className="st-filter" style={{ minWidth: 155 }}>
            <label className="st-label" style={flushPad}>Conductor</label>
            <select
              className={`st-select${!filterDriver ? " placeholder" : ""}`}
              style={flushPad}
              value={filterDriver}
              onChange={(e) => setFilterDriver(e.target.value)}
            >
              <option value="">Todos</option>
              {driverNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="st-filter" style={{ minWidth: 140 }}>
            <label className="st-label" style={flushPad}>Estado</label>
            <select
              className={`st-select${!filterStatus ? " placeholder" : ""}`}
              style={flushPad}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS)
                .filter(([value]) => statuses.includes(value as AssignedTrip["status"]))
                .map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
            </select>
          </div>
          {showSourceFilter && (
            <div className="st-filter" style={{ minWidth: 140 }}>
              <label className="st-label" style={flushPad}>Tipo</label>
              <select
                className={`st-select${!filterSource ? " placeholder" : ""}`}
                style={flushPad}
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="company">Empresa</option>
                <option value="personal">Personal</option>
              </select>
            </div>
          )}
          <div className="st-filter" style={{ minWidth: 140 }}>
            <label className="st-label" style={flushPad}>Desde</label>
            {/* "Desde" no puede ser posterior a "Hasta" (y viceversa abajo). */}
            <input type="date" className="st-input" style={flushPad} value={from} max={to || undefined} onChange={(e) => { const v = e.target.value; if (to && v && v > to) return; setFrom(v); }} />
          </div>
          <div className="st-filter" style={{ minWidth: 140 }}>
            <label className="st-label" style={flushPad}>Hasta</label>
            {/* "Hasta" no puede ser anterior a "Desde". */}
            <input type="date" className="st-input" style={flushPad} value={to} min={from || undefined} onChange={(e) => { const v = e.target.value; if (from && v && v < from) return; setTo(v); }} />
          </div>
        </div>
        <div className="st-filters-actions" style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            className="st-btn-secondary"
            onClick={exportCSV}
            disabled={loading || filtered.length === 0}
            title={filtered.length === 0 ? "No hay viajes para exportar" : "Descargar CSV con los filtros aplicados"}
          >
            Exportar CSV
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
        <>
        {/* Desktop: tabla ancha. Mobile (≤768px): tarjetas, más abajo. */}
        <table className="st-table hide-on-mobile">
          <thead>
            <tr>
              <th>Ruta</th>
              <th>Conductor</th>
              <th>Camión</th>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} onClick={() => setSelected(t)} style={{ cursor: "pointer" }} title="Ver detalle del viaje">
                <td>
                  <div style={{ maxWidth: 340 }}>
                    <div
                      title={t.origin_label ?? ""}
                      style={{ fontWeight: 600, color: "var(--c-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {t.origin_label ?? "—"}
                    </div>
                    <div
                      title={t.destination_label ?? ""}
                      style={{ color: "var(--c-ink-2)", fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      <span style={{ color: "var(--c-ink-3)" }}>→</span> {t.destination_label ?? "—"}
                    </div>
                  </div>
                </td>
                <td style={{ color: "#0d0d0d" }}>{t.driver_nombre ?? `Conductor #${t.driver_id}`}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", color: "#6b7280", whiteSpace: "nowrap" }}>{t.truck_patente ?? "—"}</td>
                <td style={{ color: "#6b7280", whiteSpace: "nowrap" }}>{formatTripDate(t)}</td>
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
                <td colSpan={6} style={{ padding: 0 }}>
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

        {/* Mobile: lista de tarjetas (mismos datos que la tabla, estilo del diseño). */}
        <div className="st-trip-cards">
          {filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              className="st-trip-card"
              onClick={() => setSelected(t)}
            >
              <div className="st-trip-card-route" title={t.origin_label ?? ""}>
                {t.origin_label ?? "—"}
              </div>
              <div className="st-trip-card-dest" title={t.destination_label ?? ""}>
                <span className="arrow">→</span> {t.destination_label ?? "—"}
              </div>
              <div className="st-trip-card-meta">
                <span>{t.driver_nombre ?? `Conductor #${t.driver_id}`}</span>
                <span className="st-trip-card-dot" />
                <span className="st-trip-card-plate">{t.truck_patente ?? "—"}</span>
                <span className="st-trip-card-dot" />
                <span>{formatTripDate(t)}</span>
              </div>
              <div className="st-trip-card-badges">
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
                <span className={badgeClass(t.status)}>{STATUS_LABELS[t.status] ?? t.status}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="st-trip-cards-empty">
              <div className="st-trip-cards-empty-icon">
                <Icons.Clock size={26} />
              </div>
              <p className="st-trip-cards-empty-title">
                {(filterDriver || filterStatus || filterSource || from || to) ? "Sin resultados" : emptyTitle}
              </p>
              <p className="st-trip-cards-empty-sub">
                {(filterDriver || filterStatus || filterSource || from || to)
                  ? "No hay viajes que coincidan con los filtros aplicados."
                  : emptySubtitle}
              </p>
            </div>
          )}
        </div>
        </>
      )}

      {selected && (
        <TripDetailModal trip={selected} onClose={() => setSelected(null)} onViewOnMap={onViewTrip} onDelete={allowDelete ? handleDelete : undefined} />
      )}
    </div>
  );
}
