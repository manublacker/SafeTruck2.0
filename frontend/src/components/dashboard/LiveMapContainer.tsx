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
import { useRealtime, type RoutePathSegment } from "@/hooks/useRealtime";
import { Icons } from "./DashboardIcons";

const PANEL_PADDING = 12;
const PANEL_GAP = 16;
const MAP_COLUMN_BASIS = "minmax(420px, 2fr)";
const SIDE_COLUMN_BASIS = "minmax(380px, 1fr)";

// Cache a nivel módulo de la data "en vivo". Cuando el admin va a otra pestaña y
// vuelve, este componente se vuelve a montar; sin el cache el mapa arrancaba
// VACÍO (sin camión ni recorrido) hasta re-fetchear, mostrando el cartel "sin
// unidades" y perdiendo la ruta unos segundos. Con el cache, al volver se ve al
// instante lo último conocido y el polling/WebSocket lo refresca enseguida.
let cachedLocations: DriverLocation[] = [];
let cachedRoutes: Record<string, RoutePathSegment[]> = {};
let cachedTrips: AssignedTrip[] = [];

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
  const [driverLocations, setDriverLocations]   = useState<DriverLocation[]>(() => cachedLocations);
  // Mostramos el cartel "sin unidades" sólo si la lista quedó vacía de verdad
  // (no ante vacíos momentáneos por la carrera entre el polling y el WebSocket,
  // que hacían parpadear el cartel durante un viaje).
  const [showEmptyOverlay, setShowEmptyOverlay] = useState(false);
  // Recorrido (ruta) por chofer, sólo de WS (no del polling) → no titila al pollear.
  const [driverRoutes, setDriverRoutes]         = useState<Record<string, RoutePathSegment[]>>(() => cachedRoutes);
  const [assignedTrips, setAssignedTrips]       = useState<AssignedTrip[]>(() => cachedTrips);
  const [tripsLoading, setTripsLoading]         = useState(cachedTrips.length === 0);
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

  // Polling de respaldo de posiciones GPS (cada 30s). El WebSocket empuja los
  // cambios en tiempo real; este polling solo reconcilia (ej: sacar choferes
  // que dejaron de mandar GPS) por si el socket se cae.
  useEffect(() => {
    async function pollLocations() {
      try {
        const locs = await fetchDriverLocations();
        setDriverLocations(locs);
      } catch { /* silencioso */ }
    }
    void pollLocations();
    locationPollRef.current = setInterval(() => void pollLocations(), 30_000);
    return () => { if (locationPollRef.current) clearInterval(locationPollRef.current); };
  }, []);

  // El cartel "sin unidades" aparece sólo si la lista quedó vacía ~2s seguidos.
  // Si hay choferes, se oculta al instante. Así un vacío transitorio (carrera
  // polling/WS) no hace parpadear el cartel mientras hay un viaje en curso.
  useEffect(() => {
    if (driverLocations.length > 0) {
      setShowEmptyOverlay(false);
      return;
    }
    const t = setTimeout(() => setShowEmptyOverlay(true), 2000);
    return () => clearTimeout(t);
  }, [driverLocations.length]);

  // Mantenemos el cache a nivel módulo al día, para que al volver a la pestaña
  // del mapa se vea al instante lo último conocido (ver comentario arriba).
  useEffect(() => { cachedLocations = driverLocations; }, [driverLocations]);
  useEffect(() => { cachedRoutes = driverRoutes; }, [driverRoutes]);
  useEffect(() => { cachedTrips = assignedTrips; }, [assignedTrips]);

  // Si un chofer ya no está en la lista de posiciones (terminó el viaje, salió de
  // la app o expiró su ubicación a los 5 min), sacamos también su RECORRIDO. Sin
  // esto quedaba una ruta "huérfana" dibujada en el mapa sin ningún camión.
  useEffect(() => {
    const activeIds = new Set(driverLocations.map((d) => d.driver_app_user_id));
    setDriverRoutes((prev) => {
      const ids = Object.keys(prev);
      if (ids.every((id) => activeIds.has(id))) return prev; // nada huérfano
      const next: Record<string, RoutePathSegment[]> = {};
      for (const id of ids) if (activeIds.has(id)) next[id] = prev[id];
      return next;
    });
  }, [driverLocations]);

  // Fetch de viajes asignados + polling de respaldo (cada 30s). El WebSocket
  // (trip_update/trip_assigned) maneja el tiempo real; el polling es fallback.
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
    tripsPollRef.current = setInterval(() => void refreshTrips(), 30_000);
    return () => { if (tripsPollRef.current) clearInterval(tripsPollRef.current); };
  }, [refreshTrips]);

  // Tiempo real (WebSocket): hace que el mapa y los viajes se actualicen al
  // instante, sin esperar al polling. El polling de arriba queda como respaldo
  // (reconciliación) por si el socket se cae. Todos los eventos llegan ya
  // filtrados por empresa desde el backend.
  useRealtime((e) => {
    if (e.type === "driver_location") {
      const loc = e.location;
      // Reemplazamos la posición previa de ese chofer por la nueva (upsert).
      setDriverLocations((prev) => [
        ...prev.filter((d) => d.driver_app_user_id !== loc.driver_app_user_id),
        {
          driver_app_user_id: loc.driver_app_user_id,
          driver_name: loc.driver_name,
          truck_plate: loc.truck_plate,
          lat: loc.lat,
          lng: loc.lng,
        },
      ]);
      // Guardamos/actualizamos el recorrido del chofer si vino en el evento.
      if (loc.route) setDriverRoutes((prev) => ({ ...prev, [loc.driver_app_user_id]: loc.route! }));
    } else if (e.type === "driver_location_removed") {
      setDriverLocations((prev) => prev.filter((d) => d.driver_app_user_id !== e.driver_app_user_id));
      setDriverRoutes((prev) => {
        const next = { ...prev };
        delete next[e.driver_app_user_id];
        return next;
      });
    } else if (e.type === "trip_update" || e.type === "trip_assigned") {
      // Un viaje cambió (lo arrancó/completó un chofer, o se asignó): refrescamos
      // la lista para reflejarlo. Es poco frecuente, así que un refetch alcanza.
      void refreshTrips();
    }
  });

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

  // Choferes de la empresa que están navegando ahora (mandando GPS) y que NO
  // tienen un viaje asignado en curso → se muestran como "viaje en curso" en el
  // panel, además de los viajes asignados. Filtrar por `drivers` (los conductores
  // de esta empresa) deja afuera ubicaciones de otras empresas.
  const driverByAppUser = new Map(
    drivers.filter((d) => d.app_user_id).map((d) => [d.app_user_id as string, d]),
  );
  const inProgressDriverIds = new Set(
    assignedTrips.filter((t) => t.status === "in_progress").map((t) => t.driver_id),
  );
  const activeNavDrivers = driverLocations
    .map((loc) => ({ loc, drv: driverByAppUser.get(loc.driver_app_user_id) }))
    .filter((x) => x.drv && !inProgressDriverIds.has(x.drv.id))
    .map((x) => ({
      driver_app_user_id: x.loc.driver_app_user_id,
      driver_name: x.loc.driver_name,
      truck_plate: x.loc.truck_plate,
    }));

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
          driverRoutes={driverRoutes}
          originPin={originPin}
          destinationPin={destinationPin}
        />

        {/* Badge "En vivo": el mapa refleja las posiciones GPS en tiempo real */}
        <div
          style={{
            position: "absolute", top: 32, right: 32, zIndex: 500,
            display: "inline-flex", alignItems: "center", gap: 7,
            background: "rgba(255,255,255,0.96)", border: "1px solid var(--c-border)",
            borderRadius: 999, padding: "6px 12px",
            fontSize: "0.78rem", fontWeight: 700, color: "var(--c-ink)",
            boxShadow: "0 1px 4px rgba(16,24,40,0.10)", pointerEvents: "none",
          }}
        >
          <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#22c55e", opacity: 0.5, animation: "st-mappulse 1.8s ease-out infinite" }} />
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
          </span>
          En vivo
        </div>

        {/* Overlay "sin unidades": aparece cuando ningún chofer manda GPS.
            pointer-events:none → no bloquea el arrastre del mapa de fondo. */}
        {showEmptyOverlay && (
          <div
            style={{
              position: "absolute", inset: 20, zIndex: 400,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 18, pointerEvents: "none",
            }}
          >
            {/* Ícono flotante: círculo blanco limpio con un pulso muy suave */}
            <div style={{ position: "relative", width: 100, height: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ position: "absolute", inset: 6, borderRadius: "50%", background: "rgba(229,57,53,0.12)", animation: "st-mappulse 2.6s ease-out infinite" }} />
              <span style={{ position: "relative", width: 84, height: 84, borderRadius: "50%", background: "#fff", color: "#e53935", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 20px rgba(16,24,40,0.12)" }}>
                <Icons.Truck size={30} />
              </span>
            </div>

            {/* Card de texto translúcida (frosted): se ve el mapa a través, poco invasiva */}
            <div
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center",
                background: "rgba(255,255,255,0.74)",
                backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.6)", borderRadius: 16,
                padding: "18px 44px", maxWidth: 560,
                boxShadow: "0 10px 30px rgba(16,24,40,0.08)",
              }}
            >
              <p style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--c-ink)" }}>
                Sin unidades en circulación
              </p>
              <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.5, color: "var(--c-ink-2)" }}>
                Agregá camiones y conductores para verlos acá en tiempo real.
              </p>
            </div>
          </div>
        )}

        <style>{`@keyframes st-mappulse { 0% { transform: scale(0.85); opacity: 0.7; } 70% { transform: scale(1.25); opacity: 0; } 100% { transform: scale(0.85); opacity: 0; } }`}</style>
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
        {fleetLoading ? null : (
          <>
            {/* Bloque superior: onboarding (sin flota) o disparador de viaje */}
            {blocking ? (
              <EmptyStateManager
                hasTrucks={hasTrucks}
                hasAvailableDrivers={hasAvailableDrivers}
                hasAvailableTrucks={hasAvailableTrucks}
                onNavigate={onNavigate}
              />
            ) : (
              <>
                {!canCreate && (
                  <div style={{ marginBottom: 16 }}>
                    <EmptyStateManager
                      hasTrucks={hasTrucks}
                      hasAvailableDrivers={hasAvailableDrivers}
                      hasAvailableTrucks={hasAvailableTrucks}
                      onNavigate={onNavigate}
                    />
                  </div>
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
              </>
            )}

            {/* Viajes activos (lectura): siempre visible debajo, también durante
                el onboarding, para que el seguimiento en vivo tenga un lugar fijo. */}
            <section style={{ borderTop: "1px solid #f0f0f0", paddingTop: 20, marginTop: blocking ? 20 : 0 }}>
              <h2 className="st-section-title" style={{ marginBottom: 14 }}>Viajes activos</h2>
              <UpcomingTripsPanel trips={assignedTrips} loading={tripsLoading} activeDrivers={activeNavDrivers} />
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
