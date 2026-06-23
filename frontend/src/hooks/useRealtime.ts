/**
 * useRealtime — conexión WebSocket con el backend para eventos en vivo.
 *
 * Mantiene UNA conexión a /ws y entrega cada evento al callback `onEvent`.
 * Se reconecta sola con backoff exponencial si se cae. El token se toma de la
 * sesión de Supabase (que se auto-renueva en segundo plano), así no se vence en
 * sesiones largas del dashboard.
 *
 * El backend empuja estos eventos (ver src/backend/realtime/hub.ts y las rutas
 * de locations / assigned-trips), siempre aislados por empresa.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

export interface DriverLocationPayload {
  driver_app_user_id: string;
  driver_name: string | null;
  truck_plate: string | null;
  lat: number;
  lng: number;
  updated_at?: string;
}

export type RealtimeEvent =
  | { type: "connected"; role: "admin" | "driver"; companyId: string }
  | { type: "driver_location"; location: DriverLocationPayload }
  | { type: "driver_location_removed"; driver_app_user_id: string }
  | { type: "trip_update"; trip: Record<string, unknown> }
  | { type: "trip_assigned"; trip: Record<string, unknown> }
  | { type: "presence"; online_driver_ids: string[] };

// El WS vive en el mismo host que la API. Si VITE_API_URL apunta a Railway
// (prod), derivamos wss://...; si está vacío (dev, mismo origen vía proxy de
// Vite), usamos el host actual.
function wsUrl(): string {
  const base = (import.meta.env.VITE_API_URL ?? "") as string;
  if (base) return base.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

const MAX_BACKOFF_MS = 30_000;

export function useRealtime(onEvent: (e: RealtimeEvent) => void): void {
  // Guardamos el callback en un ref para tener siempre la última versión sin
  // reabrir el socket cada vez que el componente re-renderiza.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;

    async function connect() {
      if (disposed) return;
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { scheduleReconnect(); return; }

      ws = new WebSocket(`${wsUrl()}?token=${encodeURIComponent(token)}`);
      ws.onopen = () => { attempts = 0; };
      ws.onmessage = (ev) => {
        try {
          onEventRef.current(JSON.parse(ev.data) as RealtimeEvent);
        } catch { /* ignoramos mensajes que no sean JSON */ }
      };
      ws.onclose = () => { if (!disposed) scheduleReconnect(); };
      ws.onerror = () => { try { ws?.close(); } catch { /* ya cerrado */ } };
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempts);
      attempts++;
      reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, delay);
    }

    void connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* ya cerrado */ }
    };
  }, []);
}
