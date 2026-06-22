import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAvailability, type Trip } from "./useAvailability";
import MapDisplay, { type DriverLocation, type MapPin } from "./MapDisplay";
import EmptyStateManager from "./EmptyStateManager";
import TripCreator from "./TripCreator";
import UpcomingTripsPanel from "./UpcomingTripsPanel";
import type { AdminPage } from "./AdminSidebar";
import type { RouteResponse } from "@/types/route";
import type { Truck, Driver } from "@/types/auth";
import { fetchDriverLocations, fetchAssignedTrips, fetchTrucks, fetchDrivers, type AssignedTrip } from "@/services/api";

const PANEL_PADDING = 12;
const PANEL_GAP = 16;
const MAP_COLUMN_BASIS = "minmax(420px, 2fr)";
const SIDE_COLUMN_BASIS = "minmax(380px, 1fr)";

interface Props {
  onNavigate: (page: AdminPage) => void;
}

export default function LiveMapContainer({ onNavigate }: Props) {
  const { user } = useAuth();

  const [trucks, setTrucks]   = useState<import("@/types/auth").Truck[]>([]);
  const [drivers, setDrivers] = useState<import("@/types/auth").Driver[]>([]);
  const [fleetLoading, setFleetLoading] = useState(true);

  const trips: Trip[] = [];
  const { availableTrucks, availableDrivers } = useAvailability(trucks, drivers, trips);

  const [routeResult, setRouteResult]           = useState<RouteResponse | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [originPin, setOriginPin]               = useState<MapPin | null>(null);
  const [destinationPin, setDestinationPin]     = useState<MapPin | null>(null);
  const [driverLocations, setDriverLocations]   = useState<DriverLocation[]>([]);
  const [assignedTrips, setAssignedTrips]       = useState<AssignedTrip[]>([]);
  const [tripsLoading, setTripsLoading]         = useState(true);
  const [creatorOpen, setCreatorOpen]           = useState(false);

  const locationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripsPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Carga directa de trucks y drivers (no depende del auth context que arranca vacío)
  useEffect(() => {
    Promise.all([fetchTrucks(), fetchDrivers()])
      .then(([t, d]) => { setTrucks(t); setDrivers(d); })
      .catch(() => {})
      .finally(() => setFleetLoading(false));
  }, []);

  useEffect(() => {
    if (selectedDriverId !== null && availableDrivers.some((d) => d.id === selectedDriverId)) return;
    setSelectedDriverId(availableDrivers[0]?.id ?? null);
  }, [availableDrivers, selectedDriverId]);

  // Polling posiciones GPS cada 5s
  useEffect(() => {
    async function pollLocations() {
      try {
        const locs = await fetchDriverLocations();
        setDriverLocations(locs);
      } catch { /* silencioso */ }
    }
    void pollLocations();
    locationPollRef.current = setInterval(() => void pollLocations(), 5_000);
    return () => { if (locationPollRef.current) clearInterval(locationPollRef.current); };
  }, []);

  // Fetch de viajes asignados + polling cada 10s
  const refreshTrips = useCallback(async () => {
    try {
      const data = await fetchAssignedTrips();
      setAssignedTrips(data);
    } catch { /* silencioso */ } finally {
      setTripsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTrips();
    tripsPollRef.current = setInterval(() => void refreshTrips(), 10_000);
    return () => { if (tripsPollRef.current) clearInterval(tripsPollRef.current); };
  }, [refreshTrips]);

  // Cerrar el modal de "Nuevo viaje" con Escape
  useEffect(() => {
    if (!creatorOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setCreatorOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creatorOpen]);

  const assignedTruck = trucks.find((t) => t.driver?.id === selectedDriverId) ?? null;
  const hasTrucks           = trucks.length > 0;
  const hasAvailableTrucks  = availableTrucks.length > 0;
  const hasAvailableDrivers = availableDrivers.length > 0;
  const blocking = !fleetLoading && !hasTrucks;

  const canCreate = !blocking && hasAvailableDrivers && hasAvailableTrucks;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 380px",
        height: "100%",
        minHeight: 0,
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {/* Columna mapa (ahora a pleno: sin formulario encima) */}
      <div style={{ position: "relative", padding: 20, background: "#fff", minHeight: 0 }}>
        <MapDisplay
          routeResponse={routeResult}
          driverLocations={driverLocations}
          originPin={originPin}
          destinationPin={destinationPin}
        />
      </div>

      {/* Panel derecho: solo lectura (operaciones) + disparador del modal */}
      <div
        className="scroll-y"
        style={{
          background: "#fff",
          borderLeft: "1px solid #f0f0f0",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {fleetLoading ? null : blocking ? (
          <EmptyStateManager
            hasTrucks={hasTrucks}
            hasAvailableDrivers={hasAvailableDrivers}
            hasAvailableTrucks={hasAvailableTrucks}
            onNavigate={onNavigate}
          />
        ) : (
          <>
            {!canCreate && (
              <EmptyStateManager
                hasTrucks={hasTrucks}
                hasAvailableDrivers={hasAvailableDrivers}
                hasAvailableTrucks={hasAvailableTrucks}
                onNavigate={onNavigate}
              />
            )}

            {/* Disparador: abre el formulario en un modal enfocado */}
            <button
              className="st-btn-cta"
              style={{ width: "100%", marginBottom: 20 }}
              onClick={() => setCreatorOpen(true)}
              disabled={!canCreate}
              title={!canCreate ? "Activá un conductor con camión para asignar viajes" : undefined}
            >
              + Nuevo viaje
            </button>

            {/* Viajes activos (lectura) */}
            <section style={{ borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
              <h2 className="st-section-title" style={{ marginBottom: 14 }}>Viajes activos</h2>
              <UpcomingTripsPanel trips={assignedTrips} loading={tripsLoading} />
            </section>
          </>
        )}
      </div>

      {/* Modal de creación: aísla la carga de datos del mapa interactivo */}
      {creatorOpen && (
        <div
          className="st-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setCreatorOpen(false); }}
        >
          <div
            className="st-modal"
            style={{ maxWidth: 480, maxHeight: "88vh", overflowY: "auto", position: "relative" }}
          >
            <button
              aria-label="Cerrar"
              onClick={() => setCreatorOpen(false)}
              style={{
                position: "absolute", top: 16, right: 16, zIndex: 1,
                width: 30, height: 30, borderRadius: 8, border: "1px solid var(--c-border)",
                background: "var(--c-bg)", color: "var(--c-ink-2)", cursor: "pointer",
                fontSize: "1.1rem", lineHeight: 1, fontFamily: "inherit",
              }}
            >
              ×
            </button>
            <TripCreator
              routeResult={routeResult}
              availableDrivers={availableDrivers}
              assignedTruck={assignedTruck}
              selectedDriverId={selectedDriverId}
              onSelectDriver={setSelectedDriverId}
              onRouteCalculated={(r) => { setRouteResult(r); setOriginPin(null); setDestinationPin(null); }}
              onTripCreated={() => { void refreshTrips(); setCreatorOpen(false); }}
              onOriginPinned={(p) => setOriginPin(p ? { lat: p.lat, lon: p.lon, label: p.label } : null)}
              onDestinationPinned={(p) => setDestinationPin(p ? { lat: p.lat, lon: p.lon, label: p.label } : null)}
              onSubscriptionRequired={() => onNavigate("plans")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
