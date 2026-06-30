/**
 * realtime.ts — conexión WebSocket de la app móvil para eventos en vivo.
 *
 * Mantiene UNA conexión a /ws del backend y entrega cada evento al callback.
 * Se reconecta sola con backoff exponencial si se cae. El token sale de la
 * sesión de Supabase (que se auto-renueva), así no se vence en sesiones largas.
 *
 * Para el conductor, los eventos relevantes son:
 *   - trip_assigned: la empresa le asignó un viaje nuevo (aparece sin refrescar).
 *   - trip_update:   un viaje cambió de estado.
 *   - truck_update:  la empresa le cambió/quitó el camión asignado (re-fetch).
 * (driver_location va sólo a los admins; el conductor no lo recibe.)
 */
import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://safetruck20-production.up.railway.app').replace(/\/$/, '')

export type RealtimeEvent =
  | { type: 'connected'; role: 'admin' | 'driver'; companyId: string }
  | { type: 'trip_assigned'; trip: Record<string, unknown> }
  | { type: 'trip_update'; trip: Record<string, unknown> }
  | { type: 'truck_update' }
  | { type: 'driver_location'; location: Record<string, unknown> }
  | { type: 'driver_location_removed'; driver_app_user_id: string }

function wsUrl(): string {
  return API_URL.replace(/^http/, 'ws') + '/ws'
}

const MAX_BACKOFF_MS = 30_000

export function useRealtime(onEvent: (e: RealtimeEvent) => void): void {
  // Ref para tener siempre el último callback sin reabrir el socket en cada render.
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let disposed = false

    async function connect() {
      if (disposed) return
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) { scheduleReconnect(); return }

      ws = new WebSocket(`${wsUrl()}?token=${encodeURIComponent(token)}`)
      ws.onopen = () => { attempts = 0 }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String((ev as { data: unknown }).data)) as RealtimeEvent
          onEventRef.current(msg)
        } catch { /* ignoramos mensajes que no sean JSON */ }
      }
      ws.onclose = () => { if (!disposed) scheduleReconnect() }
      ws.onerror = () => { try { ws?.close() } catch { /* ya cerrado */ } }
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return
      const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempts)
      attempts++
      reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect() }, delay)
    }

    void connect()
    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try { ws?.close() } catch { /* ya cerrado */ }
    }
  }, [])
}
