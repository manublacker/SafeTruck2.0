import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAvailability, type Trip } from "./useAvailability";
import MapDisplay, { type DriverLocation, type MapPin } from "./MapDisplay";
import EmptyStateManager from "./EmptyStateManager";
import TripCreator, { type ReadyAssignment } from "./TripCreator";
import UpcomingTripsPanel from "./UpcomingTripsPanel";
import type { AdminPage } from "./AdminSidebar";
import type { RouteResponse } from "@/types/route";
import type { Truck, Driver } from "@/types/auth";
import { fetchDriverLocations, fetchAssignedTrips, calculateRoute, createAssignedTrip, SubscriptionRequiredError, type AssignedTrip } from "@/services/api";
import { useRealtime, type RoutePathSegment } from "@/hooks/useRealtime";
import { sameAssignedTrip } from "@/lib/tripFormat";
import { reconcileById } from "@/lib/reconcile";
import { useToast } from "@/components/Toast";

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
  /** Viaje que se pidió "Ver viaje" desde otra sección: se dibuja su ruta en el mapa. */
  tripToShow?: AssignedTrip | null;
  onTripShown?: () => void;
}

// Extrae el RouteResponse guardado en assigned_trips.path. Puede venir como objeto
// (columna JSONB) o como string (columna TEXT). null si no hay ruta válida.
function parseTripRoute(path: AssignedTrip["path"]): RouteResponse | null {
  if (!path) return null;
  try {
    const obj = typeof path === "string" ? JSON.parse(path) : path;
    if (obj && Array.isArray((obj as RouteResponse).path)) return obj as RouteResponse;
  } catch { /* ruta inválida → null */ }
  return null;
}

function coordsToPin(lat: number | null | undefined, lon: number | null | undefined, label: string): MapPin | null {
  return lat != null && lon != null ? { lat, lon, label } : null;
}

