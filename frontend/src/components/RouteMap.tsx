/**
 * RouteMap.tsx
 *
 * Port de frontend/scripts/ui/mapRenderer.js.
 * Inicializa Leaflet, dibuja la ruta y rastrea la ubicación GPS.
 * Usa refs para no recrear el mapa en cada render.
 */

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteResponse } from "@/types/route";

const DEFAULT_CENTER: L.LatLngTuple = [-34.6037, -58.3816];
const DEFAULT_ZOOM = 11;

// ── Helpers de iconos ────────────────────────────────────────

function createMarkerIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:4px solid white;box-shadow:0 10px 20px rgba(15,23,42,.2);"></div>`,
    iconSize:   [20, 20],
    iconAnchor: [10, 10],
  });
}

function createRouteStartIcon(angle: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:74px;height:74px;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;width:74px;height:74px;border-radius:999px;background:radial-gradient(circle,rgba(31,102,73,0.22) 0%,rgba(31,102,73,0) 68%);"></div>
        <div style="position:absolute;width:56px;height:56px;border-radius:999px;background:rgba(255,255,255,0.92);border:2px solid rgba(31,102,73,0.14);box-shadow:0 14px 26px rgba(18,34,28,0.18);"></div>
        <div style="position:relative;z-index:2;width:50px;height:50px;transform:rotate(${angle}deg);border-radius:18px;background:linear-gradient(135deg,#1f6649 0%,#2f8b67 100%);display:flex;align-items:center;justify-content:center;color:white;font-size:24px;box-shadow:0 14px 26px rgba(18,34,28,0.18);">
          <div style="position:absolute;right:-10px;width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:17px solid #1f6649;"></div>
          <div style="transform:rotate(${-angle}deg);line-height:1;">🚚</div>
        </div>
      </div>`,
    iconSize:   [74, 74],
    iconAnchor: [37, 37],
  });
}

// ── Handle público (para focusRouteStart desde el padre) ──────

export interface RouteMapHandle {
  focusRouteStart: () => void;
}

// ── Componente ────────────────────────────────────────────────

interface Props {
  routeResponse: RouteResponse | null;
}

const RouteMap = forwardRef<RouteMapHandle, Props>(function RouteMap(
  { routeResponse },
  ref
) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<L.Map | null>(null);
  const routeRef      = useRef<L.Polyline | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const watchIdRef    = useRef<number | null>(null);
  const currentRoute  = useRef<RouteResponse | null>(null);

  // Exponer focusRouteStart al componente padre
  useImperativeHandle(ref, () => ({
    focusRouteStart() {
      const map   = mapRef.current;
      const route = currentRoute.current;
      if (!map || !route?.path?.length) return;
      const origin = route.path[0];
      map.setView([origin.lat, origin.lon], 17.5, { animate: true, duration: 0.8 });
    },
  }));

  // Inicializar mapa + GPS una sola vez
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    mapRef.current = map;

    // GPS tracking
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, heading } = pos.coords;
          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng([latitude, longitude]);
          } else {
            userMarkerRef.current = L.marker([latitude, longitude], {
              icon: createRouteStartIcon(heading ?? 0),
              zIndexOffset: 1000,
            }).addTo(map);
          }
        },
        (err) => console.warn("Geolocation:", err.message),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Actualizar ruta cuando cambia routeResponse
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    routeRef.current?.remove();
    destMarkerRef.current?.remove();
    routeRef.current      = null;
    destMarkerRef.current = null;
    currentRoute.current  = null;

    if (!routeResponse?.found || !routeResponse.path.length) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }

    currentRoute.current = routeResponse;
    const latLngs = routeResponse.path.map((p): L.LatLngTuple => [p.lat, p.lon]);
    const dest    = routeResponse.path[routeResponse.path.length - 1];

    routeRef.current = L.polyline(latLngs, {
      color: "#2563eb", weight: 7, opacity: 0.95,
    }).addTo(map);

    destMarkerRef.current = L.marker([dest.lat, dest.lon], {
      icon: createMarkerIcon("#dc2626"),
      title: dest.label,
    })
      .addTo(map)
      .bindPopup(`<strong>Destino</strong><br><span class="route-popup">${dest.label}</span>`);

    map.fitBounds(routeRef.current.getBounds(), { padding: [48, 48], maxZoom: 15 });
  }, [routeResponse]);

  return (
    <section className="map-shell">
      <div ref={containerRef} id="route-map" aria-label="Mapa de rutas SafeTruck" />
      <div className="map-overlay" />
      <div className="map-legend">
        <span className="legend-dot legend-route" />
        <span>Ruta sugerida</span>
      </div>
    </section>
  );
});

export default RouteMap;
