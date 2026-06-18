import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteResponse } from "@/types/route";

const DEFAULT_CENTER: L.LatLngTuple = [-34.6037, -58.3816];
const DEFAULT_ZOOM = 11;
const ROUTE_COLOR = "#e53935";
const ROUTE_WEIGHT = 5;
const ROUTE_OPACITY = 0.9;
const FIT_PADDING: L.PointTuple = [48, 48];
const FIT_MAX_ZOOM = 15;
const INVALIDATE_DELAY_MS = 100;

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const TILE_MAX_ZOOM = 19;

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

interface Props {
  routeResponse: RouteResponse | null;
  driverLocations?: DriverLocation[];
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

export default function MapDisplay({ routeResponse, driverLocations = [], originPin, destinationPin }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const originPinRef = useRef<L.Marker | null>(null);
  const destPinRef = useRef<L.Marker | null>(null);
  const driverMarkersRef = useRef<Map<string, L.Marker>>(new Map());

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
      polylineRef.current = null;
      markerRef.current = null;
      driverMarkersRef.current.clear();
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
        marker.remove();
        driverMarkersRef.current.delete(id);
      }
    });

    // Agregar o actualizar marcadores
    incoming.forEach((loc) => {
      const label = loc.truck_plate ?? loc.driver_name ?? "Driver";
      const existing = driverMarkersRef.current.get(loc.driver_app_user_id);
      if (existing) {
        existing.setLatLng([loc.lat, loc.lng]);
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

    clearRouteLayers(polylineRef, markerRef);
    // Los pins de preview se reemplazan con la ruta real
    originPinRef.current?.remove(); originPinRef.current = null;
    destPinRef.current?.remove();   destPinRef.current = null;

    if (!routeResponse?.found || routeResponse.path.length === 0) return;

    const latLngs = routeResponse.path.map(
      (p): L.LatLngTuple => [p.lat, p.lon],
    );
    const destination = routeResponse.path[routeResponse.path.length - 1];

    const polyline = L.polyline(latLngs, {
      color: ROUTE_COLOR,
      weight: ROUTE_WEIGHT,
      opacity: ROUTE_OPACITY,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
    polylineRef.current = polyline;

    const marker = L.marker([destination.lat, destination.lon], {
      icon: buildDestinationIcon(),
      title: destination.label,
    })
      .addTo(map)
      .bindPopup(`<strong>Destino</strong><br/>${destination.label}`);
    markerRef.current = marker;

    map.fitBounds(polyline.getBounds(), {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
    });
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
  polylineRef: React.MutableRefObject<L.Polyline | null>,
  markerRef: React.MutableRefObject<L.Marker | null>,
) {
  polylineRef.current?.remove();
  markerRef.current?.remove();
  polylineRef.current = null;
  markerRef.current = null;
}
