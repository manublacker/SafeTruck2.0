import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/Toast";
import type { Truck } from "@/types/auth";
import {
  fetchMaintenance,
  fetchMaintenanceByTruck,
  fetchMaintenanceAlerts,
  createMaintenance,
  updateMaintenance,
  deleteMaintenance,
  SubscriptionRequiredError,
  type MaintenanceRecord,
  type MaintenanceAlerts,
  type MaintenanceTipo,
  type MaintenanceLicenseAlert,
} from "@/services/api";
import { reconcileById } from "@/lib/reconcile";
import type { AdminPage } from "./AdminSidebar";
import { Icons } from "./DashboardIcons";
import ConfirmDialog from "./ConfirmDialog";

const MILLIS_PER_DAY = 1000 * 60 * 60 * 24;
const SERVICE_WARN_DAYS = 30;
/** Km restantes al próximo service para considerarlo "próximo a vencer". */
const KM_WARN = 2000;
/**
 * Horizonte máximo (≈10 años) para un `proximo_service`. Más allá lo tratamos
 * como dato basura (p. ej. año 4444 → "en 883082d") y lo ignoramos, así el
 * camión no aparece con una fecha absurda ni se clasifica por ella.
 */
const SERVICE_HORIZON_DAYS = 3660;
/** Intervalo sugerido para el próximo service al marcar uno como realizado. */
const SERVICE_INTERVAL_KM = 10000;
const SERVICE_INTERVAL_MONTHS = 6;

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

interface MaintenanceData { alerts: MaintenanceAlerts; records: MaintenanceRecord[] }
let maintInflight: Promise<MaintenanceData> | null = null;

