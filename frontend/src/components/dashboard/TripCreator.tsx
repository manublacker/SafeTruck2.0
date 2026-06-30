import { useEffect, useRef, useState } from "react";
import type { RouteResponse } from "@/types/route";
import type { Truck, Driver } from "@/types/auth";
import RouteCalculator, { type RouteCalculatorHandle, type PinPreview, type CalculateResult } from "./RouteCalculator";
import { useAuth } from "@/contexts/AuthContext";

const FLASH_DURATION_MS = 4000;
const MUTED = "#6b7280";
const PLACEHOLDER = "#9ca3af";

/** Datos listos para asignar el viaje, que el creador entrega al padre cuando
 *  la ruta ya se calculó. El padre cierra el modal y muestra la barra de asignar. */
export interface ReadyAssignment {
  result: CalculateResult;
  driverId: number;
  truckId: number;
  driverName: string;
  scheduledAt?: string;
}

interface Props {
  availableDrivers: Driver[];
  assignedTruck: Truck | null;
  selectedDriverId: number | null;
  onSelectDriver: (id: number | null) => void;
  onRouteCalculated: (result: RouteResponse) => void;
  /** La ruta se calculó y se dibujó: el padre cierra el modal y muestra la barra. */
  onReadyToAssign: (a: ReadyAssignment) => void;
  onOriginPinned?: (pin: PinPreview | null) => void;
  onDestinationPinned?: (pin: PinPreview | null) => void;
  onSubscriptionRequired?: () => void;
}

interface DraftTrip { date: string; time: string }
const EMPTY_DRAFT: DraftTrip = { date: "", time: "" };

