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

  const assignedTruck = trucks.find((t) => t.driver?.id === selectedDriverId) ?? null;
  const hasTrucks           = trucks.length > 0;
  const hasAvailableTrucks  = availableTrucks.length > 0;
  const hasAvailableDrivers = availableDrivers.length > 0;
  const blocking = !fleetLoading && !hasTrucks;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr",
        height: "100%",
        minHeight: 0,
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {/* Columna mapa */}
      <div style={{ position: "relative", padding: 20, background: "#fff", minHeight: 0 }}>
        <MapDisplay
          routeResponse={routeResult}
          driverLocations={driverLocations}
          originPin={originPin}
          destinationPin={destinationPin}
        />
      </div>

      {/* Panel derecho */}
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
        {blocking ? (
          <EmptyStateManager
            hasTrucks={hasTrucks}
            hasAvailableDrivers={hasAvailableDrivers}
            hasAvailableTrucks={hasAvailableTrucks}
            onNavigate={onNavigate}
          />
        ) : (
          <>
            {(!hasAvailableDrivers || !hasAvailableTrucks) && (
              <EmptyStateManager
                hasTrucks={hasTrucks}
                hasAvailableDrivers={hasAvailableDrivers}
                hasAvailableTrucks={hasAvailableTrucks}
                onNavigate={onNavigate}
              />
            )}

            {/* Sección 1: Crear viaje */}
            <section style={{ marginBottom: 20 }}>
              <TripCreator
                routeResult={routeResult}
                availableDrivers={availableDrivers}
                assignedTruck={assignedTruck}
                selectedDriverId={selectedDriverId}
                onSelectDriver={setSelectedDriverId}
                onRouteCalculated={(r) => { setRouteResult(r); setOriginPin(null); setDestinationPin(null); }}
                onTripCreated={refreshTrips}
                onOriginPinned={(p) => setOriginPin(p ? { lat: p.lat, lon: p.lon, label: p.label } : null)}
                onDestinationPinned={(p) => setDestinationPin(p ? { lat: p.lat, lon: p.lon, label: p.label } : null)}
              />
            </section>

            {/* Sección 2: Viajes activos */}
            <section style={{ borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
              <p className="st-section-eyebrow" style={{ marginBottom: 4 }}>Operaciones</p>
              <h2 className="st-section-title" style={{ marginBottom: 14 }}>Viajes activos</h2>
              <UpcomingTripsPanel trips={assignedTrips} loading={tripsLoading} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
