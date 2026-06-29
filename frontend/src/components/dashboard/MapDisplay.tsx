import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteResponse } from "@/types/route";
import { ACTIVE_TILE } from "@/lib/mapTiles";

const DEFAULT_CENTER: L.LatLngTuple = [-34.6037, -58.3816];
const DEFAULT_ZOOM = 11;
const ROUTE_COLOR = "#e53935";
// Coloreado por aptitud del tramo para el camión (mismo criterio que el motor
// de Aiven y que la app mobile): apto / no apto / sin datos.
const ROUTE_COLORS: Record<string, string> = {
  ok:           "#16a34a", // verde — apto
  unauthorized: "#e53935", // rojo  — no apto
  unknown:      "#f59e0b", // naranja — sin datos
};
const ROUTE_WEIGHT = 5;
const ROUTE_OPACITY = 0.9;
const FIT_PADDING: L.PointTuple = [48, 48];
const FIT_MAX_ZOOM = 15;
const INVALIDATE_DELAY_MS = 100;

const TILE_URL = ACTIVE_TILE.url;
const TILE_ATTRIBUTION = ACTIVE_TILE.attribution;
const TILE_MAX_ZOOM = ACTIVE_TILE.maxZoom;

export interface DriverLocation {
  driver_app_user_id: string;
  driver_name: string | null;
  truck_plate: string | null;
  lat: number;
  lng: number;
}

export interface MapPin {
  lat: number;
  lon: number;
  label: string;
}

/** Tramo del recorrido de un chofer (para dibujarlo coloreado por aptitud). */
export interface RoutePathSegment {
  coordinates: { lat: number; lng: number }[];
  status?: string;
}

interface Props {
  routeResponse: RouteResponse | null;
  driverLocations?: DriverLocation[];
  driverRoutes?: Record<string, RoutePathSegment[]>;
  originPin?: MapPin | null;
  destinationPin?: MapPin | null;
}

function buildDestinationIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${ROUTE_COLOR};border:3px solid white;box-shadow:0 1px 4px rgba(16,24,40,0.18);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function buildDriverIcon(label: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:#0d47a1;color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid white;box-shadow:0 1px 4px rgba(16,24,40,0.18);white-space:nowrap;position:relative;">
      🚛
      <div style="position:absolute;top:-21px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.96);color:#0f1b2d;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;pointer-events:none;border:1px solid rgba(15,27,45,0.14);">
        ${label}
      </div>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function buildOriginIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:#16a34a;border:3px solid white;box-shadow:0 1px 4px rgba(16,24,40,0.18);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Duración del deslizamiento del marcador del chofer entre dos posiciones (ms).
const DRIVER_ANIM_MS = 800;

/**
 * Desliza un marcador desde su posición actual hasta `to` interpolando con
 * requestAnimationFrame, en vez de saltar. `setFrameId` guarda el id del frame
 * en curso, para poder cancelarlo si llega una posición nueva antes de terminar.
 */
function animateMarker(
  marker: L.Marker,
  to: L.LatLngTuple,
  durationMs: number,
  setFrameId: (id: number | null) => void,
): void {
  const from = marker.getLatLng();
  const dLat = to[0] - from.lat;
  const dLng = to[1] - from.lng;
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs);
    marker.setLatLng([from.lat + dLat * t, from.lng + dLng * t]);
    if (t < 1) setFrameId(requestAnimationFrame(tick));
    else setFrameId(null);
  };
  setFrameId(requestAnimationFrame(tick));
}

