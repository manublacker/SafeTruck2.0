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

interface Props {
  routeResponse: RouteResponse | null;
}

function buildDestinationIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${ROUTE_COLOR};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default function MapDisplay({ routeResponse }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

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
    };
  }, []);

  // Render de la ruta
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    clearRouteLayers(polylineRef, markerRef);

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
