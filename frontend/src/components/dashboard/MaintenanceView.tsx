import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/Toast";
import type { Truck } from "@/types/auth";
import {
  fetchMaintenance,
  fetchMaintenanceByTruck,
  fetchMaintenanceAlerts,
  createMaintenance,
  deleteMaintenance,
  SubscriptionRequiredError,
  type MaintenanceRecord,
  type MaintenanceAlerts,
  type MaintenanceTipo,
  type MaintenanceTruckAlert,
  type MaintenanceLicenseAlert,
} from "@/services/api";
import { reconcileById } from "@/lib/reconcile";
import type { AdminPage } from "./AdminSidebar";
import { Icons } from "./DashboardIcons";

const MILLIS_PER_DAY = 1000 * 60 * 60 * 24;
const SERVICE_WARN_DAYS = 30;

// Cache a nivel módulo (stale-while-revalidate). Al cambiar de pestaña este
// componente se DESMONTA (Dashboard usa montaje condicional); sin el cache,
// al volver arrancaría con "Cargando mantenimiento…" y re-pediría todo. Con el
// cache se ve al instante lo último conocido y el fetch de fondo lo reconcilia.
let cachedAlerts: MaintenanceAlerts | null = null;
let cachedRecords: MaintenanceRecord[] | null = null;

// Igualdad por los campos que muestra la vista. Permite conservar la referencia
// de un registro que no cambió al reconciliar (ver `reconcileById`).
function sameMaintenanceRecord(a: MaintenanceRecord, b: MaintenanceRecord): boolean {
  return (
    a.truck_id === b.truck_id &&
    a.tipo === b.tipo &&
    a.fecha === b.fecha &&
    a.km_al_service === b.km_al_service &&
    a.costo === b.costo &&
    a.taller === b.taller &&
    a.notas === b.notas &&
    a.proximo_km === b.proximo_km &&
    a.proximo_fecha === b.proximo_fecha &&
    a.created_at === b.created_at &&
    a.truck.name === b.truck.name &&
    a.truck.patente === b.truck.patente
  );
}

// ── Catálogo de tipos de mantenimiento ──────────────────────────────────────

const TIPOS: { value: MaintenanceTipo; label: string; emoji: string }[] = [
  { value: "service",    label: "Service",     emoji: "🔧" },
  { value: "reparacion", label: "Reparación",  emoji: "🛠️" },
  { value: "neumaticos", label: "Neumáticos",  emoji: "🛞" },
  { value: "vtv",        label: "VTV",         emoji: "📋" },
  { value: "seguro",     label: "Seguro",      emoji: "🛡️" },
  { value: "otro",       label: "Otro",        emoji: "📌" },
];

function tipoMeta(tipo: string) {
  return TIPOS.find((t) => t.value === tipo) ?? { value: "otro", label: tipo, emoji: "📌" };
}

// ── Helpers de fecha / formato ───────────────────────────────────────────────

function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const target = new Date(isoDate);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / MILLIS_PER_DAY);
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatKm(km: number | null): string {
  return km != null ? `${km.toLocaleString("es-AR")} km` : "—";
}

function formatCosto(costo: number | null): string {
  return costo != null ? `$${Number(costo).toLocaleString("es-AR")}` : "—";
}

/** Etiqueta relativa: "vencido hace 3d", "en 12d", "hoy". */
function relativeDays(days: number | null): string {
  if (days === null) return "sin fecha";
  if (days < 0) return `vencido hace ${Math.abs(days)}d`;
  if (days === 0) return "vence hoy";
  return `en ${days}d`;
}

