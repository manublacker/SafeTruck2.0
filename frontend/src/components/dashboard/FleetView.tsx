import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/Toast";
import type { Truck, Driver } from "@/types/auth";
import { fetchTrucks, fetchDrivers, deleteDriver, startCheckout, fetchInvitations, deleteInvitation, fetchAssignedTrips, SubscriptionRequiredError, type DriverInvitation } from "@/services/api";
import { useRealtime } from "@/hooks/useRealtime";
import type { AdminPage } from "./AdminSidebar";
import { Icons } from "./DashboardIcons";
import TruckEditModal from "./TruckEditModal";
import AssignDriverModal from "./AssignDriverModal";
import InviteDriverModal from "./InviteDriverModal";
import TruckTemplateModal from "./TruckTemplateModal";

const MILLIS_PER_DAY = 1000 * 60 * 60 * 24;
const SERVICE_WARN_DAYS = 30;
const LICENSE_WARN_DAYS = 30;

/** Límite de camiones por plan. enterprise = sin límite. */
const PLAN_TRUCK_LIMITS: Record<string, number> = {
  starter: 5,
  pro: 20,
  enterprise: Infinity,
};

type FleetTab = "trucks" | "drivers";

export default function FleetView({ onNavigate, initialTab = "trucks" }: { onNavigate: (page: AdminPage) => void; initialTab?: FleetTab }) {
  const { refreshDrivers } = useAuth();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [tab, setTab] = useState<FleetTab>(initialTab);

  const loadDrivers = useCallback(async () => {
    try {
      const list = await fetchDrivers();
      setDrivers(list);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { void loadDrivers(); }, [loadDrivers]);

  const refreshAllDrivers = useCallback(async () => {
    await loadDrivers();
    await refreshDrivers().catch(() => {});
  }, [loadDrivers, refreshDrivers]);

  return (
    <div style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      <Tabs current={tab} onChange={setTab} />

      <div style={{ marginTop: 20 }}>
        {tab === "trucks" ? (
          <TrucksTab onNavigate={onNavigate} />
        ) : (
          <DriversTab drivers={drivers} refreshDrivers={refreshAllDrivers} onNavigate={onNavigate} />
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
              fontWeight: active ? 700 : 600,
              color: active ? "var(--c-ink)" : "var(--c-ink-2)",
              cursor: "pointer",
              borderBottom: active ? "2px solid var(--c-accent)" : "2px solid transparent",
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

function TruckStatusBadge({ estado }: { estado: string }) {
  const known = ["Activo", "En ruta", "Mantenimiento", "Inactivo"].includes(estado);
  const { className } = truckEstadoStyle(estado);
  return (
    <span className={`st-badge ${className}`}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
      {known ? estado : "Inactivo"}
    </span>
  );
}

function TruckListCard({ truck, onClick }: { truck: Truck; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const driverActive = truck.driver?.id != null;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "var(--c-bg)",
        border: `1px solid ${hover ? "var(--c-border-strong)" : "var(--c-border)"}`,
        borderRadius: "var(--r-lg)", padding: 16, cursor: "pointer",
        transition: "border-color 160ms ease",
        display: "flex", flexDirection: "column", gap: 14,
      }}
    >
      {/* Header: nombre + estado + chevron */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--c-ink)", marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {truck.name}
          </div>
          {truck.patente && (
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.82rem", fontWeight: 600, color: "var(--c-ink)", letterSpacing: 0.4, marginBottom: 6 }}>
              {truck.patente}
            </div>
          )}
          <TruckStatusBadge estado={truck.estado} />
        </div>
        <span style={{ color: hover ? "var(--c-accent)" : "var(--c-border-strong)", transition: "color 150ms", fontSize: "1.1rem", flexShrink: 0, marginTop: 2 }}>›</span>
      </div>

      {/* Conductor */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: driverActive ? "var(--c-success)" : "var(--c-ink-3)", flexShrink: 0 }} />
        <span style={{ fontSize: "0.82rem", color: driverActive ? "var(--c-ink)" : "var(--c-ink-3)", fontWeight: driverActive ? 600 : 400 }}>
          {truck.driver?.nombre ?? "Sin conductor asignado"}
        </span>
      </div>
    </div>
  );
}

function TruckDetailPanel({
  truck,
  drivers,
  onClose,
  onSaved,
  onDeleted,
  onNavigate,
}: {
  truck: Truck;
  drivers: Driver[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onNavigate: (page: AdminPage) => void;
}) {
  const [deleting, setDeleting]       = useState(false);
  const [editing, setEditing]         = useState(false);
  const [assigning, setAssigning]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { showToast } = useToast();
  const serviceStyle = nextServiceStyle(truck.proximo_service);

  async function handleDelete() {
    setDeleting(true);
    try {
      const { deleteTruck } = await import("@/services/api");
      await deleteTruck(truck.id);
      onDeleted();
    } catch (e: any) {
      showToast(e.message ?? "Error al eliminar el camión", "error");
    } finally {
      setDeleting(false);
      setShowConfirm(false);
    }
  }

  const rows: { label: string; value: string; style?: React.CSSProperties }[] = [
    { label: "Modelo", value: truck.modelo ?? "—" },
    { label: "Año", value: truck.anio ? String(truck.anio) : "—" },
    { label: "Peso máx.", value: truck.max_weight_kg ? `${truck.max_weight_kg.toLocaleString("es-AR")} kg` : "—" },
    { label: "Altura máx.", value: truck.max_height_m ? `${truck.max_height_m} m` : "—" },
    { label: "Ancho máx.", value: truck.max_width_m ? `${truck.max_width_m} m` : "—" },
    { label: "Largo máx.", value: truck.max_length_m ? `${truck.max_length_m} m` : "—" },
    { label: "Km actual", value: truck.km_actual != null ? formatKm(truck.km_actual) + " km" : "—" },
    { label: "Próx. service", value: formatServiceDate(truck.proximo_service), style: { color: serviceStyle.color, fontWeight: serviceStyle.bold ? 700 : undefined } },
    { label: "Conductor", value: truck.driver?.nombre ?? "Sin asignar" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(15,27,45,0.35)", backdropFilter: "blur(2px)" }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: "relative", zIndex: 1, width: 380, height: "100%",
        background: "var(--c-bg)", boxShadow: "var(--sh-2)",
        display: "flex", flexDirection: "column", animation: "slideInRight 200ms ease",
      }}>
        {/* Header claro */}
        <div style={{ background: "var(--c-bg)", borderBottom: "1px solid var(--c-border)", padding: "24px 24px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span className="st-section-label">Camión</span>
            <button onClick={onClose} style={{ background: "var(--c-surface-2)", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: "var(--c-ink-2)", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
          <div>
            <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--c-ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>{truck.name}</div>
            {truck.patente && <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.9rem", fontWeight: 600, color: "var(--c-ink-2)", letterSpacing: "0.08em", marginBottom: 10 }}>{truck.patente}</div>}
            <TruckStatusBadge estado={truck.estado} />
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div className="st-section-label" style={{ marginBottom: 12 }}>Detalles</div>
          <div style={{ border: "1px solid var(--c-border)", borderRadius: "var(--r-md)", overflow: "hidden", marginBottom: 16 }}>
            {rows.map((row, i) => (
              <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: i < rows.length - 1 ? "1px solid var(--c-border)" : "none" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--c-ink-2)" }}>{row.label}</span>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--c-ink)", ...row.style }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="st-btn-secondary" style={{ flex: 1 }} onClick={() => setEditing(true)}>
                <Icons.Edit size={14} /> Editar
              </button>
              <button className="st-btn-secondary" style={{ flex: 1 }} onClick={() => setAssigning(true)}>
                <Icons.People size={14} /> Conductor
              </button>
            </div>
            <button className="st-btn-danger" style={{ width: "100%" }} onClick={() => setShowConfirm(true)}>
              Eliminar camión
            </button>
            {showConfirm && (
              <ConfirmModal
                title="Eliminar camión"
                message={`¿Estás seguro que querés eliminar ${truck.name}${truck.patente ? ` (${truck.patente})` : ""}? Esta acción no se puede deshacer.`}
                confirmLabel="Sí, eliminar"
                loading={deleting}
                onConfirm={handleDelete}
                onCancel={() => setShowConfirm(false)}
              />
            )}
          </div>
        </div>
      </div>

      {editing && <TruckEditModal truck={truck} onSave={() => { setEditing(false); onSaved(); }} onClose={() => setEditing(false)} onSubscriptionRequired={() => { setEditing(false); onClose(); onNavigate("plans"); }} />}
      {assigning && <AssignDriverModal truck={truck} drivers={drivers} onDone={() => { setAssigning(false); onSaved(); }} onClose={() => setAssigning(false)} />}
    </div>
  );
}

function TrucksTab({ onNavigate }: { onNavigate: (page: AdminPage) => void }) {
  const { user, drivers, refreshTrucks } = useAuth();
  const [trucks, setTrucks]       = useState<Truck[]>(user?.trucks ?? []);
  const [loading, setLoading]     = useState(user === null);
  const [error, setError]         = useState("");
  const [subscriptionError, setSubscriptionError] = useState(false);
  const [creating, setCreating]   = useState(false);
  const [fromTemplate, setFromTemplate] = useState(false);
  const [selected, setSelected]   = useState<Truck | null>(null);

  const hasSubscription = user?.plan != null;
  const plan = user?.plan ?? "starter";
  const truckLimit = PLAN_TRUCK_LIMITS[plan] ?? 5;
  const atLimit = Number.isFinite(truckLimit) && trucks.length >= truckLimit;
  const trucksLocked = !hasSubscription;

  const loadTrucks = useCallback(async () => {
    setError("");
    setSubscriptionError(false);
    try { setTrucks(await fetchTrucks()); }
    catch (err) {
      if (err instanceof SubscriptionRequiredError) setSubscriptionError(true);
      else setError(err instanceof Error ? err.message : "Error al cargar camiones.");
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadTrucks(); }, [loadTrucks]);

  function handleSaved() {
    setCreating(false);
    setSelected(null);
    void loadTrucks();
    void refreshTrucks();
  }

  return (
    <div>
      {trucksLocked && <SubscriptionNotice onGoToPlans={() => onNavigate("plans")} />}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--c-ink)" }}>
          Camiones
          {hasSubscription && <span style={{ marginLeft: 8, fontSize: "0.82rem", fontWeight: 600, color: "#9AA3AD" }}>{trucks.length}</span>}
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="st-btn-ghost"
            style={{ opacity: (atLimit || trucksLocked) ? 0.45 : 1, cursor: (atLimit || trucksLocked) ? "not-allowed" : "pointer" }}
            onClick={(atLimit || trucksLocked) ? undefined : () => setFromTemplate(true)}
            disabled={atLimit || trucksLocked}
            title={trucksLocked ? "Activá tu suscripción para agregar camiones" : undefined}
          >
            Desde plantilla
          </button>
          <button
            className="st-btn-primary"
            style={{ opacity: (atLimit || trucksLocked) ? 0.45 : 1, cursor: (atLimit || trucksLocked) ? "not-allowed" : "pointer" }}
            onClick={(atLimit || trucksLocked) ? undefined : () => setCreating(true)}
            disabled={atLimit || trucksLocked}
            title={trucksLocked ? "Activá tu suscripción para agregar camiones" : undefined}
          >
            <Icons.Plus size={14} /> Agregar camión
          </button>
        </div>
      </div>

      {hasSubscription && Number.isFinite(truckLimit) && <FleetUsageBar current={trucks.length} limit={truckLimit} plan={plan} />}
      {loading && <Hint>Cargando camiones…</Hint>}
      {subscriptionError && <SubscriptionBanner onGoToPlans={() => onNavigate("plans")} />}
      {error && <Hint tone="error">{error}</Hint>}
      {!loading && !error && trucks.length === 0 && (
        <EmptyState
          icon={<Icons.Truck size={26} />}
          title="No tenés camiones registrados"
          subtitle="Cargá tu primer camión con el botón “Agregar camión”, o usá una plantilla para sumar varios de una."
        />
      )}

      {!loading && !error && trucks.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14, paddingBottom: 48 }}>
          {trucks.map(t => <TruckListCard key={t.id} truck={t} onClick={() => setSelected(t)} />)}
        </div>
      )}

      {selected && (
        <TruckDetailPanel
          truck={selected}
          drivers={drivers}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); handleSaved(); }}
          onDeleted={() => { setSelected(null); void loadTrucks(); void refreshTrucks(); }}
          onNavigate={onNavigate}
        />
      )}
      {creating && <TruckEditModal truck={null} onSave={handleSaved} onClose={() => setCreating(false)} onSubscriptionRequired={() => { setCreating(false); onNavigate("plans"); }} />}
      {fromTemplate && <TruckTemplateModal onSaved={handleSaved} onClose={() => setFromTemplate(false)} />}
    </div>
  );
}

// ── Tab: Conductores ───────────────────────────────────────────────────────

interface DriversTabProps {
  drivers: Driver[];
  refreshDrivers: () => Promise<void>;
  onNavigate: (page: AdminPage) => void;
}

function driverInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

function DriverCard({
  driver,
  isOnTrip,
  online,
  truck,
  onClick,
}: {
  driver: Driver;
  isOnTrip: boolean;
  online: boolean;
  truck: string | undefined;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "var(--c-bg)",
        border: `1px solid ${hover ? "var(--c-border-strong)" : "var(--c-border)"}`,
        borderRadius: "var(--r-lg)",
        padding: 16,
        cursor: "pointer",
        transition: "border-color 160ms ease",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Avatar + nombre + estado */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "var(--c-navy)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 600, fontSize: "0.88rem", letterSpacing: "0.04em",
          }}>
            {driverInitials(driver.nombre)}
          </div>
          {/* Indicador de presencia: verde = conectado, gris = desconectado */}
          <span
            title={online ? "En línea" : "Desconectado"}
            style={{
              position: "absolute", bottom: -1, right: -1,
              width: 13, height: 13, borderRadius: "50%",
              background: online ? "#22c55e" : "#9ca3af",
              border: "2px solid var(--c-bg)",
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--c-ink)", lineHeight: 1.25, marginBottom: 6 }}>
            {driver.nombre}
          </div>
          {isOnTrip ? (
            <span className="st-badge st-badge-activo">
              <span style={{ position: "relative", display: "inline-flex", width: 6, height: 6 }}>
                <span style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  background: "var(--c-success)", opacity: 0.4,
                  animation: "st-pulse 1.8s ease-out infinite",
                }} />
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--c-success)" }} />
              </span>
              En viaje
            </span>
          ) : (
            <span className="st-badge st-badge-inactivo">
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
              Descansando
            </span>
          )}
        </div>
        <span style={{ color: hover ? "var(--c-accent)" : "var(--c-border-strong)", transition: "color 150ms", fontSize: "1.1rem", flexShrink: 0 }}>›</span>
      </div>

      {/* Camión */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--c-ink-3)", display: "inline-flex" }}><Icons.Truck size={15} /></span>
        <span style={{ fontSize: "0.82rem", color: truck ? "var(--c-ink)" : "var(--c-ink-3)", fontWeight: truck ? 600 : 400 }}>
          {truck ?? "Sin camión asignado"}
        </span>
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel = "Eliminar",
  onConfirm,
  onCancel,
  loading = false,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,27,45,0.45)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, padding: "28px 28px 24px",
          width: "100%", maxWidth: 400,
          boxShadow: "0 20px 60px -12px rgba(15,27,45,0.28), 0 4px 16px rgba(15,27,45,0.08)",
          animation: "fadeScaleIn 150ms ease",
        }}
      >
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--c-ink)", marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: "0.9rem", color: "#69727E", lineHeight: 1.55, marginBottom: 24 }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="st-btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="st-btn-danger solid"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Eliminando…" : confirmLabel}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes fadeScaleIn {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function InvitationCard({ inv, onDeleteClick }: { inv: DriverInvitation; onDeleteClick: () => void }) {
  const expiresIn = Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <div style={{
      background: "#fffbeb", border: "1px dashed #fde68a",
      borderRadius: 14, padding: "20px 18px",
      display: "flex", flexDirection: "column", gap: 10, opacity: 0.85,
      position: "relative",
    }}>
      <button
        onClick={e => { e.stopPropagation(); onDeleteClick(); }}
        title="Eliminar invitación"
        style={{
          position: "absolute", top: 10, right: 10,
          background: "rgba(0,0,0,0.06)", border: "none", borderRadius: 6,
          width: 26, height: 26, cursor: "pointer", color: "#92400e",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "0.75rem", fontWeight: 700,
        }}
      >✕</button>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
          background: "#fef3c7", color: "#92400e",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}><Icons.Clock size={20} /></div>
        <div>
          <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
            {inv.hint_name ?? "Invitación pendiente"}
          </div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: "#fffbeb", border: "1px solid #fde68a",
            borderRadius: 999, padding: "3px 9px",
            fontSize: "0.72rem", fontWeight: 700, color: "#92400e",
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f59e0b" }} />
            Vence en {expiresIn}d
          </span>
        </div>
      </div>
    </div>
  );
}