export default function LiveMapContainer({ onNavigate, tripToShow, onTripShown }: Props) {
  const { user, drivers } = useAuth();
  const { showToast } = useToast();

  // ProtectedRoute no monta el Dashboard hasta que el AuthContext termina de
  // cargar el perfil (con trucks/drivers incluidos) → reusamos ese chunk en
  // vez de refetchear acá.
  const trucks = user?.trucks ?? [];
  const fleetLoading = user === null;

  const trips: Trip[] = [];
  const { availableTrucks, availableDrivers: activeDrivers } = useAvailability(trucks, drivers, trips);

  const [routeResult, setRouteResult]           = useState<RouteResponse | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [originPin, setOriginPin]               = useState<MapPin | null>(null);
  const [destinationPin, setDestinationPin]     = useState<MapPin | null>(null);
  const [driverLocations, setDriverLocations]   = useState<DriverLocation[]>(() => cachedLocations);
  // Recorrido (ruta) por chofer, sólo de WS (no del polling) → no titila al pollear.
  const [driverRoutes, setDriverRoutes]         = useState<Record<string, RoutePathSegment[]>>(() => cachedRoutes);
  const [assignedTrips, setAssignedTrips]       = useState<AssignedTrip[]>(() => cachedTrips);
  const [tripsLoading, setTripsLoading]         = useState(cachedTrips.length === 0);

  // Un conductor con un viaje EN CURSO no está disponible para asignarle otro:
  // sin esto, el creador de viajes lo ofrecía igual y se lo podía doble-asignar.
  const availableDrivers = useMemo(() => {
    const busyIds = new Set(
      assignedTrips.filter((t) => t.status === "in_progress").map((t) => t.driver_id),
    );
    return activeDrivers.filter((d) => !busyIds.has(d.id));
  }, [activeDrivers, assignedTrips]);
  const [creatorOpen, setCreatorOpen]           = useState(false);
  // Ruta calculada y lista para asignar: con esto mostramos la barra flotante
  // sobre el mapa (resumen + Asignar viaje + Cancelar) y cerramos el modal.
  const [pendingAssign, setPendingAssign]       = useState<ReadyAssignment | null>(null);
  const [assigning, setAssigning]               = useState(false);
  // Viaje que se está MIRANDO en el mapa (vía "Ver viaje"), para mostrar el
  // cartelito "estás viendo este viaje" con una X que vuelve a la vista en vivo.
  const [viewingTrip, setViewingTrip]           = useState<AssignedTrip | null>(null);

  const locationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripsPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  // Contador para ignorar recálculos viejos: si el usuario abre otro "Ver viaje"
  // mientras uno está en vuelo, el resultado tardío del anterior se descarta.
  const viewReqRef      = useRef(0);

  // Cierra el creador de viajes y LIMPIA la ruta de preview + los pines. Sin esto,
  // la ruta calculada en el modal quedaba dibujada para siempre en el Live Map
  // (que es de tracking en vivo), conviviendo con el overlay "sin unidades".
  const closeCreator = useCallback(() => {
    setCreatorOpen(false);
    setRouteResult(null);
    setOriginPin(null);
    setDestinationPin(null);
    setViewingTrip(null);
  }, []);

  // Vuelve a la vista en vivo: saca del mapa el viaje que se estaba mirando.
  const clearViewing = useCallback(() => {
    setViewingTrip(null);
    setRouteResult(null);
    setOriginPin(null);
    setDestinationPin(null);
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
      // El polling (cada 30s) trae la lista completa; reconciliamos para no
      // recrear todo el array cuando nada cambió (evita re-render del panel).
      setAssignedTrips((prev) => reconcileById(prev, data, sameAssignedTrip));
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
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeCreator(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creatorOpen, closeCreator]);

  // "Ver viaje": cuando llega un viaje desde otra sección, RECALCULAMOS la ruta en
  // el momento con las características ACTUALES del camión del viaje (así refleja
  // cualquier cambio de peso/altura/etc. hecho después de asignarlo). Mientras llega
  // el recálculo, mostramos al instante la ruta guardada (o, si no hay, los pines)
  // como base. Si el recálculo falla (sin permiso, sin ruta), queda la base.
  useEffect(() => {
    if (!tripToShow) return;
    // Esperamos a que cargue la flota: si no, `trucks` está vacío y no podríamos
    // recalcular con las specs del camión. Al terminar la carga el efecto re-corre.
    if (fleetLoading) return;
    const trip = tripToShow;
    onTripShown?.();                       // limpiamos el parent; ya capturamos `trip`
    setViewingTrip(trip);                  // mostramos el cartel "estás viendo…"
    setPendingAssign(null);                // mirar un viaje cancela cualquier preview de asignación
    const myReq = ++viewReqRef.current;

    // 1) Base inmediata: ruta guardada o, en su defecto, los extremos.
    const saved = parseTripRoute(trip.path);
    if (saved?.found && saved.path.length >= 2) {
      setRouteResult(saved);
      setOriginPin(null);
      setDestinationPin(null);
    } else {
      setRouteResult(null);
      setOriginPin(coordsToPin(trip.origin_lat, trip.origin_lon, trip.origin_label ?? "Origen"));
      setDestinationPin(coordsToPin(trip.destination_lat, trip.destination_lon, trip.destination_label ?? "Destino"));
    }

    // 2) Recálculo en vivo con las specs actuales del camión del viaje.
    const truck = trucks.find((t) => t.id === trip.truck_id);
    const hasCoords =
      trip.origin_lat != null && trip.origin_lon != null &&
      trip.destination_lat != null && trip.destination_lon != null;
    if (!truck || !hasCoords) return;

    void calculateRoute({
      originLabel:      trip.origin_label ?? "",
      destinationLabel: trip.destination_label ?? "",
      origin:      { lat: trip.origin_lat, lon: trip.origin_lon },
      destination: { lat: trip.destination_lat, lon: trip.destination_lon },
      vehicle: {
        maxWeightKg: truck.max_weight_kg,
        maxHeightM:  truck.max_height_m,
        maxWidthM:   truck.max_width_m,
        maxLengthM:  truck.max_length_m,
      },
      routingOptions: { avoidTolls: true, preferHighways: true },
    })
      .then((fresh) => {
        if (viewReqRef.current !== myReq) return;          // llegó otro "Ver viaje"
        if (fresh.found && fresh.path.length >= 2) {
          setRouteResult(fresh);
          setOriginPin(null);
          setDestinationPin(null);
        }
      })
      .catch(() => { /* sin permiso o sin ruta: dejamos la base ya mostrada */ });
  }, [tripToShow, onTripShown, fleetLoading, trucks]);

  // Confirma la asignación del viaje cuya ruta ya está calculada y dibujada.
  async function handleAssignPending() {
    if (!pendingAssign || assigning) return;
    const a = pendingAssign;
    setAssigning(true);
    try {
      await createAssignedTrip({
        driver_id:           a.driverId,
        truck_id:            a.truckId,
        origin_address:      a.result.originLabel,
        destination_address: a.result.destinationLabel,
        origin_lat:          a.result.originLat,
        origin_lng:          a.result.originLon,
        destination_lat:     a.result.destinationLat,
        destination_lng:     a.result.destinationLon,
        route:               a.result.route,
        scheduled_at:        a.scheduledAt,
      });
      showToast(`Viaje asignado a ${a.driverName}`, "success");
      // Limpiamos el dibujo de preview (ruta + pines): ya se asignó, el mapa
      // vuelve a mostrar solo los viajes en curso.
      setPendingAssign(null);
      setRouteResult(null);
      setOriginPin(null);
      setDestinationPin(null);
      setViewingTrip(null);
      void refreshTrips();
    } catch (err) {
      if (err instanceof SubscriptionRequiredError) {
        onNavigate("plans");
      } else {
        showToast(err instanceof Error ? err.message : "No se pudo asignar el viaje", "error");
      }
    } finally {
      setAssigning(false);
    }
  }

  // Descarta la ruta calculada sin asignar: limpia la barra y borra el dibujo.
  function handleCancelPending() {
    setPendingAssign(null);
    setRouteResult(null);
    setOriginPin(null);
    setDestinationPin(null);
    setViewingTrip(null);
  }

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
      className="live-map-grid"
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
      <div className="live-map-mapcol" style={{ position: "relative", padding: 20, background: "#fff", minHeight: 0 }}>
        {/* Cuando hay una ruta "enfocada" en el mapa —un viaje a asignar
            (pendingAssign) o uno que se está mirando (viewingTrip)— mostramos SOLO
            esa ruta: ocultamos los viajes en curso (posiciones + recorridos), así
            no se solapan si entra una ubicación nueva del chofer por WebSocket.
            Al asignar/cancelar o volver a "En vivo", reaparecen. */}
        <MapDisplay
          routeResponse={routeResult}
          driverLocations={pendingAssign || viewingTrip ? [] : driverLocations}
          driverRoutes={pendingAssign || viewingTrip ? {} : driverRoutes}
          originPin={originPin}
          destinationPin={destinationPin}
        />

        {/* Cartel "estás viendo este viaje": aparece al usar "Ver viaje". La X
            (o "Volver a en vivo") lo saca del mapa sin cambiar de pestaña. */}
        {viewingTrip && !pendingAssign && !creatorOpen && (
          <div
            style={{
              // left:72 para no taparse con los controles de zoom (+/−) del mapa.
              position: "absolute", top: 32, left: 72, right: 32, zIndex: 510,
              maxWidth: 440, display: "flex", alignItems: "center", gap: 12,
              background: "rgba(255,255,255,0.98)", border: "1px solid var(--c-border)",
              borderRadius: 14, padding: "10px 12px 10px 14px",
              boxShadow: "0 8px 24px -8px rgba(16,24,40,0.22), 0 1px 3px rgba(16,24,40,0.08)",
            }}
          >
            <span style={{
              flexShrink: 0, width: 36, height: 36, borderRadius: 10,
              background: "var(--c-accent-soft)", color: "var(--c-accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <div style={{ minWidth: 0, lineHeight: 1.25 }}>
              <div style={{ fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-ink-3)" }}>
                Estás viendo un viaje
              </div>
              <div
                title={`${viewingTrip.origin_label ?? "Origen"} → ${viewingTrip.destination_label ?? "Destino"}`}
                style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--c-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {viewingTrip.origin_label ?? "Origen"}
                <span style={{ color: "var(--c-ink-3)", margin: "0 5px" }}>→</span>
                {viewingTrip.destination_label ?? "Destino"}
              </div>
            </div>
            <button
              type="button"
              onClick={clearViewing}
              title="Volver a la vista en vivo"
              aria-label="Volver a la vista en vivo"
              style={{
                flexShrink: 0, marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
                height: 30, padding: "0 10px", borderRadius: 8,
                border: "1px solid var(--c-border)", background: "var(--c-bg)",
                color: "var(--c-ink-2)", fontSize: "0.8rem", fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              En vivo
            </button>
          </div>
        )}

        {/* Badge "En vivo": el mapa refleja las posiciones GPS en tiempo real.
            Se oculta mientras se mira un viaje (ahí no es "en vivo"; muestra el
            cartel de arriba) para no encimarse con él. */}
        {!(viewingTrip && !pendingAssign && !creatorOpen) && (
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
        )}

        {/* Barra flotante de asignación: aparece cuando se calculó una ruta. La
            ruta ya está dibujada en el mapa; acá se confirma o se cancela. */}
        {pendingAssign && (
          <div
            style={{
              position: "absolute", left: 20, right: 20, bottom: 24, zIndex: 600,
              display: "flex", justifyContent: "center", pointerEvents: "none",
            }}
          >
            <div
              style={{
                pointerEvents: "auto",
                display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                background: "#fff", border: "1px solid var(--c-border)", borderRadius: 14,
                boxShadow: "0 10px 30px rgba(16,24,40,0.16)", padding: "12px 16px",
                width: "100%", maxWidth: 680,
              }}
            >
              <div style={{ flex: 1, minWidth: 200, lineHeight: 1.4 }}>
                <div style={{ fontWeight: 700, color: "var(--c-ink)", fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {pendingAssign.result.originLabel} → {pendingAssign.result.destinationLabel}
                </div>
                <div style={{ color: "var(--c-ink-2)", fontSize: "0.82rem" }}>
                  {pendingAssign.driverName} · {(pendingAssign.result.route.distanceM / 1000).toFixed(1)} km · ~{pendingAssign.result.route.estimatedDurationMin} min
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="st-btn-ghost" onClick={handleCancelPending} disabled={assigning}>
                  Cancelar
                </button>
                <button
                  className="st-btn-cta"
                  style={{ minWidth: 140 }}
                  onClick={() => void handleAssignPending()}
                  disabled={assigning}
                >
                  {assigning ? "Asignando…" : "Asignar viaje"}
                </button>
              </div>
            </div>
          </div>
        )}

        <style>{`@keyframes st-mappulse { 0% { transform: scale(0.85); opacity: 0.7; } 70% { transform: scale(1.25); opacity: 0; } 100% { transform: scale(0.85); opacity: 0; } }`}</style>
      </div>

      {/* Panel derecho: solo lectura (operaciones) + disparador del modal */}
      <div
        className="scroll-y live-map-panel"
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
                  onClick={() => { handleCancelPending(); setCreatorOpen(true); }}
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

      {/* Modal de creación: aísla la carga de datos del mapa interactivo.
          No se cierra al tocar el backdrop: un click afuera (a veces sin
          querer, al mover el mouse) borraba toda la ruta ya cargada. Se
          cierra solo con la X o con Escape. */}
      {creatorOpen && (
        <div className="st-modal-backdrop">
          <div
            className="st-modal"
            style={{ maxWidth: 480, maxHeight: "88vh", overflowY: "auto", position: "relative" }}
          >
            <button
              aria-label="Cerrar"
              onClick={() => closeCreator()}
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
              availableDrivers={availableDrivers}
              assignedTruck={assignedTruck}
              selectedDriverId={selectedDriverId}
              onSelectDriver={setSelectedDriverId}
              onRouteCalculated={(r) => { setRouteResult(r); setOriginPin(null); setDestinationPin(null); setViewingTrip(null); }}
              onReadyToAssign={(a) => { setPendingAssign(a); setCreatorOpen(false); }}
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