/** Color según urgencia (vencido rojo, próximo ámbar, ok gris). */
function urgencyColor(days: number | null): string {
  if (days === null) return "#9ca3af";
  if (days < 0) return "#c62828";
  if (days <= SERVICE_WARN_DAYS) return "#f59e0b";
  return "#16a34a";
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function MaintenanceView({ onNavigate }: { onNavigate: (page: AdminPage) => void }) {
  const { showToast } = useToast();
  const { user, refreshTrucks } = useAuth();
  const trucks = user?.trucks ?? [];
  const [alerts, setAlerts]   = useState<MaintenanceAlerts | null>(cachedAlerts);
  const [records, setRecords] = useState<MaintenanceRecord[]>(cachedRecords ?? []);
  // Sólo bloqueamos con el spinner en la PRIMERA carga (sin cache). Al volver a
  // la pestaña ya hay datos cacheados → se muestran y se revalida en segundo plano.
  const [loading, setLoading] = useState(cachedRecords === null);
  const [error, setError]     = useState("");
  const [subscriptionError, setSubscriptionError] = useState(false);

  const [creating, setCreating]         = useState(false);
  const [presetTruck, setPresetTruck]   = useState<number | null>(null);
  const [historyTruck, setHistoryTruck] = useState<Truck | null>(null);

  const load = useCallback(async () => {
    setError("");
    setSubscriptionError(false);
    try {
      const [a, r] = await Promise.all([
        fetchMaintenanceAlerts(),
        fetchMaintenance(),
      ]);
      // Reconciliamos los registros contra el cache (conserva referencias de los
      // que no cambiaron); los alerts son un objeto agregado → se reemplaza.
      const mergedRecords = reconcileById(cachedRecords ?? [], r, sameMaintenanceRecord);
      cachedAlerts = a;
      cachedRecords = mergedRecords;
      setAlerts(a);
      setRecords(mergedRecords);
    } catch (err) {
      if (err instanceof SubscriptionRequiredError) setSubscriptionError(true);
      else setError(err instanceof Error ? err.message : "Error al cargar mantenimiento.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openCreate(truckId?: number) {
    setPresetTruck(truckId ?? null);
    setCreating(true);
  }

  function handleSaved() {
    setCreating(false);
    setPresetTruck(null);
    void load();
    // Crear un registro pisa fecha_service/proximo_service/km_actual en trucks
    // (ver POST /api/maintenance) → hay que refrescar el chunk del AuthContext.
    void refreshTrucks();
  }

  function exportCsv() {
    if (records.length === 0) {
      showToast("No hay registros de mantenimiento para exportar.", "error");
      return;
    }
    const headers = ["Camión", "Patente", "Tipo", "Fecha", "Km", "Costo", "Taller", "Próx. fecha", "Próx. km", "Notas"];
    const rows = records.map((m) => [
      m.truck.name ?? "",
      m.truck.patente ?? "",
      tipoMeta(m.tipo).label,
      m.fecha ?? "",
      m.km_al_service != null ? String(m.km_al_service) : "",
      m.costo != null ? String(m.costo) : "",
      m.taller ?? "",
      m.proximo_fecha ?? "",
      m.proximo_km != null ? String(m.proximo_km) : "",
      (m.notas ?? "").replace(/\r?\n/g, " "),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mantenimiento_safetruck.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (subscriptionError) {
    return (
      <div className="st-view-root" style={{ padding: 24, background: "#fff", height: "100%" }}>
        <SubscriptionBanner onGoToPlans={() => onNavigate("plans")} />
      </div>
    );
  }

  return (
    <div className="st-view-root" style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--c-ink)" }}>
          Mantenimiento y vencimientos
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="st-btn-ghost" onClick={exportCsv}>Exportar CSV</button>
          <button className="st-btn-primary" onClick={() => openCreate()}>
            <Icons.Plus size={14} /> Cargar mantenimiento
          </button>
        </div>
      </div>

      {loading && <Hint>Cargando mantenimiento…</Hint>}
      {error && <Hint tone="error">{error}</Hint>}

      {!loading && !error && alerts && (
        <>
          {/* Semáforo de alertas */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
            <StatCard label="Service vencido" value={alerts.trucks.vencidos.length} tone="danger" icon={<Icons.Alert size={18} />} />
            <StatCard label="Próximo a vencer" value={alerts.trucks.proximos.length} tone="warn" icon={<Icons.Clock size={18} />} />
            <StatCard label="Al día" value={alerts.trucks.al_dia.length} tone="ok" icon={<Icons.Wrench size={18} />} />
            <StatCard label="Licencias por vencer" value={alerts.licencias.vencidas.length + alerts.licencias.por_vencer.length} tone="warn" icon={<Icons.People size={18} />} />
          </div>

          {/* Gasto total en mantenimiento (suma el costo de todos los registros) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: 12, padding: "14px 18px", marginBottom: 24 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--c-ink-2)", fontWeight: 600 }}>Gasto total en mantenimiento</span>
            <span style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--c-ink)" }}>
              ${records.reduce((sum, m) => sum + (m.costo ?? 0), 0).toLocaleString("es-AR")}
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--c-ink-3)", marginLeft: 8 }}>
                · {records.length} registro{records.length === 1 ? "" : "s"}
              </span>
            </span>
          </div>

          {/* Camiones que requieren atención */}
          {(alerts.trucks.vencidos.length > 0 || alerts.trucks.proximos.length > 0) && (
            <Section title="Camiones que requieren atención">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {[...alerts.trucks.vencidos, ...alerts.trucks.proximos].map((t) => (
                  <TruckAlertCard key={t.id} truck={t} onLoad={() => openCreate(t.id)} />
                ))}
              </div>
            </Section>
          )}

          {/* Licencias por vencer */}
          {(alerts.licencias.vencidas.length > 0 || alerts.licencias.por_vencer.length > 0) && (
            <Section title="Licencias de conducir">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {[...alerts.licencias.vencidas, ...alerts.licencias.por_vencer].map((d) => (
                  <LicenseAlertCard key={d.id} driver={d} />
                ))}
              </div>
            </Section>
          )}

          {/* Tabla de camiones */}
          <Section title="Estado de la flota">
            {trucks.length === 0 ? (
              <EmptyState
                icon={<Icons.Truck size={26} />}
                title="No tenés camiones registrados"
                subtitle="Cargá camiones en la sección Flota para empezar a registrar su mantenimiento."
              />
            ) : (
              <TrucksMaintenanceTable
                trucks={trucks}
                recordsByTruck={recordCountByTruck(records)}
                onHistory={(t) => setHistoryTruck(t)}
                onLoad={(t) => openCreate(t.id)}
              />
            )}
          </Section>
        </>
      )}

      {creating && (
        <MaintenanceModal
          trucks={trucks}
          presetTruck={presetTruck}
          onSaved={handleSaved}
          onClose={() => { setCreating(false); setPresetTruck(null); }}
          onSubscriptionRequired={() => { setCreating(false); onNavigate("plans"); }}
        />
      )}

      {historyTruck && (
        <TruckHistoryPanel
          truck={historyTruck}
          onClose={() => setHistoryTruck(null)}
          onChanged={() => void load()}
          onAdd={() => { const id = historyTruck.id; setHistoryTruck(null); openCreate(id); }}
        />
      )}
    </div>
  );
}

// ── Contadores derivados ─────────────────────────────────────────────────────

function recordCountByTruck(records: MaintenanceRecord[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of records) map.set(r.truck_id, (map.get(r.truck_id) ?? 0) + 1);
  return map;
}

// ── Tarjeta de estadística (semáforo) ────────────────────────────────────────

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "danger" | "warn" | "ok";
  icon: React.ReactNode;
}) {
  const palette = {
    danger: { bg: "rgba(198,40,40,0.06)", border: "rgba(198,40,40,0.2)", fg: "#c62828" },
    warn:   { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", fg: "#b45309" },
    ok:     { bg: "rgba(22,163,74,0.07)",  border: "rgba(22,163,74,0.2)",  fg: "#16a34a" },
  }[tone];

  return (
    <div style={{ background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: "#fff", color: palette.fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: "1.6rem", fontWeight: 800, color: palette.fg, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: "0.8rem", color: "var(--c-ink-2)", fontWeight: 600, marginTop: 4 }}>{label}</div>
      </div>
    </div>
  );
}

// ── Tarjetas de alerta ───────────────────────────────────────────────────────

function TruckAlertCard({ truck, onLoad }: { truck: MaintenanceTruckAlert; onLoad: () => void }) {
  const color = urgencyColor(truck.days_left);
  return (
    <div style={{ border: `1px solid var(--c-border)`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 700, color: "var(--c-ink)", fontSize: "0.95rem" }}>{truck.name}</div>
        {truck.patente && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.78rem", color: "var(--c-ink-2)" }}>{truck.patente}</span>}
      </div>
      <div style={{ fontSize: "0.82rem", color: "var(--c-ink-2)" }}>
        Próx. service: <strong style={{ color }}>{formatDate(truck.proximo_service)}</strong>{" "}
        <span style={{ color, fontWeight: 700 }}>({relativeDays(truck.days_left)})</span>
      </div>
      <button className="st-btn-secondary" style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={onLoad}>
        <Icons.Wrench size={13} /> Registrar service
      </button>
    </div>
  );
}

function LicenseAlertCard({ driver }: { driver: MaintenanceLicenseAlert }) {
  const color = urgencyColor(driver.days_left);
  return (
    <div style={{ border: `1px solid var(--c-border)`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 700, color: "var(--c-ink)", fontSize: "0.95rem" }}>{driver.nombre}</div>
        {driver.categoria_licencia && <span style={{ fontSize: "0.78rem", color: "var(--c-ink-2)" }}>Cat. {driver.categoria_licencia}</span>}
      </div>
      <div style={{ fontSize: "0.82rem", color: "var(--c-ink-2)" }}>
        Licencia vence: <strong style={{ color }}>{formatDate(driver.vencimiento_licencia)}</strong>{" "}
        <span style={{ color, fontWeight: 700 }}>({relativeDays(driver.days_left)})</span>
      </div>
    </div>
  );
}

// ── Tabla de camiones ────────────────────────────────────────────────────────

function TrucksMaintenanceTable({
  trucks,
  recordsByTruck,
  onHistory,
  onLoad,
}: {
  trucks: Truck[];
  recordsByTruck: Map<number, number>;
  onHistory: (t: Truck) => void;
  onLoad: (t: Truck) => void;
}) {
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 720 }}>
          <thead>
            <tr style={{ background: "var(--c-surface-2)", textAlign: "left", color: "var(--c-ink-2)" }}>
              <Th>Camión</Th>
              <Th>Km actual</Th>
              <Th>Último service</Th>
              <Th>Próximo service</Th>
              <Th>Registros</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {trucks.map((t) => {
              const days = daysUntil(t.proximo_service);
              const color = urgencyColor(days);
              return (
                <tr key={t.id} style={{ borderTop: "1px solid var(--c-border)" }}>
                  <Td>
                    <div style={{ fontWeight: 700, color: "var(--c-ink)" }}>{t.name}</div>
                    {t.patente && <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.76rem", color: "var(--c-ink-3)" }}>{t.patente}</div>}
                  </Td>
                  <Td>{formatKm(t.km_actual)}</Td>
                  <Td>{formatDate(t.fecha_service)}</Td>
                  <Td>
                    <span style={{ color, fontWeight: t.proximo_service ? 700 : 400 }}>{formatDate(t.proximo_service)}</span>
                    {t.proximo_service && <span style={{ color, fontSize: "0.76rem", marginLeft: 6 }}>({relativeDays(days)})</span>}
                  </Td>
                  <Td>{recordsByTruck.get(t.id) ?? 0}</Td>
                  <Td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="st-btn-secondary" style={{ padding: "6px 10px" }} onClick={() => onHistory(t)}>Historial</button>
                      <button className="st-btn-secondary" style={{ padding: "6px 10px" }} onClick={() => onLoad(t)}>
                        <Icons.Plus size={12} />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "12px 14px", fontWeight: 700, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "12px 14px", color: "var(--c-ink)", verticalAlign: "middle" }}>{children}</td>;
}

// ── Panel deslizante: historial de un camión ─────────────────────────────────

function TruckHistoryPanel({
  truck,
  onClose,
  onChanged,
  onAdd,
}: {
  truck: Truck;
  onClose: () => void;
  onChanged: () => void;
  onAdd: () => void;
}) {
  const { showToast } = useToast();
  const [records, setRecords] = useState<MaintenanceRecord[] | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRecords(await fetchMaintenanceByTruck(truck.id));
    } catch {
      setRecords([]);
    }
  }, [truck.id]);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await deleteMaintenance(id);
      await load();
      onChanged();
    } catch (e: any) {
      showToast(e?.message ?? "Error al eliminar el registro", "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(15,27,45,0.35)", backdropFilter: "blur(2px)" }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", zIndex: 1, width: 420, maxWidth: "100%", height: "100%", background: "var(--c-bg)", boxShadow: "var(--sh-2)", display: "flex", flexDirection: "column", animation: "slideInRight 200ms ease" }}>
        <div style={{ borderBottom: "1px solid var(--c-border)", padding: "24px 24px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="st-section-label">Historial de mantenimiento</span>
            <button onClick={onClose} style={{ background: "var(--c-surface-2)", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: "var(--c-ink-2)" }}>✕</button>
          </div>
          <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--c-ink)" }}>{truck.name}</div>
          {truck.patente && <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem", color: "var(--c-ink-2)", marginTop: 4 }}>{truck.patente}</div>}
          <button className="st-btn-primary" style={{ marginTop: 14 }} onClick={onAdd}>
            <Icons.Plus size={13} /> Cargar mantenimiento
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {records === null && <Hint>Cargando historial…</Hint>}
          {records !== null && records.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--c-ink-3)", padding: "40px 0", fontSize: "0.9rem" }}>
              Todavía no hay registros de mantenimiento para este camión.
            </div>
          )}
          {records !== null && records.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {records.map((m) => {
                const meta = tipoMeta(m.tipo);
                return (
                  <div key={m.id} style={{ border: "1px solid var(--c-border)", borderRadius: 12, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, color: "var(--c-ink)" }}>{meta.emoji} {meta.label}</span>
                      <span style={{ fontSize: "0.8rem", color: "var(--c-ink-2)" }}>{formatDate(m.fecha)}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: "0.82rem", color: "var(--c-ink-2)" }}>
                      <span>Km: <strong style={{ color: "var(--c-ink)" }}>{formatKm(m.km_al_service)}</strong></span>
                      <span>Costo: <strong style={{ color: "var(--c-ink)" }}>{formatCosto(m.costo)}</strong></span>
                      {m.taller && <span style={{ gridColumn: "1 / -1" }}>Taller: <strong style={{ color: "var(--c-ink)" }}>{m.taller}</strong></span>}
                      {m.proximo_fecha && <span style={{ gridColumn: "1 / -1" }}>Próx.: <strong style={{ color: "var(--c-ink)" }}>{formatDate(m.proximo_fecha)}</strong></span>}
                    </div>
                    {m.notas && <div style={{ marginTop: 8, fontSize: "0.82rem", color: "var(--c-ink-2)", fontStyle: "italic" }}>{m.notas}</div>}
                    <button
                      className="st-btn-danger"
                      style={{ marginTop: 10, padding: "6px 12px", fontSize: "0.8rem" }}
                      disabled={deletingId === m.id}
                      onClick={() => handleDelete(m.id)}
                    >
                      {deletingId === m.id ? "Eliminando…" : "Eliminar"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}

// ── Modal: cargar mantenimiento ──────────────────────────────────────────────

function MaintenanceModal({
  trucks,
  presetTruck,
  onSaved,
  onClose,
  onSubscriptionRequired,
}: {
  trucks: Truck[];
  presetTruck: number | null;
  onSaved: () => void;
  onClose: () => void;
  onSubscriptionRequired: () => void;
}) {
  const { showToast } = useToast();
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [truckId, setTruckId]           = useState<number | "">(presetTruck ?? (trucks[0]?.id ?? ""));
  const [tipo, setTipo]                 = useState<MaintenanceTipo>("service");
  const [fecha, setFecha]               = useState(todayIso);
  const [km, setKm]                     = useState("");
  const [costo, setCosto]               = useState("");
  const [taller, setTaller]             = useState("");
  const [notas, setNotas]               = useState("");
  const [proximoFecha, setProximoFecha] = useState("");
  const [proximoKm, setProximoKm]       = useState("");
  const [saving, setSaving]             = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (truckId === "") { showToast("Seleccioná un camión.", "error"); return; }
    if (!fecha) { showToast("La fecha es requerida.", "error"); return; }

    setSaving(true);
    try {
      await createMaintenance({
        truck_id: Number(truckId),
        tipo,
        fecha,
        km_al_service: km ? Number(km) : null,
        costo: costo ? Number(costo) : null,
        taller: taller.trim() || null,
        notas: notas.trim() || null,
        proximo_fecha: proximoFecha || null,
        proximo_km: proximoKm ? Number(proximoKm) : null,
      });
      showToast("Mantenimiento registrado.", "success");
      onSaved();
    } catch (err) {
      if (err instanceof SubscriptionRequiredError) { onSubscriptionRequired(); return; }
      showToast(err instanceof Error ? err.message : "Error al guardar.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,27,45,0.45)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} style={{ background: "#fff", borderRadius: 16, padding: "26px 28px", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px -12px rgba(15,27,45,0.28)" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--c-ink)", marginBottom: 18 }}>Cargar mantenimiento</div>

        <Field label="Camión">
          <select value={truckId} onChange={(e) => setTruckId(e.target.value ? Number(e.target.value) : "")} style={inputStyle} required>
            <option value="" disabled>Seleccioná un camión…</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.patente ? ` · ${t.patente}` : ""}</option>
            ))}
          </select>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as MaintenanceTipo)} style={inputStyle}>
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
            </select>
          </Field>
          <Field label="Fecha">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={inputStyle} required />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Km al service">
            <input type="number" min="0" value={km} onChange={(e) => setKm(e.target.value)} style={inputStyle} placeholder="Ej: 120000" />
          </Field>
          <Field label="Costo ($)">
            <input type="number" min="0" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} style={inputStyle} placeholder="Ej: 85000" />
          </Field>
        </div>

        <Field label="Taller">
          <input value={taller} onChange={(e) => setTaller(e.target.value)} style={inputStyle} placeholder="Nombre del taller (opcional)" />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Próximo service (fecha)">
            <input type="date" value={proximoFecha} onChange={(e) => setProximoFecha(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Próximo service (km)">
            <input type="number" min="0" value={proximoKm} onChange={(e) => setProximoKm(e.target.value)} style={inputStyle} placeholder="Ej: 130000" />
          </Field>
        </div>

        <Field label="Notas">
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} placeholder="Detalle de la intervención (opcional)" />
        </Field>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button type="button" className="st-btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="st-btn-primary" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid var(--c-border)",
  borderRadius: 8,
  fontSize: "0.88rem",
  fontFamily: "inherit",
  color: "var(--c-ink)",
  background: "#fff",
  boxSizing: "border-box",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--c-ink-2)", marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}

// ── Subcomponentes presentacionales ──────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="st-section-label" style={{ marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function Hint({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "error" }) {
  const color = tone === "error" ? "#c62828" : "#6b7280";
  return <p style={{ color, fontSize: "0.88rem", margin: "12px 0" }}>{children}</p>;
}

function EmptyState({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 16, minHeight: 240, padding: "40px 32px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 6, background: "#fff" }}>
      {icon && <div style={{ width: 64, height: 64, borderRadius: 18, background: "var(--c-surface-2)", color: "var(--c-ink-3)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{icon}</div>}
      <p style={{ margin: 0, color: "var(--c-ink)", fontSize: "1.1rem", fontWeight: 700 }}>{title}</p>
      {subtitle && <p style={{ margin: 0, color: "var(--c-ink-3)", fontSize: "0.9rem", lineHeight: 1.55, maxWidth: 380 }}>{subtitle}</p>}
    </div>
  );
}

function SubscriptionBanner({ onGoToPlans }: { onGoToPlans: () => void }) {
  return (
    <div style={{ background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.2)", borderRadius: 12, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <p style={{ color: "#c62828", fontWeight: 700, fontSize: "0.9rem", margin: "0 0 4px" }}>Necesitás una suscripción activa</p>
        <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: 0 }}>Para usar el módulo de mantenimiento debés tener un plan activo.</p>
      </div>
      <button type="button" onClick={onGoToPlans} style={{ alignSelf: "flex-start", background: "#e53935", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>
        Ver planes y precios
      </button>
    </div>
  );
}