function DriverDetailPanel({
  driver,
  truck,
  isOnTrip,
  onClose,
  onDeleted,
}: {
  driver: Driver;
  truck: string | undefined;
  isOnTrip: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { showToast } = useToast();

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDriver(driver.id);
      onDeleted();
    } catch (e: any) {
      showToast(e.message ?? "Error al eliminar el conductor", "error");
    } finally {
      setDeleting(false);
      setShowConfirm(false);
    }
  }

  const rows: { label: string; value: string; style?: React.CSSProperties }[] = [
    { label: "Teléfono", value: driver.telefono ?? "—" },
    { label: "Camión asignado", value: truck ?? "Sin asignar" },
  ];

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 900,
        display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(15,27,45,0.35)", backdropFilter: "blur(2px)" }} />

      {/* Panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "relative", zIndex: 1,
          width: 380, height: "100%",
          background: "var(--c-bg)", boxShadow: "var(--sh-2)",
          display: "flex", flexDirection: "column",
          animation: "slideInRight 200ms ease",
        }}
      >
        {/* Header claro */}
        <div style={{ background: "var(--c-bg)", borderBottom: "1px solid var(--c-border)", padding: "24px 24px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span className="st-section-label">Conductor</span>
            <button
              onClick={onClose}
              style={{ background: "var(--c-surface-2)", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: "var(--c-ink-2)", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center" }}
            >✕</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "var(--c-navy)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 600, fontSize: "1.1rem",
            }}>
              {driverInitials(driver.nombre)}
            </div>
            <div>
              <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--c-ink)", letterSpacing: "-0.02em" }}>{driver.nombre}</div>
              <div style={{ marginTop: 6 }}>
                {isOnTrip ? (
                  <span className="st-badge st-badge-activo">
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
                    En viaje
                  </span>
                ) : (
                  <span className="st-badge st-badge-inactivo">
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
                    Descansando
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div className="st-section-label" style={{ marginBottom: 12 }}>
            Información del conductor
          </div>
          <div style={{ border: "1px solid var(--c-border)", borderRadius: "var(--r-md)", overflow: "hidden", marginBottom: 24 }}>
            {rows.map((row, i) => (
              <div key={row.label} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "13px 16px",
                borderBottom: i < rows.length - 1 ? "1px solid var(--c-border)" : "none",
              }}>
                <span style={{ fontSize: "0.85rem", color: "var(--c-ink-2)" }}>{row.label}</span>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--c-ink)", ...row.style }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          <button className="st-btn-danger" style={{ width: "100%" }} onClick={() => setShowConfirm(true)}>
            Eliminar conductor
          </button>

          {showConfirm && (
            <ConfirmModal
              title="Eliminar conductor"
              message={`¿Estás seguro que querés eliminar a ${driver.nombre}? Se perderán todos sus datos y no podrá ingresar a la plataforma.`}
              confirmLabel="Sí, eliminar"
              loading={deleting}
              onConfirm={handleDelete}
              onCancel={() => setShowConfirm(false)}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes st-pulse {
          0%   { transform: scale(1);   opacity: 0.4; }
          70%  { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(1);   opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function DriversTab({ drivers, refreshDrivers, onNavigate }: DriversTabProps) {
  const { user } = useAuth();
  const hasSubscription = user?.plan != null;
  const [inviting, setInviting]   = useState(false);
  const [selected, setSelected]   = useState<Driver | null>(null);
  const [trucks, setTrucks]       = useState<Truck[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<DriverInvitation[]>([]);
  const [onTripDriverIds, setOnTripDriverIds]        = useState<Set<number>>(new Set());
  const [confirmDeleteInv, setConfirmDeleteInv]      = useState<DriverInvitation | null>(null);
  const [deletingInv, setDeletingInv]                = useState(false);
  const [onlineIds, setOnlineIds]                    = useState<Set<string>>(new Set());

  // Presencia en tiempo real: el backend manda la lista de choferes conectados
  // (snapshot al conectar el admin + updates cuando entra/sale un chofer).
  useRealtime((e) => {
    if (e.type === "presence") setOnlineIds(new Set(e.online_driver_ids));
  });

  const loadData = useCallback(async () => {
    try {
      const [truckList, invList, tripList] = await Promise.allSettled([
        fetchTrucks(),
        fetchInvitations(),
        fetchAssignedTrips(),
      ]);
      if (truckList.status === "fulfilled") setTrucks(truckList.value);
      if (invList.status === "fulfilled") {
        const now = Date.now();
        setPendingInvitations(invList.value.filter(i => !i.redeemed_at && new Date(i.expires_at).getTime() > now));
      }
      if (tripList.status === "fulfilled") {
        const ids = new Set(tripList.value.filter(t => t.status === "in_progress").map(t => t.driver_id));
        setOnTripDriverIds(ids);
      }
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const driverIdToTruck = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of trucks) {
      if (t.driver?.id != null) map.set(t.driver.id, `${t.name}${t.patente ? ` · ${t.patente}` : ""}`);
    }
    return map;
  }, [trucks]);

  return (
    <div>
      {!hasSubscription && <SubscriptionNotice onGoToPlans={() => onNavigate("plans")} />}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--c-ink)" }}>
          Conductores
          <span style={{ marginLeft: 8, fontSize: "0.82rem", fontWeight: 600, color: "#9AA3AD" }}>
            {drivers.length}
          </span>
        </h3>
        <button
          className="st-btn-primary"
          style={{ padding: "10px 16px", opacity: hasSubscription ? 1 : 0.45, cursor: hasSubscription ? "pointer" : "not-allowed" }}
          onClick={hasSubscription ? () => setInviting(true) : undefined}
          disabled={!hasSubscription}
          title={!hasSubscription ? "Activá tu suscripción para invitar conductores" : undefined}
        >
          Invitar conductor
        </button>
      </div>

      {drivers.length === 0 && pendingInvitations.length === 0 ? (
        <EmptyState
          icon={<Icons.People size={26} />}
          title="No tenés conductores registrados"
          subtitle="Invitá a tu primer conductor con el botón “Invitar conductor”. Le llega un enlace para registrarse y descargar la app."
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, paddingBottom: 48 }}>
          {pendingInvitations.map(inv => <InvitationCard key={`inv-${inv.id}`} inv={inv} onDeleteClick={() => setConfirmDeleteInv(inv)} />)}
          {drivers.map(d => (
            <DriverCard
              key={d.id}
              driver={d}
              isOnTrip={onTripDriverIds.has(d.id)}
              online={!!d.app_user_id && onlineIds.has(d.app_user_id)}
              truck={driverIdToTruck.get(d.id)}
              onClick={() => setSelected(d)}
            />
          ))}
        </div>
      )}

      {selected && (
        <DriverDetailPanel
          driver={selected}
          truck={driverIdToTruck.get(selected.id)}
          isOnTrip={onTripDriverIds.has(selected.id)}
          onClose={() => setSelected(null)}
          onDeleted={() => { setSelected(null); void refreshDrivers(); void loadData(); }}
        />
      )}
      {inviting && (
        <InviteDriverModal onClose={() => { setInviting(false); void loadData(); }} onSubscriptionRequired={() => { setInviting(false); onNavigate("plans"); }} />
      )}

      {confirmDeleteInv && (
        <ConfirmModal
          title="Eliminar invitación"
          message={`¿Estás seguro que querés eliminar la invitación${confirmDeleteInv.hint_name ? ` de ${confirmDeleteInv.hint_name}` : ""}? Una vez eliminada, el conductor no podrá usarla para unirse a tu empresa.`}
          confirmLabel="Sí, eliminar"
          loading={deletingInv}
          onConfirm={async () => {
            setDeletingInv(true);
            try {
              await deleteInvitation(String(confirmDeleteInv.id));
              setConfirmDeleteInv(null);
              void loadData();
            } catch { /* silencioso */ } finally {
              setDeletingInv(false);
            }
          }}
          onCancel={() => setConfirmDeleteInv(null)}
        />
      )}
    </div>
  );
}

// ── Subcomponentes presentacionales ────────────────────────────────────────

const PLAN_NEXT: Record<string, string> = {
  starter: "pro",
  pro: "enterprise",
};

function FleetUsageBar({
  current,
  limit,
  plan,
}: {
  current: number;
  limit: number;
  plan: string;
}) {
  const [upgrading, setUpgrading] = useState(false);
  const pct = Math.min((current / limit) * 100, 100);
  const atLimit = current >= limit;
  const barColor = atLimit ? "#e53935" : pct >= 80 ? "#f59e0b" : "#22c55e";
  const nextPlan = PLAN_NEXT[plan];

  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) setUpgrading(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function handleUpgrade() {
    if (!nextPlan || upgrading) return;
    setUpgrading(true);
    try {
      const url = await startCheckout(nextPlan);
      window.location.href = url;
    } catch {
      setUpgrading(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: "0.8rem", color: "#6b7280", fontWeight: 600 }}>
          Plan {plan.charAt(0).toUpperCase() + plan.slice(1)}
        </span>
        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: atLimit ? "#e53935" : "#0d0d0d" }}>
          {current} / {limit} camión{limit === 1 ? "" : "es"}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "#f0f0f0", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 999,
            background: barColor,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      {atLimit && (
        <div style={{ margin: "8px 0 0", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#e53935", fontWeight: 600 }}>
            Límite alcanzado. Actualizá tu plan para agregar más camiones.
          </p>
          {nextPlan && (
            <button
              className="st-btn-primary"
              onClick={handleUpgrade}
              disabled={upgrading}
              style={{
                padding: "7px 16px",
                fontSize: "0.85rem",
                opacity: upgrading ? 0.6 : 1,
                cursor: upgrading ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {upgrading ? "Redirigiendo…" : `Pasá al plan ${nextPlan.charAt(0).toUpperCase() + nextPlan.slice(1)}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--c-border)",
        borderRadius: 16,
        minHeight: 360,
        padding: "48px 32px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 6,
        background: "#fff",
      }}
    >
      {icon && (
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: "var(--c-surface-2)",
            color: "var(--c-ink-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          {icon}
        </div>
      )}
      <p style={{ margin: 0, color: "var(--c-ink)", fontSize: "1.15rem", fontWeight: 700 }}>{title}</p>
      {subtitle && (
        <p style={{ margin: 0, color: "var(--c-ink-3)", fontSize: "0.92rem", lineHeight: 1.55, maxWidth: 380 }}>
          {subtitle}
        </p>
      )}
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

function SubscriptionNotice({ onGoToPlans }: { onGoToPlans: () => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
      background: "#fffbeb", border: "1px solid #fde68a",
      borderRadius: 10, padding: "10px 16px", marginBottom: 16,
      fontSize: "0.85rem",
    }}>
      <span style={{ color: "#92400e", fontWeight: 600 }}>
        Necesitás un plan activo para usar estas funciones.
      </span>
      <button
        type="button"
        onClick={onGoToPlans}
        style={{
          background: "none", border: "none", color: "#e53935",
          fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
          padding: 0, fontFamily: "inherit", textDecoration: "underline",
        }}
      >
        Ver planes →
      </button>
    </div>
  );
}

function SubscriptionBanner({ onGoToPlans }: { onGoToPlans: () => void }) {
  return (
    <div style={{
      background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.2)",
      borderRadius: 12, padding: "16px 20px", marginTop: 16,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div>
        <p style={{ color: "#c62828", fontWeight: 700, fontSize: "0.9rem", margin: "0 0 4px" }}>
          Necesitás una suscripción activa
        </p>
        <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: 0, lineHeight: 1.5 }}>
          Para usar esta función debés tener un plan activo.
        </p>
      </div>
      <button
        type="button"
        onClick={onGoToPlans}
        style={{
          alignSelf: "flex-start", background: "#e53935", color: "#fff",
          border: "none", borderRadius: 8, padding: "8px 16px",
          fontSize: "0.82rem", fontWeight: 700, cursor: "pointer",
        }}
      >
        Ver planes y precios
      </button>
    </div>
  );
}

// ── Helpers de presentación ────────────────────────────────────────────────

function truckEstadoStyle(estado: string): { className: string } {
  switch (estado) {
    case "Activo":         return { className: "st-badge-activo" };
    case "En ruta":        return { className: "st-badge-encurso" };
    case "Mantenimiento":  return { className: "st-badge-cancelado" };
    default:               return { className: "st-badge-inactivo" };
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