export default function TripCreator({
  availableDrivers,
  assignedTruck,
  selectedDriverId,
  onSelectDriver,
  onRouteCalculated,
  onReadyToAssign,
  onOriginPinned,
  onDestinationPinned,
  onSubscriptionRequired,
}: Props) {
  const { user } = useAuth();
  const hasSubscription = user?.plan != null;
  const [draft, setDraft]       = useState<DraftTrip>(EMPTY_DRAFT);
  const [flash, setFlash]       = useState<{ msg: string; ok: boolean }>({ msg: "", ok: true });
  const [calculating, setCalculating] = useState(false);
  const routeRef = useRef<RouteCalculatorHandle>(null);

  useEffect(() => {
    if (!flash.msg) return;
    const t = window.setTimeout(() => setFlash({ msg: "", ok: true }), FLASH_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [flash.msg]);

  const hasDrivers  = availableDrivers.length > 0;
  const hasTruck    = Boolean(assignedTruck);
  const formDisabled = !hasDrivers || !hasTruck || calculating || !hasSubscription;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <h2 className="st-section-title" style={{ marginBottom: 14 }}>Nuevo viaje</h2>

      {!hasSubscription && onSubscriptionRequired && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
          background: "#fffbeb", border: "1px solid #fde68a",
          borderRadius: 10, padding: "10px 16px", marginBottom: 12,
          fontSize: "0.85rem",
        }}>
          <span style={{ color: "#92400e", fontWeight: 600 }}>
            🔒 Necesitás un plan activo para asignar viajes.
          </span>
          <button
            type="button"
            onClick={onSubscriptionRequired}
            style={{
              background: "none", border: "none", color: "#e53935",
              fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
              padding: 0, fontFamily: "inherit", textDecoration: "underline",
            }}
          >
            Ver planes →
          </button>
        </div>
      )}

      {!hasDrivers && (
        <p style={{ color: "#c62828", fontSize: "0.85rem", margin: "0 0 12px" }}>
          Sin conductores disponibles. Activá uno para poder asignar el viaje.
        </p>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void handleCalculate(); }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}>

        <div>
          <label className="st-label">Conductor</label>
          <select
            className="st-field"
            style={{ height: 44 }}
            value={selectedDriverId ?? ""}
            onChange={(e) => onSelectDriver(e.target.value === "" ? null : Number(e.target.value))}
            disabled={!hasDrivers}
            required
          >
            {!hasDrivers && <option value="">Sin conductores disponibles</option>}
            {availableDrivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
        </div>

        <AssignedTruckCard truck={assignedTruck} hasDrivers={hasDrivers} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="st-label">Fecha</label>
            <input type="date" className="st-field"
              value={draft.date} min={today} required
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
          </div>
          <div>
            <label className="st-label">Hora</label>
            <input type="time" className="st-field"
              value={draft.time} required
              onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))} />
          </div>
        </div>

        <RouteCalculator
          ref={routeRef}
          selectedTruck={assignedTruck}
          onRouteCalculated={onRouteCalculated}
          onOriginPinned={onOriginPinned}
          onDestinationPinned={onDestinationPinned}
          onSubscriptionRequired={onSubscriptionRequired}
        />

        {/* Calcular la ruta: la dibuja en el mapa, cierra el modal y muestra la
            barra flotante con "Asignar viaje" (lo maneja el contenedor del mapa). */}
        <button
          type="submit"
          className="st-btn-cta"
          disabled={formDisabled}
          title={!hasSubscription ? "Activá tu suscripción para calcular rutas" : undefined}
        >
          {calculating ? "Calculando ruta…" : "Calcular ruta"}
        </button>

        {flash.msg && (
          <div style={{
            background: flash.ok ? "#f0fdf4" : "rgba(229,57,53,0.06)",
            border: `1px solid ${flash.ok ? "#bbf7d0" : "rgba(229,57,53,0.2)"}`,
            borderRadius: 10, padding: "12px 16px",
            color: flash.ok ? "#16a34a" : "#c62828",
            fontWeight: 700, fontSize: "0.85rem",
          }}>
            {flash.msg}
          </div>
        )}
      </form>
    </div>
  );

  // Calcula la ruta (la dibuja en el mapa vía onRouteCalculated dentro de
  // calculate()) y, si salió bien, entrega los datos al padre para que cierre el
  // modal y muestre la barra flotante de "Asignar viaje".
  async function handleCalculate() {
    if (formDisabled || !assignedTruck || selectedDriverId === null) return;
    const driver = availableDrivers.find((d) => d.id === selectedDriverId);
    if (!driver) return;
    if (!draft.date || !draft.time) {
      setFlash({ msg: "Completá fecha y hora.", ok: false });
      return;
    }

    setCalculating(true);
    setFlash({ msg: "", ok: true });
    try {
      const result = await routeRef.current?.calculate();
      if (!result) return; // calculate() ya mostró su propio error/banner
      onReadyToAssign({
        result,
        driverId:   selectedDriverId,
        truckId:    assignedTruck.id,
        driverName: driver.nombre,
        scheduledAt: `${draft.date}T${draft.time}:00`,
      });
    } finally {
      setCalculating(false);
    }
  }
}

function AssignedTruckCard({ truck, hasDrivers }: { truck: Truck | null; hasDrivers: boolean }) {
  if (!hasDrivers) return null;
  if (!truck) {
    return (
      <div style={{
        background: "rgba(229,57,53,0.04)", border: "1px solid rgba(229,57,53,0.2)",
        borderRadius: 10, padding: "10px 12px", fontSize: "0.85rem", color: "#c62828",
      }}>
        Este conductor no tiene un camión asignado.
      </div>
    );
  }
  const tons = (truck.max_weight_kg / 1000).toFixed(1).replace(/\.0$/, "");
  return (
    <div style={{
      background: "#fafafa", borderLeft: "3px solid #e53935",
      border: "1px solid #f0f0f0", borderRadius: 10,
      padding: "10px 12px", fontSize: "0.85rem", color: MUTED,
      lineHeight: 1.45, display: "flex", gap: 10, alignItems: "flex-start",
    }}>
      <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>🚛</span>
      <div>
        <div style={{ fontSize: "0.72rem", color: PLACEHOLDER, marginBottom: 2 }}>Camión asignado</div>
        <div style={{ color: "#0d0d0d", fontWeight: 700 }}>
          {truck.modelo ?? truck.name}{truck.patente ? ` · ${truck.patente}` : ""}
        </div>
        <div>{tons} t · {truck.max_height_m} m alt</div>
      </div>
    </div>
  );
}

