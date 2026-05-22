import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { Truck, Driver } from "@/types/auth";
import { fetchTrucks, updateDriver } from "@/services/api";
import { Icons } from "./DashboardIcons";
import TruckEditModal from "./TruckEditModal";
import DriverEditModal from "./DriverEditModal";
import AssignDriverModal from "./AssignDriverModal";

const MILLIS_PER_DAY = 1000 * 60 * 60 * 24;
const SERVICE_WARN_DAYS = 30;
const LICENSE_WARN_DAYS = 30;

const DRIVER_ESTADO_ACTIVO = "Activo";
const DRIVER_ESTADO_INACTIVO = "Inactivo";

type FleetTab = "trucks" | "drivers";

export default function FleetView() {
  const { drivers, refreshDrivers } = useAuth();
  const [tab, setTab] = useState<FleetTab>("drivers");

  return (
    <div style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      <div style={{ marginBottom: 16 }}>
        <div className="st-section-eyebrow">Operaciones</div>
        <h2 className="st-section-title">Flota</h2>
      </div>

      <Tabs current={tab} onChange={setTab} />

      <div style={{ marginTop: 20 }}>
        {tab === "trucks" ? (
          <TrucksTab />
        ) : (
          <DriversTab drivers={drivers} refreshDrivers={refreshDrivers} />
        )}
      </div>
    </div>
  );
}

// ── Tabs nav ───────────────────────────────────────────────────────────────