export default function MapDisplay({ routeResponse, driverLocations = [], driverRoutes = {}, originPin, destinationPin }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayersRef = useRef<L.Polyline[]>([]);
  const markerRef = useRef<L.Marker | null>(null);
  const originMarkerRef = useRef<L.Marker | null>(null);
  const originPinRef = useRef<L.Marker | null>(null);
  const destPinRef = useRef<L.Marker | null>(null);
  const driverMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const driverAnimRef = useRef<Map<string, number>>(new Map());
  // Capas (polilíneas) del recorrido de cada chofer, por driver_app_user_id.
  const driverRouteLayersRef = useRef<Map<string, L.Polyline[]>>(new Map());

  // Inicialización + cleanup del mapa
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: TILE_MAX_ZOOM,
    }).addTo(map);

    mapRef.current = map;

    const handleResize = () => map.invalidateSize();
    window.addEventListener("resize", handleResize);

    // Asegura render correcto cuando el contenedor recién montado
    // todavía no tiene tamaño final (layouts con flex/transition).
    const invalidateTimer = window.setTimeout(
      () => map.invalidateSize(),
      INVALIDATE_DELAY_MS,
    );

    return () => {
      window.removeEventListener("resize", handleResize);
      window.clearTimeout(invalidateTimer);
      map.remove();
      mapRef.current = null;
      routeLayersRef.current = [];
      markerRef.current = null;
      originMarkerRef.current = null;
      driverMarkersRef.current.clear();
      driverAnimRef.current.forEach((id) => cancelAnimationFrame(id));
      driverAnimRef.current.clear();
      driverRouteLayersRef.current.clear();
    };
  }, []);

  // Render de marcadores de conductores en tiempo real
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const incoming = new Map(driverLocations.map((d) => [d.driver_app_user_id, d]));

    // Eliminar marcadores de conductores que ya no están activos
    driverMarkersRef.current.forEach((marker, id) => {
      if (!incoming.has(id)) {
        const anim = driverAnimRef.current.get(id);
        if (anim != null) { cancelAnimationFrame(anim); driverAnimRef.current.delete(id); }
        marker.remove();
        driverMarkersRef.current.delete(id);
      }
    });

    // Agregar o actualizar marcadores
    incoming.forEach((loc) => {
      const label = loc.truck_plate ?? loc.driver_name ?? "Driver";
      const existing = driverMarkersRef.current.get(loc.driver_app_user_id);
      if (existing) {
        // Deslizamos el marcador hasta la nueva posición (en vez de saltar).
        // Si había una animación en curso, la cancelamos y arrancamos de nuevo.
        const id = loc.driver_app_user_id;
        const prev = driverAnimRef.current.get(id);
        if (prev != null) cancelAnimationFrame(prev);
        animateMarker(existing, [loc.lat, loc.lng], DRIVER_ANIM_MS, (fid) => {
          if (fid == null) driverAnimRef.current.delete(id);
          else driverAnimRef.current.set(id, fid);
        });
        existing.setIcon(buildDriverIcon(label));
      } else {
        const marker = L.marker([loc.lat, loc.lng], {
          icon: buildDriverIcon(label),
          title: label,
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindPopup(`<strong>${loc.driver_name ?? "Conductor"}</strong><br/>${loc.truck_plate ?? ""}`);
        driverMarkersRef.current.set(loc.driver_app_user_id, marker);
      }
    });
  }, [driverLocations]);

  // Recorrido (ruta) de cada chofer en vivo, dibujado como polilíneas coloreadas
  // por aptitud del tramo (verde apto / rojo no apto / naranja sin datos), igual
  // que en la app del conductor. Llega por WebSocket en el evento driver_location.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layers = driverRouteLayersRef.current;

    // Sacar del mapa los recorridos de choferes que ya no tienen ruta activa.
    layers.forEach((polys, id) => {
      if (!driverRoutes[id]) {
        polys.forEach((p) => p.remove());
        layers.delete(id);
      }
    });

    // Dibujar/redibujar el recorrido de cada chofer con ruta.
    for (const [id, segments] of Object.entries(driverRoutes)) {
      const prev = layers.get(id);
      if (prev) prev.forEach((p) => p.remove());
      const polys: L.Polyline[] = [];
      for (const seg of segments) {
        const coords = (seg.coordinates ?? [])
          .map((c) => [c.lat, c.lng] as L.LatLngTuple);
        if (coords.length < 2) continue;
        const color = ROUTE_COLORS[seg.status ?? "unknown"] ?? ROUTE_COLORS.unknown;
        const poly = L.polyline(coords, {
          color,
          weight: ROUTE_WEIGHT,
          opacity: ROUTE_OPACITY,
          lineCap: "round",
          lineJoin: "round",
          dashArray: seg.status === "unauthorized" ? "10,8" : undefined,
        }).addTo(map);
        polys.push(poly);
      }
      layers.set(id, polys);
    }
  }, [driverRoutes]);

  // Pin de origen (preview antes de calcular ruta)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    originPinRef.current?.remove();
    originPinRef.current = null;
    if (!originPin) return;
    originPinRef.current = L.marker([originPin.lat, originPin.lon], {
      icon: buildOriginIcon(),
      title: originPin.label,
    }).addTo(map).bindPopup(`<strong>Origen</strong><br/>${originPin.label}`);
    map.flyTo([originPin.lat, originPin.lon], 14, { duration: 0.8 });
  }, [originPin]);

  // Pin de destino (preview antes de calcular ruta)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    destPinRef.current?.remove();
    destPinRef.current = null;
    if (!destinationPin) return;
    destPinRef.current = L.marker([destinationPin.lat, destinationPin.lon], {
      icon: buildDestinationIcon(),
      title: destinationPin.label,
    }).addTo(map).bindPopup(`<strong>Destino</strong><br/>${destinationPin.label}`);
    // Si ya hay origen, hacer fitBounds entre los dos puntos
    if (originPin) {
      map.flyToBounds(
        [[originPin.lat, originPin.lon], [destinationPin.lat, destinationPin.lon]],
        { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: 0.8 }
      );
    } else {
      map.flyTo([destinationPin.lat, destinationPin.lon], 14, { duration: 0.8 });
    }
  }, [destinationPin]);

  // Render de la ruta
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    clearRouteLayers(routeLayersRef, markerRef, originMarkerRef);
    // Los pins de preview se reemplazan con la ruta real
    originPinRef.current?.remove(); originPinRef.current = null;
    destPinRef.current?.remove();   destPinRef.current = null;

    if (!routeResponse?.found || routeResponse.path.length === 0) return;

    const path = routeResponse.path;
    const origin = path[0];
    const destination = path[path.length - 1];
    const allPoints: L.LatLngTuple[] = [];

    // Un polyline por tramo (nodo[i] → nodo[i+1]), coloreado por la aptitud de
    // ese tramo para el camión. Antes era una sola línea roja fija.
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const seg: L.LatLngTuple[] = [[a.lat, a.lon], [b.lat, b.lon]];
      const status = a.status ?? "unknown";
      const polyline = L.polyline(seg, {
        color: ROUTE_COLORS[status] ?? ROUTE_COLORS.unknown,
        weight: ROUTE_WEIGHT,
        opacity: ROUTE_OPACITY,
        lineCap: "round",
        lineJoin: "round",
        dashArray: status === "unauthorized" ? "10,8" : undefined,
      }).addTo(map);
      routeLayersRef.current.push(polyline);
      allPoints.push([a.lat, a.lon], [b.lat, b.lon]);
    }

    // Origen (verde) y destino (rojo).
    originMarkerRef.current = L.marker([origin.lat, origin.lon], {
      icon: buildOriginIcon(),
      title: origin.label,
    })
      .addTo(map)
      .bindPopup(`<strong>Origen</strong><br/>${origin.label}`);

    markerRef.current = L.marker([destination.lat, destination.lon], {
      icon: buildDestinationIcon(),
      title: destination.label,
    })
      .addTo(map)
      .bindPopup(`<strong>Destino</strong><br/>${destination.label}`);

    if (allPoints.length > 0) {
      map.fitBounds(L.latLngBounds(allPoints), {
        padding: FIT_PADDING,
        maxZoom: FIT_MAX_ZOOM,
      });
    }
  }, [routeResponse]);

  return (
    <div
      ref={containerRef}
      className="st-map-container"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function clearRouteLayers(
  routeLayersRef: React.MutableRefObject<L.Polyline[]>,
  markerRef: React.MutableRefObject<L.Marker | null>,
  originMarkerRef: React.MutableRefObject<L.Marker | null>,
) {
  routeLayersRef.current.forEach((l) => l.remove());
  routeLayersRef.current = [];
  markerRef.current?.remove();
  markerRef.current = null;
  originMarkerRef.current?.remove();
  originMarkerRef.current = null;
}