// Carga (o prefetch) deduplicada de alertas + registros. Llena los caches de
// módulo (los registros se reconcilian; las alertas son un agregado y se
// reemplazan). Exportada para que el Dashboard la dispare al entrar el usuario.
export function prefetchMaintenance(): Promise<MaintenanceData> {
  if (maintInflight) return maintInflight;
  maintInflight = Promise.all([fetchMaintenanceAlerts(), fetchMaintenance()])
    .then(([a, r]) => {
      cachedAlerts = a;
      cachedRecords = reconcileById(cachedRecords ?? [], r, sameMaintenanceRecord);
      return { alerts: a, records: cachedRecords };
    })
    .finally(() => { maintInflight = null; });
  return maintInflight;
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

/** Coerción defensiva: Postgres devuelve `numeric` como string. */
function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

/** Color según urgencia por fecha (usado por licencias). */
function urgencyColor(days: number | null): string {
  if (days === null) return "#9ca3af";
  if (days < 0) return "#c62828";
  if (days <= SERVICE_WARN_DAYS) return "#f59e0b";
  return "#16a34a";
}

// ── Clasificación de estado de service (fecha + km) ──────────────────────────

type ServiceUrgency = "vencido" | "proximo" | "al_dia" | "sin_datos";

interface ServiceStatus {
  urgency: ServiceUrgency;
  /** Progreso 0..1+ del eje más urgente (>=1 = vencido). */
  progress: number;
  basis: "fecha" | "km" | null;
  daysLeft: number | null;
  kmLeft: number | null;
}

const URGENCY_META: Record<ServiceUrgency, { label: string; color: string; order: number }> = {
  vencido:   { label: "Vencido",   color: "#c62828", order: 0 },
  proximo:   { label: "Próximo",   color: "#f59e0b", order: 1 },
  al_dia:    { label: "Al día",    color: "#16a34a", order: 2 },
  sin_datos: { label: "Sin datos", color: "#9ca3af", order: 3 },
};

/**
 * Clasifica un camión combinando el eje FECHA (fecha_service → proximo_service)
 * y el eje KM (km_al_service → proximo_km del último registro, vs km_actual).
 * Se queda con el eje más cerca de vencer.
 */
function computeServiceStatus(truck: Truck, lastRecord?: MaintenanceRecord): ServiceStatus {
  // Eje fecha
  let dateProgress: number | null = null;
  let daysLeft = daysUntil(truck.proximo_service);
  // Fecha fuera del horizonte razonable = basura → la ignoramos.
  if (daysLeft != null && daysLeft > SERVICE_HORIZON_DAYS) daysLeft = null;
  if (truck.proximo_service && daysLeft != null) {
    const end = new Date(truck.proximo_service).getTime();
    const start = truck.fecha_service ? new Date(truck.fecha_service).getTime() : null;
    if (start != null && Number.isFinite(start) && end > start) {
      dateProgress = (Date.now() - start) / (end - start);
    } else {
      dateProgress = daysLeft <= 0 ? 1 : daysLeft <= SERVICE_WARN_DAYS ? 0.85 : 0.4;
    }
  }

  // Eje km
  let kmProgress: number | null = null;
  let kmLeft: number | null = null;
  const target = num(lastRecord?.proximo_km);
  const cur = num(truck.km_actual);
  const startKm = num(lastRecord?.km_al_service);
  if (target != null && cur != null) {
    kmLeft = target - cur;
    if (startKm != null && target > startKm) {
      kmProgress = (cur - startKm) / (target - startKm);
    } else {
      kmProgress = kmLeft <= 0 ? 1 : kmLeft <= KM_WARN ? 0.85 : 0.4;
    }
  }

  const axes: { p: number; basis: "fecha" | "km" }[] = [];
  if (dateProgress != null) axes.push({ p: dateProgress, basis: "fecha" });
  if (kmProgress != null) axes.push({ p: kmProgress, basis: "km" });

  if (axes.length === 0) {
    return { urgency: "sin_datos", progress: 0, basis: null, daysLeft, kmLeft };
  }
  const best = axes.reduce((a, b) => (b.p > a.p ? b : a));

  let urgency: ServiceUrgency;
  if (best.p >= 1) {
    urgency = "vencido";
  } else {
    const nearDate = daysLeft != null && daysLeft <= SERVICE_WARN_DAYS;
    const nearKm = kmLeft != null && kmLeft <= KM_WARN;
    urgency = nearDate || nearKm ? "proximo" : "al_dia";
  }
  return { urgency, progress: best.p, basis: best.basis, daysLeft, kmLeft };
}

/** Texto corto del eje que define la urgencia ("en 12d" / "faltan 1.500 km"). */
function progressLabel(status: ServiceStatus): string {
  if (status.basis === "km" && status.kmLeft != null) {
    return status.kmLeft <= 0
      ? `excedido ${formatKm(Math.abs(status.kmLeft))}`
      : `faltan ${formatKm(status.kmLeft)}`;
  }
  return relativeDays(status.daysLeft);
}

interface FleetRow {
  truck: Truck;
  status: ServiceStatus;
  recordCount: number;
}

/** Valores para precargar el modal de mantenimiento (ej. "marcar realizado"). */
interface MaintenancePrefill {
  tipo?: MaintenanceTipo;
  fecha?: string;
  km?: string;
  proximoFecha?: string;
  proximoKm?: string;
}

/** Prefill sugerido para un service recién realizado (hoy + km actual + próximo). */
function serviceDonePrefill(truck: Truck): MaintenancePrefill {
  const today = new Date();
  const next = new Date(today);
  next.setMonth(next.getMonth() + SERVICE_INTERVAL_MONTHS);
  const km = num(truck.km_actual);
  return {
    tipo: "service",
    fecha: today.toISOString().slice(0, 10),
    km: km != null ? String(km) : "",
    proximoKm: km != null ? String(km + SERVICE_INTERVAL_KM) : "",
    proximoFecha: next.toISOString().slice(0, 10),
  };
}

function byUrgency(a: FleetRow, b: FleetRow): number {
  return (
    URGENCY_META[a.status.urgency].order - URGENCY_META[b.status.urgency].order ||
    b.status.progress - a.status.progress
  );
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
  const [prefill, setPrefill]           = useState<MaintenancePrefill | null>(null);
  const [historyTruck, setHistoryTruck] = useState<Truck | null>(null);

  // Filtro por estado (se activa desde los KPIs).
  const [statusFilter, setStatusFilter] = useState<ServiceUrgency | null>(null);

  const licenciasRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError("");
    setSubscriptionError(false);
    try {
      // Reusa el prefetch en vuelo (si el Dashboard ya lo disparó) o pide ahora.
      const { alerts: a, records: r } = await prefetchMaintenance();
      setAlerts(a);
      setRecords(r);
    } catch (err) {
      if (err instanceof SubscriptionRequiredError) setSubscriptionError(true);
      else setError(err instanceof Error ? err.message : "Error al cargar mantenimiento.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Último registro (por fecha) de cada camión → base del eje km.
  const lastRecordByTruck = useMemo(() => {
    const map = new Map<number, MaintenanceRecord>();
    for (const r of records) {
      const prev = map.get(r.truck_id);
      if (!prev || (r.fecha ?? "") > (prev.fecha ?? "")) map.set(r.truck_id, r);
    }
    return map;
  }, [records]);

  const countByTruck = useMemo(() => recordCountByTruck(records), [records]);

  const fleet = useMemo<FleetRow[]>(
    () =>
      trucks.map((t) => ({
        truck: t,
        status: computeServiceStatus(t, lastRecordByTruck.get(t.id)),
        recordCount: countByTruck.get(t.id) ?? 0,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trucks, lastRecordByTruck, countByTruck],
  );

  const counts = useMemo(() => {
    const c: Record<ServiceUrgency, number> = { vencido: 0, proximo: 0, al_dia: 0, sin_datos: 0 };
    for (const f of fleet) c[f.status.urgency]++;
    return c;
  }, [fleet]);

  const sortedFleet = useMemo(
    () => fleet.filter(({ status }) => !statusFilter || status.urgency === statusFilter).sort(byUrgency),
    [fleet, statusFilter],
  );

  function openCreate(truckId?: number, pre?: MaintenancePrefill) {
    setPresetTruck(truckId ?? null);
    setPrefill(pre ?? null);
    setCreating(true);
  }

  function closeCreate() {
    setCreating(false);
    setPresetTruck(null);
    setPrefill(null);
  }

  /** Abre el modal precargado como "service recién realizado". */
  function markServiceDone(t: Truck) {
    openCreate(t.id, serviceDonePrefill(t));
  }

  function toggleFilter(u: ServiceUrgency) {
    setStatusFilter((prev) => (prev === u ? null : u));
  }

  function handleSaved() {
    setCreating(false);
    setPresetTruck(null);
    setPrefill(null);
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

  const licenciasCount =
    (alerts?.licencias.vencidas.length ?? 0) + (alerts?.licencias.por_vencer.length ?? 0);
  const gastoTotal = records.reduce((sum, m) => sum + (num(m.costo) ?? 0), 0);

  return (
    <div className="st-view-root" style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--c-ink)" }}>
          Mantenimiento y vencimientos
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="st-btn-secondary" onClick={exportCsv}>Exportar CSV</button>
          <button className="st-btn-primary" onClick={() => openCreate()}>
            <Icons.Plus size={14} /> Cargar mantenimiento
          </button>
        </div>
      </div>

      {loading && <Hint>Cargando mantenimiento…</Hint>}
      {error && <Hint tone="error">{error}</Hint>}

      {!loading && !error && alerts && (
        <>
          {/* KPIs clickeables (filtran la lista) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
            <KpiFilterCard label="Service vencido" value={counts.vencido} tone="danger" icon={<Icons.Alert size={18} />} active={statusFilter === "vencido"} onClick={() => toggleFilter("vencido")} />
            <KpiFilterCard label="Próximo a vencer" value={counts.proximo} tone="warn" icon={<Icons.Clock size={18} />} active={statusFilter === "proximo"} onClick={() => toggleFilter("proximo")} />
            <KpiFilterCard label="Al día" value={counts.al_dia} tone="ok" icon={<Icons.Wrench size={18} />} active={statusFilter === "al_dia"} onClick={() => toggleFilter("al_dia")} />
            <KpiFilterCard label="Licencias por vencer" value={licenciasCount} tone="warn" icon={<Icons.People size={18} />} onClick={() => licenciasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />
          </div>

          {/* Gasto total en mantenimiento (suma el costo de todos los registros) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: 12, padding: "14px 18px", marginBottom: 24 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--c-ink-2)", fontWeight: 600 }}>Gasto total en mantenimiento</span>
            <span style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--c-ink)" }}>
              ${gastoTotal.toLocaleString("es-AR")}
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--c-ink-3)", marginLeft: 8 }}>
                · {records.length} registro{records.length === 1 ? "" : "s"}
              </span>
            </span>
          </div>

          {/* Licencias por vencer */}
          {(alerts.licencias.vencidas.length > 0 || alerts.licencias.por_vencer.length > 0) && (
            <div ref={licenciasRef}>
              <Section title="Licencias de conducir">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                  {[...alerts.licencias.vencidas, ...alerts.licencias.por_vencer].map((d) => (
                    <LicenseAlertCard key={d.id} driver={d} />
                  ))}
                </div>
              </Section>
            </div>
          )}

          {/* Estado de la flota */}
          <Section title="Estado de la flota">
            {trucks.length === 0 ? (
              <EmptyState
                icon={<Icons.Truck size={26} />}
                title="No tenés camiones registrados"
                subtitle="Cargá camiones en la sección Flota para empezar a registrar su mantenimiento."
              />
            ) : sortedFleet.length === 0 ? (
              <Hint>Ningún camión coincide con el filtro seleccionado.</Hint>
            ) : (
              <TrucksMaintenanceTable
                rows={sortedFleet}
                onHistory={(t) => setHistoryTruck(t)}
                onLoad={(t) => openCreate(t.id)}
                onMarkDone={(t) => markServiceDone(t)}
              />
            )}
          </Section>
        </>
      )}

      {creating && (
        <MaintenanceModal
          trucks={trucks}
          presetTruck={presetTruck}
          prefill={prefill ?? undefined}
          onSaved={handleSaved}
          onClose={closeCreate}
          onSubscriptionRequired={() => { closeCreate(); onNavigate("plans"); }}
        />
      )}

      {historyTruck && (
        <TruckHistoryPanel
          truck={historyTruck}
          initialRecords={records.filter((r) => r.truck_id === historyTruck.id)}
          onClose={() => setHistoryTruck(null)}
          onChanged={() => { void load(); void refreshTrucks(); }}
          onAdd={() => { const id = historyTruck.id; setHistoryTruck(null); openCreate(id); }}
          onMarkDone={() => { const t = historyTruck; setHistoryTruck(null); markServiceDone(t); }}
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

// ── KPI clickeable ───────────────────────────────────────────────────────────

function KpiFilterCard({
  label,
  value,
  tone,
  icon,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  tone: "danger" | "warn" | "ok";
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  const palette = {
    danger: { bg: "rgba(198,40,40,0.06)", border: "rgba(198,40,40,0.2)", fg: "#c62828" },
    warn:   { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", fg: "#b45309" },
    ok:     { bg: "rgba(22,163,74,0.07)",  border: "rgba(22,163,74,0.2)",  fg: "#16a34a" },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: palette.bg,
        border: `1.5px solid ${active ? palette.fg : palette.border}`,
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        transition: "border-color 120ms ease, box-shadow 120ms ease",
        boxShadow: active ? `0 0 0 3px ${palette.bg}` : "none",
      }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 12, background: "#fff", color: palette.fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "1.6rem", fontWeight: 800, color: palette.fg, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: "0.8rem", color: "var(--c-ink-2)", fontWeight: 600, marginTop: 4 }}>
          {label}{active ? " · filtrando" : ""}
        </div>
      </div>
    </button>
  );
}

// ── Badge + barra de progreso ────────────────────────────────────────────────

function StatusBadge({ urgency }: { urgency: ServiceUrgency }) {
  const meta = URGENCY_META[urgency];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.72rem", fontWeight: 700, color: meta.color, background: `${meta.color}14`, border: `1px solid ${meta.color}33`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap", height: "fit-content" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} />
      {meta.label}
    </span>
  );
}

function ServiceProgressBar({ status, height = 8 }: { status: ServiceStatus; height?: number }) {
  if (status.urgency === "sin_datos") {
    return <div style={{ fontSize: "0.78rem", color: "var(--c-ink-3)" }}>Sin datos de próximo service</div>;
  }
  const meta = URGENCY_META[status.urgency];
  const pct = Math.max(0, Math.min(1, status.progress)) * 100;
  const over = status.progress > 1;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", marginBottom: 5 }}>
        <span style={{ color: "var(--c-ink-2)" }}>{progressLabel(status)}</span>
        <span style={{ color: meta.color, fontWeight: 700 }}>{Math.round(status.progress * 100)}%</span>
      </div>
      <div style={{ height, borderRadius: 99, background: "var(--c-surface-2)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: meta.color,
            borderRadius: 99,
            backgroundImage: over
              ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.3) 0 6px, transparent 6px 12px)"
              : undefined,
          }}
        />
      </div>
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

// ── Tabla: resto de la flota ─────────────────────────────────────────────────

function TrucksMaintenanceTable({
  rows,
  onHistory,
  onLoad,
  onMarkDone,
}: {
  rows: FleetRow[];
  onHistory: (t: Truck) => void;
  onLoad: (t: Truck) => void;
  onMarkDone: (t: Truck) => void;
}) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 720 }}>
          <thead>
            <tr style={{ background: "var(--c-surface-2)", textAlign: "left", color: "var(--c-ink-2)" }}>
              <Th>Estado</Th>
              <Th>Camión</Th>
              <Th>Km actual</Th>
              <Th>Próximo service</Th>
              <Th>Services</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ truck: t, status, recordCount }) => {
              const isHovered = hoveredId === t.id;
              const sinDatos = status.urgency === "sin_datos";
              return (
                <tr
                  key={t.id}
                  onClick={() => onHistory(t)}
                  onMouseEnter={() => setHoveredId(t.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  title="Ver historial de mantenimiento"
                  style={{
                    borderTop: "1px solid var(--c-border)",
                    cursor: "pointer",
                    background: isHovered ? "var(--c-surface-2)" : "transparent",
                    transition: "background 120ms ease",
                  }}
                >
                  <Td><StatusBadge urgency={status.urgency} /></Td>
                  <Td>
                    <div style={{ fontWeight: 700, color: "var(--c-ink)" }}>{t.name}</div>
                    {t.patente && <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.76rem", color: "var(--c-ink-3)" }}>{t.patente}</div>}
                  </Td>
                  <Td>{formatKm(t.km_actual)}</Td>
                  <Td>
                    <div style={{ minWidth: 150 }}>
                      <ServiceProgressBar status={status} height={6} />
                    </div>
                  </Td>
                  <Td>{recordCount}</Td>
                  <Td>
                    {sinDatos ? (
                      <button
                        className="st-btn-secondary"
                        style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
                        onClick={(e) => { e.stopPropagation(); onLoad(t); }}
                      >
                        Cargar datos
                      </button>
                    ) : (
                      <button
                        className="st-btn-secondary"
                        title="Marcar service realizado"
                        style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
                        onClick={(e) => { e.stopPropagation(); onMarkDone(t); }}
                      >
                        ✓ Service
                      </button>
                    )}
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

/** Intervalo respecto al service anterior del mismo tipo ("+15.000 km · +6 meses"). */
function serviceInterval(current: MaintenanceRecord, previous?: MaintenanceRecord): string | null {
  if (!previous) return null;
  const parts: string[] = [];
  const curKm = num(current.km_al_service);
  const prevKm = num(previous.km_al_service);
  if (curKm != null && prevKm != null && curKm > prevKm) {
    parts.push(`+${(curKm - prevKm).toLocaleString("es-AR")} km`);
  }
  const d1 = current.fecha ? new Date(current.fecha).getTime() : NaN;
  const d0 = previous.fecha ? new Date(previous.fecha).getTime() : NaN;
  if (Number.isFinite(d1) && Number.isFinite(d0) && d1 > d0) {
    const days = Math.round((d1 - d0) / MILLIS_PER_DAY);
    parts.push(days >= 60 ? `+${Math.round(days / 30)} meses` : `+${days} días`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function TruckHistoryPanel({
  truck,
  initialRecords,
  onClose,
  onChanged,
  onAdd,
  onMarkDone,
}: {
  truck: Truck;
  initialRecords: MaintenanceRecord[];
  onClose: () => void;
  onChanged: () => void;
  onAdd: () => void;
  onMarkDone: () => void;
}) {
  const { showToast } = useToast();
  // Arrancamos con los registros ya cacheados en la vista (filtrados por camión)
  // para mostrarlos al instante; el fetch por camión revalida en segundo plano.
  const [records, setRecords] = useState<MaintenanceRecord[] | null>(initialRecords);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [editRecord, setEditRecord] = useState<MaintenanceRecord | null>(null);

  const load = useCallback(async () => {
    try {
      setRecords(await fetchMaintenanceByTruck(truck.id));
    } catch {
      // Si falla la revalidación, conservamos lo que ya se mostraba.
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

  // Orden descendente por fecha para mostrar y para calcular intervalos.
  const sorted = useMemo(
    () => (records ? [...records].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "")) : null),
    [records],
  );

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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <button className="st-btn-primary" onClick={onMarkDone}>✓ Marcar service realizado</button>
            <button className="st-btn-secondary" onClick={onAdd}>
              <Icons.Plus size={13} /> Cargar otro
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {sorted === null && <Hint>Cargando historial…</Hint>}
          {sorted !== null && sorted.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--c-ink-3)", padding: "40px 0", fontSize: "0.9rem" }}>
              Todavía no hay registros de mantenimiento para este camión.
            </div>
          )}
          {sorted !== null && sorted.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sorted.map((m, i) => {
                const meta = tipoMeta(m.tipo);
                const prevSameTipo = sorted.slice(i + 1).find((r) => r.tipo === m.tipo);
                const interval = serviceInterval(m, prevSameTipo);
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
                    {interval && (
                      <div style={{ marginTop: 8, fontSize: "0.78rem", color: "var(--c-ink-3)" }}>
                        Intervalo desde el anterior: <strong style={{ color: "var(--c-ink-2)" }}>{interval}</strong>
                      </div>
                    )}
                    {m.notas && <div style={{ marginTop: 8, fontSize: "0.82rem", color: "var(--c-ink-2)", fontStyle: "italic" }}>{m.notas}</div>}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        className="st-btn-secondary"
                        style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                        onClick={() => setEditRecord(m)}
                      >
                        Editar
                      </button>
                      <button
                        className="st-btn-danger"
                        style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                        disabled={deletingId === m.id}
                        onClick={() => setConfirmId(m.id)}
                      >
                        {deletingId === m.id ? "Eliminando…" : "Eliminar"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>

      {editRecord && (
        <MaintenanceModal
          trucks={[truck]}
          presetTruck={truck.id}
          editRecord={editRecord}
          onSaved={() => { setEditRecord(null); void load(); onChanged(); }}
          onClose={() => setEditRecord(null)}
          onSubscriptionRequired={() => setEditRecord(null)}
        />
      )}

      {confirmId !== null && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            title="Eliminar registro"
            message="Se eliminará permanentemente este registro de mantenimiento (costo, taller y notas). Esta acción no se puede deshacer."
            confirmLabel="Eliminar"
            destructive
            onConfirm={() => { const id = confirmId; setConfirmId(null); void handleDelete(id); }}
            onCancel={() => setConfirmId(null)}
          />
        </div>
      )}
    </div>
  );
}

// ── Modal: cargar / editar mantenimiento ─────────────────────────────────────

function MaintenanceModal({
  trucks,
  presetTruck,
  editRecord,
  prefill,
  onSaved,
  onClose,
  onSubscriptionRequired,
}: {
  trucks: Truck[];
  presetTruck: number | null;
  editRecord?: MaintenanceRecord;
  prefill?: MaintenancePrefill;
  onSaved: () => void;
  onClose: () => void;
  onSubscriptionRequired: () => void;
}) {
  const { showToast } = useToast();
  const isEdit = !!editRecord;
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  // Tope para frenar años basura (ej. 4444) en los date pickers.
  const maxDateIso = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 10);
    return d.toISOString().slice(0, 10);
  }, []);

  const [truckId, setTruckId]           = useState<number | "">(editRecord?.truck_id ?? presetTruck ?? (trucks[0]?.id ?? ""));
  const [tipo, setTipo]                 = useState<MaintenanceTipo>((editRecord?.tipo as MaintenanceTipo) ?? prefill?.tipo ?? "service");
  const [fecha, setFecha]               = useState(editRecord?.fecha?.slice(0, 10) ?? prefill?.fecha ?? todayIso);
  const [km, setKm]                     = useState(editRecord?.km_al_service != null ? String(editRecord.km_al_service) : (prefill?.km ?? ""));
  const [costo, setCosto]               = useState(editRecord?.costo != null ? String(editRecord.costo) : "");
  const [taller, setTaller]             = useState(editRecord?.taller ?? "");
  const [notas, setNotas]               = useState(editRecord?.notas ?? "");
  const [proximoFecha, setProximoFecha] = useState(editRecord?.proximo_fecha?.slice(0, 10) ?? prefill?.proximoFecha ?? "");
  const [proximoKm, setProximoKm]       = useState(editRecord?.proximo_km != null ? String(editRecord.proximo_km) : (prefill?.proximoKm ?? ""));
  const [saving, setSaving]             = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (truckId === "") { showToast("Seleccioná un camión.", "error"); return; }
    if (!fecha) { showToast("La fecha es requerida.", "error"); return; }

    setSaving(true);
    try {
      const payload = {
        truck_id: Number(truckId),
        tipo,
        fecha,
        km_al_service: km ? Number(km) : null,
        costo: costo ? Number(costo) : null,
        taller: taller.trim() || null,
        notas: notas.trim() || null,
        proximo_fecha: proximoFecha || null,
        proximo_km: proximoKm ? Number(proximoKm) : null,
      };
      if (isEdit && editRecord) await updateMaintenance(editRecord.id, payload);
      else await createMaintenance(payload);
      showToast(isEdit ? "Cambios guardados." : "Mantenimiento registrado.", "success");
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
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--c-ink)", marginBottom: 18 }}>
          {isEdit ? "Editar mantenimiento" : prefill ? "Registrar service realizado" : "Cargar mantenimiento"}
        </div>

        <Field label="Camión">
          <select value={truckId} onChange={(e) => setTruckId(e.target.value ? Number(e.target.value) : "")} style={inputStyle} required disabled={isEdit}>
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
            <input type="date" value={fecha} max={maxDateIso} onChange={(e) => setFecha(e.target.value)} style={inputStyle} required />
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
            <input type="date" value={proximoFecha} max={maxDateIso} onChange={(e) => setProximoFecha(e.target.value)} style={inputStyle} />
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
          <button type="submit" className="st-btn-primary" disabled={saving}>
            {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar"}
          </button>
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