function Tabs({ current, onChange }: { current: FleetTab; onChange: (t: FleetTab) => void }) {
  const items: { key: FleetTab; label: string }[] = [
    { key: "drivers", label: "Conductores" },
    { key: "trucks",  label: "Camiones" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #f0f0f0" }}>
      {items.map((it) => {
        const active = current === it.key;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            style={{
              background: "transparent",
              border: "none",
              padding: "12px 18px",
              fontFamily: "inherit",
              fontSize: "0.9rem",
              fontWeight: active ? 800 : 600,
              color: active ? "#0d0d0d" : "#6b7280",
              cursor: "pointer",
              borderBottom: active ? "2px solid #e53935" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Tab: Camiones ──────────────────────────────────────────────────────────

function TrucksTab() {
  const { drivers, refreshTrucks } = useAuth();
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing]   = useState<Truck | null>(null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<Truck | null>(null);

  const loadTrucks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await fetchTrucks();
      setTrucks(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar camiones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrucks();
  }, [loadTrucks]);

  function handleSaved() {
    setEditing(null);
    setCreating(false);
    void loadTrucks();
    void refreshTrucks();
  }

  function handleAssignDone() {
    setAssigning(null);
    void loadTrucks();
    void refreshTrucks();
  }

  return (
    <div>
      <Toolbar
        title="Camiones"
        actionLabel="Agregar camión"
        onAction={() => setCreating(true)}
      />

      {loading && <Hint>Cargando camiones…</Hint>}
      {error && <Hint tone="error">{error}</Hint>}

      {!loading && !error && trucks.length === 0 && (
        <EmptyState
          title="No tenés camiones registrados"
          actionLabel="Agregar camión"
          onAction={() => setCreating(true)}
        />
      )}

      {!loading && !error && trucks.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 16,
          }}
        >
          {trucks.map((t) => (
            <TruckCard
              key={t.id}
              truck={t}
              onEdit={() => setEditing(t)}
              onAssign={() => setAssigning(t)}
            />
          ))}
        </div>
      )}

      {creating && (
        <TruckEditModal truck={null} onSave={handleSaved} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <TruckEditModal truck={editing} onSave={handleSaved} onClose={() => setEditing(null)} />
      )}
      {assigning && (
        <AssignDriverModal
          truck={assigning}
          drivers={drivers}
          onDone={handleAssignDone}
          onClose={() => setAssigning(null)}
        />
      )}
    </div>
  );
}

interface TruckCardProps {
  truck: Truck;
  onEdit: () => void;
  onAssign: () => void;
}

function TruckCard({ truck, onEdit, onAssign }: TruckCardProps) {
  const estadoStyle = truckEstadoStyle(truck.estado);
  const serviceStyle = nextServiceStyle(truck.proximo_service);
  const driverActive = (truck.driver?.id ?? null) !== null;

  return (
    <div
      style={{
        border: "1px solid #f0f0f0",
        borderRadius: 14,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "#0d0d0d" }}>
          {truck.name}
        </h3>
        <span className={`st-badge ${estadoStyle.className}`}>
          <span className="dot" style={{ background: estadoStyle.dotColor }} />
          {truck.estado}
        </span>
      </div>

      {truck.patente && (
        <div
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontWeight: 700,
            color: "#0d0d0d",
            fontSize: "0.95rem",
            letterSpacing: 0.4,
          }}
        >
          {truck.patente}
        </div>
      )}

      <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>
        {truck.modelo ?? "Modelo no informado"}
        {truck.anio ? ` · ${truck.anio}` : ""}
      </div>

      <div style={{ display: "flex", gap: 12, fontSize: "0.85rem", flexWrap: "wrap" }}>
        <span style={{ color: "#6b7280" }}>
          {truck.km_actual != null ? `${formatKm(truck.km_actual)} km` : "Km s/d"}
        </span>
        <span style={{ color: serviceStyle.color, fontWeight: serviceStyle.bold ? 700 : 500 }}>
          Próx. service: {formatServiceDate(truck.proximo_service)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem" }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: driverActive ? "#22c55e" : "#9ca3af",
          }}
        />
        <span style={{ color: driverActive ? "#0d0d0d" : "#9ca3af" }}>
          {truck.driver?.nombre ?? "Sin conductor"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button
          className="st-btn-secondary"
          style={{ padding: "8px 14px", fontSize: "0.82rem" }}
          onClick={onEdit}
        >
          <Icons.Edit size={14} /> Editar
        </button>
        <button
          className="st-btn-secondary"
          style={{ padding: "8px 14px", fontSize: "0.82rem" }}
          onClick={onAssign}
        >
          <Icons.People size={14} /> Conductor
        </button>
      </div>
    </div>
  );
}

// ── Tab: Conductores ───────────────────────────────────────────────────────

interface DriversTabProps {
  drivers: Driver[];
  refreshDrivers: () => Promise<void>;
}

function DriversTab({ drivers, refreshDrivers }: DriversTabProps) {
  const [editing, setEditing]   = useState<Driver | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError]       = useState("");
  const [trucks, setTrucks]     = useState<Truck[]>([]);

  const loadTrucks = useCallback(async () => {
    try {
      const list = await fetchTrucks();
      setTrucks(list);
    } catch (err) {
      // Si falla no es bloqueante: el camión asignado se mostrará como "—".
      console.error("Error al cargar camiones para conductores:", err);
    }
  }, []);

  useEffect(() => {
    void loadTrucks();
  }, [loadTrucks]);

  const driverIdToTruckName = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of trucks) {
      if (t.driver?.id != null) map.set(t.driver.id, t.name);
    }
    return map;
  }, [trucks]);

  function handleSaved() {
    setEditing(null);
    setCreating(false);
    void loadTrucks();
  }

  async function handleToggleStatus(driver: Driver) {
    setError("");
    const nextEstado =
      driver.estado === DRIVER_ESTADO_ACTIVO ? DRIVER_ESTADO_INACTIVO : DRIVER_ESTADO_ACTIVO;
    try {
      await updateDriver(driver.id, { estado: nextEstado });
      await refreshDrivers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al actualizar el conductor.");
    }
  }

  return (
    <div>
      <Toolbar
        title="Conductores"
        actionLabel="Agregar conductor"
        onAction={() => setCreating(true)}
      />

      {error && <Hint tone="error">{error}</Hint>}

      {drivers.length === 0 ? (
        <EmptyState
          title="No tenés conductores registrados"
          actionLabel="Agregar conductor"
          onAction={() => setCreating(true)}
        />
      ) : (
        <table className="st-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Licencia</th>
              <th>Categoría</th>
              <th>Vence</th>
              <th>Estado</th>
              <th>Camión asignado</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const venceStyle = licenseExpiryStyle(d.vencimiento_licencia);
              const truckName = driverIdToTruckName.get(d.id) ?? "—";
              const isActive = d.estado === DRIVER_ESTADO_ACTIVO;
              return (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.nombre}</td>
                  <td style={{ color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
                    {d.telefono ?? "—"}
                  </td>
                  <td style={{ color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
                    {d.licencia ?? "—"}
                  </td>
                  <td style={{ color: "#6b7280" }}>{d.categoria_licencia ?? "—"}</td>
                  <td style={{ color: venceStyle.color, fontWeight: venceStyle.bold ? 700 : 500 }}>
                    {venceStyle.text}
                  </td>
                  <td>
                    <span className={`st-badge ${isActive ? "st-badge-activo" : "st-badge-inactivo"}`}>
                      <span
                        className="dot"
                        style={{ background: isActive ? "#22c55e" : "#9ca3af" }}
                      />
                      {d.estado}
                    </span>
                  </td>
                  <td style={{ color: truckName === "—" ? "#9ca3af" : "#0d0d0d" }}>
                    {truckName}
                  </td>
                  <td>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button
                        className="st-action-btn"
                        title="Editar"
                        onClick={() => setEditing(d)}
                      >
                        <Icons.Edit />
                      </button>
                      <button
                        className="st-action-btn danger"
                        title={isActive ? "Desactivar" : "Activar"}
                        onClick={() => handleToggleStatus(d)}
                      >
                        <Icons.Power />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {creating && (
        <DriverEditModal driver={null} onSave={handleSaved} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <DriverEditModal driver={editing} onSave={handleSaved} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Subcomponentes presentacionales ────────────────────────────────────────

function Toolbar({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0d0d0d" }}>{title}</h3>
      <button
        className="st-btn-primary"
        style={{ padding: "10px 16px" }}
        onClick={onAction}
      >
        <Icons.Plus size={14} /> {actionLabel}
      </button>
    </div>
  );
}

function EmptyState({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        border: "1px dashed #e0e0e0",
        borderRadius: 14,
        padding: 36,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        background: "#fafafa",
      }}
    >
      <p style={{ margin: 0, color: "#6b7280", fontSize: "0.95rem" }}>{title}</p>
      <button className="st-btn-primary" style={{ padding: "10px 18px" }} onClick={onAction}>
        <Icons.Plus size={14} /> {actionLabel}
      </button>
    </div>
  );
}

function Hint({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "error";
}) {
  const color = tone === "error" ? "#c62828" : "#6b7280";
  return <p style={{ color, fontSize: "0.88rem", margin: "12px 0" }}>{children}</p>;
}

// ── Helpers de presentación ────────────────────────────────────────────────

function truckEstadoStyle(estado: string): { className: string; dotColor: string } {
  switch (estado) {
    case "Activo":         return { className: "st-badge-activo",     dotColor: "#22c55e" };
    case "En ruta":        return { className: "st-badge-encurso",    dotColor: "#e53935" };
    case "Mantenimiento":  return { className: "st-badge-cancelado",  dotColor: "#f59e0b" };
    case "Inactivo":       return { className: "st-badge-inactivo",   dotColor: "#9ca3af" };
    default:               return { className: "st-badge-inactivo",   dotColor: "#9ca3af" };
  }
}

function nextServiceStyle(date: string | null): { color: string; bold: boolean } {
  if (!date) return { color: "#9ca3af", bold: false };
  const days = daysUntil(date);
  if (days === null) return { color: "#9ca3af", bold: false };
  if (days < 0) return { color: "#c62828", bold: true };
  if (days <= SERVICE_WARN_DAYS) return { color: "#f59e0b", bold: true };
  return { color: "#6b7280", bold: false };
}

function formatServiceDate(date: string | null): string {
  if (!date) return "—";
  return formatDate(date);
}

function licenseExpiryStyle(date: string | null): { text: string; color: string; bold: boolean } {
  if (!date) return { text: "—", color: "#9ca3af", bold: false };
  const days = daysUntil(date);
  if (days === null) return { text: formatDate(date), color: "#6b7280", bold: false };
  if (days < 0) {
    return { text: `${formatDate(date)} · Vencida`, color: "#c62828", bold: true };
  }
  if (days <= LICENSE_WARN_DAYS) {
    return { text: `${formatDate(date)} · Próx. a vencer`, color: "#f59e0b", bold: true };
  }
  return { text: formatDate(date), color: "#6b7280", bold: false };
}

function daysUntil(isoDate: string): number | null {
  const target = new Date(isoDate);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / MILLIS_PER_DAY);
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatKm(km: number): string {
  return km.toLocaleString("es-AR");
}
