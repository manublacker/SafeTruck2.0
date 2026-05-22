import { useEffect, useRef, useState } from "react";
import type { RouteResponse } from "@/types/route";
import type { Truck, Driver } from "@/types/auth";
import RouteCalculator, { type RouteCalculatorHandle } from "./RouteCalculator";

const FLASH_DURATION_MS = 4000;
const MUTED = "#6b7280";
const PLACEHOLDER = "#9ca3af";

interface Props {
  routeResult: RouteResponse | null;
  availableDrivers: Driver[];
  assignedTruck: Truck | null;
  selectedDriverId: number | null;
  onSelectDriver: (id: number | null) => void;
  onRouteCalculated: (result: RouteResponse) => void;
}

interface DraftTrip {
  date: string;
  time: string;
}

const EMPTY_DRAFT: DraftTrip = { date: "", time: "" };

export default function TripCreator({
  routeResult,
  availableDrivers,
  assignedTruck,
  selectedDriverId,
  onSelectDriver,
  onRouteCalculated,
}: Props) {
  const [draft, setDraft] = useState<DraftTrip>(EMPTY_DRAFT);
  const [flash, setFlash] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const routeRef = useRef<RouteCalculatorHandle>(null);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(""), FLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const hasDrivers = availableDrivers.length > 0;
  const hasTruck = Boolean(assignedTruck);
  const formDisabled = !hasDrivers || !hasTruck || submitting;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Section title="Crear viaje">
      {!hasDrivers && (
        <Hint tone="warning">
          Sin conductores disponibles. Activá uno para poder asignar el viaje.
        </Hint>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <label className="st-label">Conductor</label>
          <select
            className="st-select"
            value={selectedDriverId ?? ""}
            onChange={(e) =>
              onSelectDriver(
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            disabled={!hasDrivers}
            required
          >
            {!hasDrivers && (
              <option value="">Sin conductores disponibles</option>
            )}
            {availableDrivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
                {d.licencia ? ` · ${d.licencia}` : ""}
              </option>
            ))}
          </select>
        </div>

        <AssignedTruckCard truck={assignedTruck} hasDrivers={hasDrivers} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="st-label">Fecha</label>
            <input
              type="date"
              className="st-input"
              value={draft.date}
              onChange={(e) =>
                setDraft((d) => ({ ...d, date: e.target.value }))
              }
              min={today}
              required
            />
          </div>
          <div>
            <label className="st-label">Hora</label>
            <input
              type="time"
              className="st-input"
              value={draft.time}
              onChange={(e) =>
                setDraft((d) => ({ ...d, time: e.target.value }))
              }
              required
            />
          </div>
        </div>

        <RouteCalculator
          ref={routeRef}
          selectedTruck={assignedTruck}
          onRouteCalculated={onRouteCalculated}
        />

        {routeResult?.found && assignedTruck && (
          <RouteSummary route={routeResult} truckName={assignedTruck.modelo ?? assignedTruck.name} />
        )}

        <button
          type="submit"
          className="st-btn-primary"
          style={{ width: "100%" }}
          disabled={formDisabled}
        >
          {submitting ? "Creando viaje…" : "Crear viaje"}
        </button>

        {flash && <p className="st-flash-ok">{flash}</p>}
      </form>
    </Section>
  );

  async function handleSubmit() {
    if (formDisabled) return;
    if (!assignedTruck || selectedDriverId === null) return;

    const driver = availableDrivers.find((d) => d.id === selectedDriverId);
    if (!driver) return;

    setSubmitting(true);
    try {
      const route = await routeRef.current?.calculate();
      if (!route) return;
      setFlash(
        `Viaje creado para ${driver.nombre} · ${route.originLabel} → ${route.destinationLabel}`,
      );
      setDraft(EMPTY_DRAFT);
    } finally {
      setSubmitting(false);
    }
  }
}

function AssignedTruckCard({
  truck,
  hasDrivers,
}: {
  truck: Truck | null;
  hasDrivers: boolean;
}) {
  if (!hasDrivers) return null;
  if (!truck) {
    return (
      <div
        style={{
          background: "rgba(229,57,53,0.04)",
          border: "1px solid rgba(229,57,53,0.2)",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: "0.85rem",
          color: "#c62828",
        }}
      >
        Este conductor no tiene un camión asignado.
      </div>
    );
  }
  const tons = (truck.max_weight_kg / 1000).toFixed(1).replace(/\.0$/, "");
  return (
    <div
      style={{
        background: "#fafafa",
        border: "1px solid #f0f0f0",
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: "0.85rem",
        color: MUTED,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontSize: "0.75rem", color: PLACEHOLDER, marginBottom: 2 }}>
        Camión asignado
      </div>
      <div style={{ color: "#0d0d0d", fontWeight: 700 }}>
        {truck.modelo ?? truck.name}
        {truck.patente ? ` · ${truck.patente}` : ""}
      </div>
      <div>{tons} t · {truck.max_height_m} m alt</div>
    </div>
  );
}

// ── Subcomponentes ───────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2
        style={{
          fontSize: "1.6rem",
          fontWeight: 800,
          color: "#0d0d0d",
          margin: "0 0 20px",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function Hint({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning";
}) {
  const color = tone === "warning" ? "#c62828" : PLACEHOLDER;
  return (
    <p style={{ color, fontSize: "0.85rem", margin: "0 0 8px" }}>{children}</p>
  );
}

function RouteSummary({
  route,
  truckName,
}: {
  route: RouteResponse;
  truckName: string;
}) {
  return (
    <div
      style={{
        background: "#fafafa",
        border: "1px solid #f0f0f0",
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: "0.82rem",
        color: MUTED,
        lineHeight: 1.45,
      }}
    >
      <div>
        <strong style={{ color: "#0d0d0d" }}>{truckName}</strong>
      </div>
      <div>
        {route.originLabel} → {route.destinationLabel}
      </div>
      <div>
        {(route.distanceM / 1000).toFixed(1)} km · ~
        {route.estimatedDurationMin} min
      </div>
    </div>
  );
}
