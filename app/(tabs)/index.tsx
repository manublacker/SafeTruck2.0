import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  Modal, ScrollView, TextInput, Keyboard, Platform,
} from 'react-native'
import MapView, { Marker, Polyline, Region } from 'react-native-maps'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { supabase } from '../../src/services/supabase'
import { Theme, getTheme, isDarkTheme } from '../../src/theme'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { fetchAllMyTrips, updateTripStatus, sendLocation, clearLocation, fetchMyAssignedTruck, isSubscriptionError, SUBSCRIPTION_INACTIVE_MESSAGE, type AssignedTrip } from '../../src/services/assignedTrips'
import { getRecentDestinations, addRecentDestination, type RecentDest } from '../../src/services/recentDestinations'

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const BACKEND = (process.env.EXPO_PUBLIC_API_URL ?? 'https://safetruck20-production.up.railway.app').replace(/\/$/, '')

// ─────────────────────────────────────────────────────────────────────────────
// DENUNCIAS / REPORTES — arquitectura de doble escritura (a propósito)
// ─────────────────────────────────────────────────────────────────────────────
// Cuando un chofer denuncia una calle (reportIncident), escribimos en DOS bases:
//
//   1) Supabase (st_incidents)  -> CAPA VISUAL efímera. Marcador tipo Waze con
//      realtime + expiración que ven otros choferes. NO afecta el ruteo.
//
//   2) Backend Aiven (POST /reports) -> CAPA DE PESO. Snapea a la arista de
//      pgr_edges más cercana y acumula pgr_edges.denuncia_penalty por umbral.
//      El motor real de ruteo (pgr_route_truck, vía POST /route) suma esa
//      penalización al costo => en la próxima ruta esquiva/bloquea la arista.
//      (Umbral/penalización en src/backend/migrations/003_denuncia_penalty_pgr.sql.
//       OJO: 002 quedó obsoleta — apuntaba a un motor viejo aristas/A* sin uso.)
//
// El chofer elige la ubicación a denunciar de dos maneras (selector en el modal):
//   📍 "Donde estoy"  -> GPS actual (la arista donde está parado)
//   🔍 "Buscar calle" -> buscador interno (Nominatim); snapea esa dirección
// En ambos casos sólo se produce un lat/lon; el backend resuelve la arista.
// ─────────────────────────────────────────────────────────────────────────────

const INCIDENT_TYPES = [
  { key: 'multa',            label: '💸 Multa a camión',    creates_block: true  },
  { key: 'control_policial', label: '👮 Control policial',  creates_block: false },
  { key: 'accidente',        label: '🚨 Accidente',         creates_block: false },
  { key: 'obra',             label: '🚧 Obras',             creates_block: false },
  { key: 'puente_bajo',      label: '🌉 Puente bajo',       creates_block: true  },
  { key: 'corte',            label: '🚫 Calle cerrada',     creates_block: true  },
  { key: 'control_peso',     label: '⚖️ Control de peso',  creates_block: false },
]

// Emojis por tipo de incidente para el marker en el mapa (mismo set que usaba
// el HTML de Leaflet, ahora renderizado como children de <Marker> nativo).
const INCIDENT_ICONS: Record<string, string> = {
  multa: '💸', control_policial: '👮', accidente: '🚨',
  obra: '🚧', puente_bajo: '🌉', corte: '🚫',
  control_peso: '⚖️', otro: '⚠️', trafico: '🚗', objeto_en_via: '⚠️'
}

// Parsea la ubicación de un incidente que puede venir como string PostGIS
// "POINT(lng lat)" o como GeoJSON {coordinates: [lng, lat]}.
function parseIncidentLocation(location: any): { lat: number; lng: number } | null {
  if (!location) return null
  if (typeof location === 'string') {
    const m = location.match(/POINT\(([\d.-]+) ([\d.-]+)\)/)
    if (m) return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) }
    return null
  }
  if (location.coordinates) {
    return { lng: location.coordinates[0], lat: location.coordinates[1] }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRACIÓN A MAPA NATIVO (Apple Maps en iOS / Google Maps en Android)
// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 1: solo mapa base + ubicación + tap-to-destino.
// Lo que sigue comentado abajo (MAP_HTML, drawRoute, addIncidentMarker, sim*,
// nav*) es la implementación vieja en Leaflet. La dejamos como referencia para
// portarla en las próximas etapas (ruta coloreada, incidentes, simulación,
// navegación con rotación de cámara). NO BORRAR todavía.
// ─────────────────────────────────────────────────────────────────────────────

/*
const MAP_HTML = `
... (todo el HTML/JS de Leaflet que tenías antes va acá, sin cambios,
     comentado como bloque para no perderlo de referencia en las próximas etapas) ...
`
*/

const DEFAULT_REGION: Region = {
  latitude: -34.6037,
  longitude: -58.3816,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
}

export default function MapScreen() {
  const mapRef = useRef<MapView>(null)
  const searchTimeout = useRef<any>(null)
  const reportSearchTimeout = useRef<any>(null)
  const originSearchTimeout = useRef<any>(null)

  const isDark = useStore(st => st.isDark)
  const toggleTheme = useStore(st => st.toggleTheme)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])
  const insets = useSafeAreaInsets()

  const { activeVehicle, currentRoute, setCurrentRoute, setOrigin, setDestination, setActiveVehicle } = useStore()
  const profile = useStore(st => st.profile)

  // Cargar camión asignado al montar el mapa (por si el conductor no pasó por Perfil)
  useEffect(() => {
    // Solo seteamos si hay camión: una respuesta vacía (o un fallo de red) NO
    // debe pisar el vehículo que ya pudo haber cargado la pantalla de Perfil,
    // porque eso dispararía el banner "sin camión" y bloquearía el ruteo.
    fetchMyAssignedTruck().then(truck => {
      if (!truck) return
      setActiveVehicle({
        id:         String(truck.id),
        user_id:    '',
        plate:      truck.patente ?? '',
        name:       truck.name,
        weight_kg:  truck.max_weight_kg,
        height_m:   truck.max_height_m,
        width_m:    truck.max_width_m,
        length_m:   truck.max_length_m,
        axles:      0,
        is_default: true,
        created_at: '',
      })
    }).catch(() => null)
  }, [])

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [destMarker, setDestMarker] = useState<{ lat: number; lng: number } | null>(null)
  const [incidents, setIncidents] = useState<{ id: string; type: string; lat: number; lng: number }[]>([])
  // ETAPA 4: ruta del viaje asignado, dibujada en el mapa.
  // tripSegments = ruta recalculada y coloreada (preferido). Si no se puede
  // recalcular, tripStoredPath = el path guardado del viaje (línea azul fija).
  const [tripSegments, setTripSegments] = useState<any[] | null>(null)
  const [tripStoredPath, setTripStoredPath] = useState<{ lat: number; lon?: number; lng?: number }[]>([])
  const [tripOriginDest, setTripOriginDest] = useState<{ originLat: number | null; originLng: number | null; destLat: number | null; destLng: number | null }>({ originLat: null, originLng: null, destLat: null, destLng: null })
  const [loading, setLoading] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [showIncidentModal, setShowIncidentModal] = useState(false)
  const [incidentLocation, setIncidentLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [reportingIncident, setReportingIncident] = useState(false)

  // Modo de ubicación de la denuncia: 'current' = GPS del chofer, 'search' = calle buscada.
  const [reportLocMode, setReportLocMode] = useState<'current' | 'search'>('current')
  const [reportSearchText, setReportSearchText] = useState('')
  const [reportSearchResults, setReportSearchResults] = useState<any[]>([])
  const [reportSearching, setReportSearching] = useState(false)

  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [recents, setRecents] = useState<RecentDest[]>([])

  // Origen del ruteo. Por defecto (null) se usa la ubicación GPS del chofer.
  // Si elige una dirección en "Salir desde…", queda como override del origen.
  const [originOverride, setOriginOverride] = useState<{ lat: number; lng: number; label: string } | null>(null)
  const [originText, setOriginText] = useState('')
  const [originResults, setOriginResults] = useState<any[]>([])
  const [originSearching, setOriginSearching] = useState(false)
  const [showOriginSearch, setShowOriginSearch] = useState(false)
  const [navMode, setNavMode] = useState(false)
  const watchRef = useRef<any>(null)

  // ── Simulación de recorrido ──────────────────────────────────────────────
  // Anima un marcador a lo largo de `path` interpolando por segmentos, igual
  // que simStart/simTick/simRender hacían en Leaflet. El timer corre acá en
  // JS (setInterval) y actualiza estado de React en cada tick.
  const [simRunning, setSimRunning] = useState(false)
  const [simPaused, setSimPaused] = useState(false)
  const [simSpeed, setSimSpeed] = useState(40) // km/h
  const simSpeedRef = useRef(40)
  const tripPathRef = useRef<{ lat: number; lon?: number; lng?: number }[]>([])
  const tripSegmentsRef = useRef<any[] | null>(null)
  const SIM_SPEEDS = [10, 40, 80]
  const SIM_TICK_MS = 100

  // Posición/heading actuales del marcador animado (null = sin simulación activa)
  const [simPosition, setSimPosition] = useState<{ lat: number; lng: number; heading: number | null } | null>(null)
  // Progreso de la simulación (índice + fracción dentro del segmento actual),
  // usado para recortar la polyline: gris atrás, color vivo adelante.
  const [simProgress, setSimProgress] = useState<{ idx: number; frac: number } | null>(null)
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Estado mutable de la simulación en curso (path, índice actual, fracción
  // del segmento recorrida). Usamos ref porque se actualiza en cada tick de
  // 100ms y no necesitamos re-renders por estos campos, solo por simPosition.
  const simDataRef = useRef<{ path: [number, number][]; idx: number; frac: number } | null>(null)

  const simHaversine = (a: [number, number], b: [number, number]) => {
    const R = 6371000
    const dLat = (b[0] - a[0]) * Math.PI / 180
    const dLng = (b[1] - a[1]) * Math.PI / 180
    const la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180
    const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2)
    return 2 * R * Math.asin(Math.sqrt(x))
  }

  const simBearing = (a: [number, number], b: [number, number]) => {
    const la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180
    const y = Math.sin(dLng) * Math.cos(la2)
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
  }

  // Recorta un array de segmentos coloreados {coordinates, status} en dos
  // partes según el progreso de la simulación (idx/frac sobre el path plano
  // combinado): lo ya recorrido (para pintar gris, "atrás") y lo restante
  // (mantiene los colores reales verde/rojo/naranja, "adelante"). Estilo
  // Waze/Google Maps: el camino recorrido se ve tenue detrás del vehículo.
  const splitSegmentsByProgress = (
    segments: any[],
    progress: { idx: number; frac: number } | null
  ): { passed: { latitude: number; longitude: number }[]; remaining: any[] } => {
    if (!progress) return { passed: [], remaining: segments }
    let pointCounter = 0
    const passed: { latitude: number; longitude: number }[] = []
    const remaining: any[] = []
    for (const seg of segments) {
      const coords = seg.coordinates ?? []
      const segRemaining: { lat: number; lng: number }[] = []
      for (let i = 0; i < coords.length; i++) {
        // Cada punto del path plano corresponde, en orden, a un punto de
        // algún segmento. pointCounter avanza igual que simDataRef.current.idx.
        if (pointCounter < progress.idx) {
          passed.push({ latitude: coords[i].lat, longitude: coords[i].lng })
        } else if (pointCounter === progress.idx && i < coords.length - 1) {
          // Punto exacto donde está el vehículo ahora: lo partimos por frac.
          const a = coords[i], b = coords[i + 1]
          const interpLat = a.lat + (b.lat - a.lat) * progress.frac
          const interpLng = a.lng + (b.lng - a.lng) * progress.frac
          passed.push({ latitude: a.lat, longitude: a.lng })
          segRemaining.push({ lat: interpLat, lng: interpLng }, b)
        } else {
          segRemaining.push(coords[i])
        }
        if (i < coords.length - 1) pointCounter++
      }
      if (segRemaining.length >= 2) remaining.push({ ...seg, coordinates: segRemaining })
    }
    return { passed, remaining }
  }

  // ── Trip visualization (navegado desde Viajes) ─────────────────────────
  const { tripId } = useLocalSearchParams<{ tripId?: string }>()
  const router = useRouter()
  const [tripSheet, setTripSheet] = useState<AssignedTrip | null>(null)
  const [tripUpdating, setTripUpdating] = useState(false)
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const routeAbortRef = useRef<AbortController | null>(null)

  // Dibuja la ruta del viaje con el path GUARDADO (línea azul fija). Fallback
  // cuando no se puede recalcular (sin camión asignado, sin coords o sin red).
  const drawStoredTripPath = useCallback((trip: AssignedTrip) => {
    const path = (() => {
      try {
        const p = typeof trip.path === 'string' ? JSON.parse(trip.path) : trip.path
        return (p?.path || p?.polyline || p?.segments?.flatMap((s: any) => s.coordinates) || []) as { lat: number; lon?: number; lng?: number }[]
      } catch { return [] }
    })()
    tripSegmentsRef.current = null
    tripPathRef.current = path
    setTripSegments(null)
    setTripStoredPath(path)
    setTripOriginDest({
      originLat: trip.origin_lat ?? null, originLng: trip.origin_lon ?? null,
      destLat: trip.destination_lat ?? null, destLng: trip.destination_lon ?? null,
    })
    if (path.length > 0 && mapRef.current) {
      mapRef.current.fitToCoordinates(
        path.map((p) => ({ latitude: p.lat, longitude: (p.lon ?? p.lng) as number })),
        { edgePadding: { top: 100, right: 60, bottom: 280, left: 60 }, animated: true }
      )
    }
  }, [])

  // Recalcula la ruta del viaje en el momento (origen → destino) con el camión
  // del conductor y la dibuja coloreada por tramo (verde apto / rojo no apto).
  // Usa el MISMO motor (Aiven, /route) que el ruteo en vivo. Devuelve true si lo logró.
  const drawColoredTripRoute = useCallback(async (trip: AssignedTrip): Promise<boolean> => {
    const oLat = trip.origin_lat, oLng = trip.origin_lon
    const dLat = trip.destination_lat, dLng = trip.destination_lon
    if (oLat == null || oLng == null || dLat == null || dLng == null) return false
    const vehicle = useStore.getState().activeVehicle
    if (!vehicle) return false

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)
    try {
      const res = await fetch(`${BACKEND}/route`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: oLat, lng: oLng },
          destination: { lat: dLat, lng: dLng },
          vehicle: { weight_kg: vehicle.weight_kg, height_m: vehicle.height_m, width_m: vehicle.width_m },
        }),
      })
      const data = await res.json().catch(() => ({}))
      const segments = data?.route?.segments
      if (!res.ok || !Array.isArray(segments) || segments.length === 0) return false
      tripSegmentsRef.current = segments
      tripPathRef.current = segments.flatMap((sg: any) => sg.coordinates ?? [])
      setTripSegments(segments)
      setTripStoredPath([])
      setTripOriginDest({ originLat: oLat, originLng: oLng, destLat: dLat, destLng: dLng })
      const allCoords = segments.flatMap((sg: any) => sg.coordinates ?? []).map((c: any) => ({ latitude: c.lat, longitude: c.lng }))
      if (allCoords.length > 0 && mapRef.current) {
        mapRef.current.fitToCoordinates(allCoords, {
          edgePadding: { top: 100, right: 60, bottom: 280, left: 60 },
          animated: true,
        })
      }
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timeoutId)
    }
  }, [])

  const loadTripById = useCallback(async (id: string) => {
    // Cancela cualquier cálculo de ruta manual que esté en curso.
    routeAbortRef.current?.abort()
    routeAbortRef.current = null
    setLoading(false)
    // Limpia cualquier búsqueda activa para que no quede solapada con el viaje.
    stopSimulation()
    stopNavigation()
    setCurrentRoute(null)
    setDestMarker(null)
    setSearchText('')
    setShowInfo(false)
    setTripSegments(null)
    setTripStoredPath([])
    setTripOriginDest({ originLat: null, originLng: null, destLat: null, destLng: null })
    try {
      const all = await fetchAllMyTrips()
      const found = all.find(t => String(t.id) === id)
      if (!found) {
        Alert.alert('Viaje no disponible', 'No encontramos ese viaje. Puede que haya cambiado o ya no esté asignado a vos.')
        return
      }
      setTripSheet(found)
      const colored = await drawColoredTripRoute(found)
      if (!colored) drawStoredTripPath(found)
    } catch {
      Alert.alert('Error', 'No se pudo cargar el viaje. Revisá tu conexión e intentá de nuevo.')
    }
  }, [drawColoredTripRoute, drawStoredTripPath])

  // Liberar la suscripción de GPS de alta precisión y el timer de simulación
  // si el componente se desmonta (cambio de tab / logout).
  useEffect(() => () => {
    watchRef.current?.remove?.()
    watchRef.current = null
    if (simIntervalRef.current) { clearInterval(simIntervalRef.current); simIntervalRef.current = null }
  }, [])

  useEffect(() => {
    if (tripId) {
      void loadTripById(tripId)
    } else {
      setTripSheet(null)
      // ── Limpiar la ruta del viaje asignado del mapa ──────────────────
      // Sin esto, al cerrar el sheet las Polylines quedan renderizadas para siempre.
      tripSegmentsRef.current = null
      tripPathRef.current = []
      setTripSegments(null)
      setTripStoredPath([])
      setTripOriginDest({ originLat: null, originLng: null, destLat: null, destLng: null })
      // ─────────────────────────────────────────────────────────────────
      if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null }
    }
  }, [tripId])

  // ── Simulación de recorrido (ETAPA 6 — todavía no migrada) ──────────────
  const simPathLatLng = (): [number, number][] => {
    const segs = (currentRoute as any)?.segments as { coordinates?: { lat: number; lng: number }[] }[] | undefined
    if (segs?.length) {
      const pts: [number, number][] = []
      for (const sg of segs) for (const c of (sg.coordinates ?? [])) pts.push([c.lat, c.lng])
      if (pts.length >= 2) return pts
    }
    const tp = tripPathRef.current
    if (tp.length >= 2) return tp.map(p => [p.lat, (p.lon ?? p.lng) as number])
    return []
  }

  // Detiene el timer sin tocar el resto del estado (uso interno, para cuando
  // la simulación termina sola al llegar al final del recorrido).
  const stopSimulationInternal = () => {
    if (simIntervalRef.current) { clearInterval(simIntervalRef.current); simIntervalRef.current = null }
    setSimRunning(false)
    setSimPaused(false)
  }

  // Un paso de la simulación: avanza la distancia recorrida en SIM_TICK_MS
  // según la velocidad actual, interpolando entre los puntos del path.
  // Lee `simPaused` desde un ref (no desde el closure) para que el
  // setInterval, que se crea una sola vez en startSimulation, siempre vea
  // el valor de pausa más reciente sin necesidad de recrear el interval.
  const simPausedRef = useRef(false)
  useEffect(() => { simPausedRef.current = simPaused }, [simPaused])

  const simTick = useCallback(() => {
    const s = simDataRef.current
    if (!s || simPausedRef.current) return
    const path = s.path
    if (s.idx >= path.length - 1) {
      stopSimulationInternal()
      return
    }
    let meters = simSpeedRef.current * 1000 / 3600 * (SIM_TICK_MS / 1000)
    while (meters > 0 && s.idx < path.length - 1) {
      const a = path[s.idx], b = path[s.idx + 1]
      const segLen = simHaversine(a, b)
      if (segLen < 0.01) { s.idx++; s.frac = 0; continue }
      const distLeft = segLen * (1 - s.frac)
      if (distLeft > meters) { s.frac += meters / segLen; meters = 0 }
      else { meters -= distLeft; s.idx++; s.frac = 0 }
    }
    if (s.idx >= path.length - 1) {
      const last = path[path.length - 1], prev = path[path.length - 2]
      setSimPosition({ lat: last[0], lng: last[1], heading: simBearing(prev, last) })
      setSimProgress({ idx: s.idx, frac: 0 })
      stopSimulationInternal()
      return
    }
    const a2 = path[s.idx], b2 = path[s.idx + 1]
    const lat = a2[0] + (b2[0] - a2[0]) * s.frac
    const lng = a2[1] + (b2[1] - a2[1]) * s.frac
    const heading = simBearing(a2, b2)
    setSimPosition({ lat, lng, heading })
    setSimProgress({ idx: s.idx, frac: s.frac })
    mapRef.current?.animateCamera(
      { center: { latitude: lat, longitude: lng }, heading, pitch: 45, zoom: 17 },
      { duration: SIM_TICK_MS }
    )
  }, [])

  const startSimulation = () => {
    const path = simPathLatLng()
    if (path.length < 2) {
      Alert.alert('Simulación', 'No hay una ruta para simular. Tocá un destino o iniciá un viaje asignado.')
      return
    }
    if (simIntervalRef.current) { clearInterval(simIntervalRef.current); simIntervalRef.current = null }
    simDataRef.current = { path, idx: 0, frac: 0 }
    setSimRunning(true)
    setSimPaused(false)
    setShowInfo(false)
    const start = path[0], next = path[1]
    setSimPosition({ lat: start[0], lng: start[1], heading: simBearing(start, next) })
    setSimProgress({ idx: 0, frac: 0 })
    mapRef.current?.animateCamera(
      { center: { latitude: start[0], longitude: start[1] }, zoom: 17, pitch: 45, heading: simBearing(start, next) },
      { duration: 600 }
    )
    simIntervalRef.current = setInterval(simTick, SIM_TICK_MS)
  }

  const stopSimulation = () => {
    if (simIntervalRef.current) { clearInterval(simIntervalRef.current); simIntervalRef.current = null }
    setSimRunning(false)
    setSimPaused(false)
    setSimPosition(null)
    setSimProgress(null)
    simDataRef.current = null
    // Restaurar vista normal (sin inclinación de simulación)
    if (location && mapRef.current) {
      mapRef.current.animateCamera(
        { center: { latitude: location.lat, longitude: location.lng }, pitch: 0, heading: 0 },
        { duration: 500 }
      )
    }
  }

  const toggleSimPause = () => {
    setSimPaused(p => !p)
  }

  const cycleSimSpeed = () => {
    setSimSpeed(prev => {
      const next = SIM_SPEEDS[(SIM_SPEEDS.indexOf(prev) + 1) % SIM_SPEEDS.length]
      simSpeedRef.current = next
      return next
    })
  }

  // Repinta en el mapa la ruta del viaje (por si se había limpiado al completar
  // un viaje previo). Como el dibujo depende del estado de React, esto solo
  // necesita restaurar tripSegments/tripStoredPath si quedaron vacíos.
  const redrawTrip = (trip: AssignedTrip | null = tripSheet) => {
    if (!trip) return
    if (tripSegmentsRef.current) {
      setTripSegments(tripSegmentsRef.current)
      setTripOriginDest({
        originLat: trip.origin_lat ?? null, originLng: trip.origin_lon ?? null,
        destLat: trip.destination_lat ?? null, destLng: trip.destination_lon ?? null,
      })
    } else if (tripPathRef.current.length > 0) {
      setTripStoredPath(tripPathRef.current)
      setTripOriginDest({
        originLat: trip.origin_lat ?? null, originLng: trip.origin_lon ?? null,
        destLat: trip.destination_lat ?? null, destLng: trip.destination_lon ?? null,
      })
    }
  }

  // GPS tracking for in_progress trip (no depende del mapa, queda igual)
  useEffect(() => {
    if (!tripSheet || tripSheet.status !== 'in_progress') {
      if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null }
      return
    }
    let cancelled = false
    const trip = tripSheet
    const sendGps = async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        if (cancelled) return
        await sendLocation(
          loc.coords.latitude, loc.coords.longitude,
          String(trip.id), profile?.full_name ?? 'Conductor',
          trip.truck_patente ?? undefined,
        )
      } catch { /* ignorar ticks fallidos de GPS/red */ }
    }
    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted' || cancelled) return
      void sendGps()
      gpsIntervalRef.current = setInterval(() => void sendGps(), 15_000)
    })()
    return () => {
      cancelled = true
      if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null }
    }
  }, [tripSheet?.id, tripSheet?.status, profile?.full_name])

  const handleTripAction = async (newStatus: AssignedTrip['status']) => {
    if (!tripSheet) return
    setTripUpdating(true)
    try {
      const updated = await updateTripStatus(String(tripSheet.id), newStatus)
      if (newStatus === 'completed') {
        await clearLocation().catch(() => null)
        stopSimulation()
        setDestMarker(null)
        setTripSegments(null)
        setTripStoredPath([])
        setTripOriginDest({ originLat: null, originLng: null, destLat: null, destLng: null })
        tripSegmentsRef.current = null
        tripPathRef.current = []
      }
      if (newStatus === 'in_progress') {
        redrawTrip()
        const path = simPathLatLng()
        if (path.length >= 2 && mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: path[0][0],
            longitude: path[0][1],
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }, 800)
        } else {
          const startLat = tripSheet.origin_lat ?? location?.lat
          const startLng = tripSheet.origin_lon ?? location?.lng
          if (startLat != null && startLng != null && mapRef.current) {
            mapRef.current.animateToRegion({
              latitude: startLat,
              longitude: startLng,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }, 800)
          }
        }
      }
      setTripSheet(prev => updated ?? (prev ? { ...prev, status: newStatus } : null))
    } catch (e: any) {
      if (e?.status === 409) {
        Alert.alert('Ya tenés un viaje en curso', e.message ?? 'Finalizá el viaje actual antes de iniciar otro.')
      } else if (isSubscriptionError(e)) {
        Alert.alert('Suscripción inactiva', SUBSCRIPTION_INACTIVE_MESSAGE)
      } else {
        Alert.alert('No se pudo actualizar', e?.message ?? 'Revisá tu conexión e intentá de nuevo.')
      }
    } finally {
      setTripUpdating(false)
    }
  }

  const loadIncidents = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND}/api/incidents`)
      const json = await res.json()
      const data = json.incidents ?? []
      const parsed = data
        .map((inc: any) => {
          const coords = parseIncidentLocation(inc.location)
          if (!coords) return null
          return { id: String(inc.id ?? `${coords.lat}-${coords.lng}-${inc.incident_type}`), type: inc.incident_type, lat: coords.lat, lng: coords.lng }
        })
        .filter(Boolean)
      setIncidents(parsed)
    } catch (e) {
      console.log('loadIncidents error:', e)
    }
  }, [])

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude }
      setLocation(coords)
      setOrigin(coords)
      mapRef.current?.animateToRegion({
        latitude: coords.lat,
        longitude: coords.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500)
    })()
    void loadIncidents()
  }, [loadIncidents, setOrigin])

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { 'User-Agent': 'SafeTruck/1.0' } }
      )
      const data = await res.json()
      if (data.address) {
        const { road, house_number, suburb, city_district, city, town } = data.address
        const street = road ? (house_number ? `${road} ${house_number}` : road) : null
        const area = suburb || city_district || city || town
        return [street, area].filter(Boolean).join(', ')
      }
    } catch {}
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }

  useEffect(() => { void getRecentDestinations().then(setRecents) }, [])

  // Cada vez que se entra al mapa, el buscador arranca CERRADO. Los destinos
  // recientes solo aparecen cuando el usuario toca "Buscar destino" (onFocus),
  // no por estado que quedó abierto de una visita anterior.
  useFocusEffect(
    useCallback(() => {
      setShowSearch(false)
      setShowOriginSearch(false)
      Keyboard.dismiss()
    }, [])
  )

  const searchAddress = async (query: string) => {
    if (query.length < 3) { setSearchResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Buenos Aires, Argentina')}&format=json&limit=5&countrycodes=ar&bounded=1&viewbox=-59.2,-35.1,-57.8,-34.2`,
        { headers: { 'User-Agent': 'SafeTruck/1.0' } }
      )
      const data = await res.json()
      setSearchResults(data)
    } catch (e) {
      console.log('Search error:', e)
    } finally {
      setSearching(false)
    }
  }

  const onSearchChange = (text: string) => {
    setSearchText(text)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => searchAddress(text), 400)
  }

  const selectResult = (result: any) => {
    const lat = parseFloat(result.lat)
    const lng = parseFloat(result.lon)
    setSearchText(result.display_name.split(',').slice(0, 2).join(','))
    setSearchResults([])
    setShowSearch(false)
    Keyboard.dismiss()
    void addRecentDestination({
      display_name: result.display_name,
      lat: String(result.lat),
      lon: String(result.lon),
    }).then(setRecents)
    mapRef.current?.animateToRegion({
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }, 500)
    calculateRoute(lat, lng)
  }

  // ── Origen ("Salir desde…") ──────────────────────────────────────────────
  // Mismo buscador (Nominatim) que el destino, pero setea el origen del ruteo.
  const searchOriginAddress = async (query: string) => {
    if (query.length < 3) { setOriginResults([]); return }
    setOriginSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Buenos Aires, Argentina')}&format=json&limit=5&countrycodes=ar&bounded=1&viewbox=-59.2,-35.1,-57.8,-34.2`,
        { headers: { 'User-Agent': 'SafeTruck/1.0' } }
      )
      setOriginResults(await res.json())
    } catch (e) {
      console.log('Origin search error:', e)
    } finally {
      setOriginSearching(false)
    }
  }

  const onOriginChange = (text: string) => {
    setOriginText(text)
    if (originSearchTimeout.current) clearTimeout(originSearchTimeout.current)
    originSearchTimeout.current = setTimeout(() => searchOriginAddress(text), 400)
  }

  const selectOrigin = (result: any) => {
    const lat = parseFloat(result.lat)
    const lng = parseFloat(result.lon)
    const label = result.display_name.split(',').slice(0, 2).join(',')
    setOriginOverride({ lat, lng, label })
    setOriginText(label)
    setOriginResults([])
    setShowOriginSearch(false)
    Keyboard.dismiss()
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 500)
    // Si ya hay un destino elegido, recalculamos la ruta desde el nuevo origen.
    if (destMarker) calculateRoute(destMarker.lat, destMarker.lng)
  }

  // Vuelve a usar la ubicación GPS como origen.
  const resetOrigin = () => {
    setOriginOverride(null)
    setOriginText('')
    setOriginResults([])
    setShowOriginSearch(false)
    Keyboard.dismiss()
    if (destMarker) calculateRoute(destMarker.lat, destMarker.lng)
  }

  // Abre el modal de denuncia. Por defecto apunta a la ubicación actual (GPS).
  const openReportModal = () => {
    setReportLocMode('current')
    setIncidentLocation(location)
    setReportSearchText('')
    setReportSearchResults([])
    setShowIncidentModal(true)
  }

  const closeReportModal = () => {
    setShowIncidentModal(false)
    setReportLocMode('current')
    setReportSearchText('')
    setReportSearchResults([])
  }

  const searchReportAddress = async (query: string) => {
    if (query.length < 3) { setReportSearchResults([]); return }
    setReportSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Buenos Aires, Argentina')}&format=json&limit=5&countrycodes=ar&bounded=1&viewbox=-59.2,-35.1,-57.8,-34.2`,
        { headers: { 'User-Agent': 'SafeTruck/1.0' } }
      )
      setReportSearchResults(await res.json())
    } catch (e) {
      console.log('Report search error:', e)
    } finally {
      setReportSearching(false)
    }
  }

  const onReportSearchChange = (text: string) => {
    setReportSearchText(text)
    if (reportSearchTimeout.current) clearTimeout(reportSearchTimeout.current)
    reportSearchTimeout.current = setTimeout(() => searchReportAddress(text), 400)
  }

  const selectReportResult = (result: any) => {
    setIncidentLocation({ lat: parseFloat(result.lat), lng: parseFloat(result.lon) })
    setReportSearchText(result.display_name.split(',').slice(0, 2).join(','))
    setReportSearchResults([])
    Keyboard.dismiss()
  }

  const calculateRoute = async (destLat: number, destLng: number) => {
    if (loading) return
    // Origen: la dirección elegida en "Salir desde…" o, por defecto, el GPS del chofer.
    const originPoint = originOverride
      ? { lat: originOverride.lat, lng: originOverride.lng }
      : location
    if (!originPoint) return Alert.alert('Error', 'Esperando GPS...')
    if (!activeVehicle) return Alert.alert('Sin vehículo', 'Tu empresa aún no te asignó un camión')
    setDestMarker({ lat: destLat, lng: destLng })
    setCurrentRoute(null)
    setShowInfo(false)
    // Limpia un viaje previo para que no quede solapado con la nueva búsqueda.
    setTripSheet(null)
    setTripSegments(null)
    setTripStoredPath([])
    setTripOriginDest({ originLat: null, originLng: null, destLat: null, destLng: null })
    tripSegmentsRef.current = null
    tripPathRef.current = []
    setLoading(true)
    const controller = new AbortController()
    routeAbortRef.current = controller
    const timeoutId = setTimeout(() => controller.abort(), 60000)
    try {
      const res = await fetch(`${BACKEND}/route`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: originPoint,
          destination: { lat: destLat, lng: destLng },
          vehicle: {
            weight_kg: activeVehicle.weight_kg,
            height_m: activeVehicle.height_m,
            width_m: activeVehicle.width_m,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `No se pudo calcular la ruta (HTTP ${res.status})`)
      // Si loadTripById (u otra operación) empezó mientras este fetch corría,
      // descartamos el resultado para no pisar el estado que ya se limpió.
      if (routeAbortRef.current !== controller) return
      setCurrentRoute(data.route)
      setDestination({ lat: destLat, lng: destLng })
      setShowInfo(true)

      // Encuadrar el mapa para mostrar toda la ruta (equivalente a fitBounds de Leaflet)
      const allCoords = (data.route?.segments ?? [])
        .flatMap((sg: any) => sg.coordinates ?? [])
        .map((c: any) => ({ latitude: c.lat, longitude: c.lng }))
      if (allCoords.length > 0 && mapRef.current) {
        mapRef.current.fitToCoordinates(allCoords, {
          edgePadding: { top: 100, right: 60, bottom: 280, left: 60 },
          animated: true,
        })
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        Alert.alert('Error', e?.message ?? 'No se pudo calcular la ruta.')
      }
    } finally {
      clearTimeout(timeoutId)
      if (routeAbortRef.current === controller) setLoading(false)
    }
  }

  const reportIncident = async (type: string, creates_block: boolean) => {
    if (!incidentLocation || !profile) return
    setReportingIncident(true)
    try {
      const headers = await authHeaders()
      const incRes = await fetch(`${BACKEND}/api/incidents`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_type: type,
          lat: incidentLocation.lat,
          lon: incidentLocation.lng,
        }),
      })
      if (!incRes.ok) {
        const err = await incRes.json().catch(() => ({}))
        throw new Error((err as any).error ?? 'Error al registrar incidente')
      }

      try {
        await fetch(`${BACKEND}/reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: incidentLocation.lat,
            lng: incidentLocation.lng,
            type,
            trip_id: tripSheet?.id ?? null,
          }),
        })
      } catch (e) {
        console.log('Reporte de peso (Aiven) falló:', e)
      }

      closeReportModal()
      Alert.alert('Reporte enviado', 'Gracias por contribuir a SafeTruck')
      void loadIncidents()
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setReportingIncident(false)
    }
  }

  const clearRoute = () => {
    stopNavigation()
    routeAbortRef.current?.abort()
    routeAbortRef.current = null
    setLoading(false)
    // Búsqueda
    setCurrentRoute(null)
    setShowInfo(false)
    setSearchText('')
    setDestMarker(null)
    // Origen: volver al default (GPS)
    setOriginOverride(null)
    setOriginText('')
    setOriginResults([])
    setShowOriginSearch(false)
    // Viaje elegido: que NO quede vigente en el mapa al cancelar.
    setTripSheet(null)
    setTripSegments(null)
    setTripStoredPath([])
    setTripOriginDest({ originLat: null, originLng: null, destLat: null, destLng: null })
    tripSegmentsRef.current = null
    tripPathRef.current = []
    // Si hay un tripId en la URL, lo limpiamos para que el viaje no se recargue
    // si el usuario abandona el tab y vuelve.
    if (tripId) router.replace('/(tabs)/')
    // Vuelve la cámara a "donde estoy parado ahora": solo queda el marcador de
    // ubicación. Las <Polyline> se borran solas (dependen de los estados de arriba).
    if (location) {
      mapRef.current?.animateToRegion(
        { latitude: location.lat, longitude: location.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500
      )
    }
  }

  const startNavigation = async () => {
    if (!location) return
    // Si ya había un watcher corriendo (doble-tap accidental), lo limpiamos
    // antes de crear uno nuevo para no acumular suscripciones de GPS.
    if (watchRef.current) {
      watchRef.current.remove()
      watchRef.current = null
    }
    setNavMode(true)
    setShowInfo(false)
    // Entrada a modo navegación: zoom cercano + vista 3D en perspectiva
    // (pitch alto), como Waze/Google Maps en navegación turn-by-turn.
    mapRef.current?.animateCamera(
      { center: { latitude: location.lat, longitude: location.lng }, zoom: 18, pitch: 60, heading: 0 },
      { duration: 700 }
    )
    watchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        const hdg = pos.coords.heading != null && pos.coords.heading >= 0 ? pos.coords.heading : undefined
        setLocation(c)
        // Sigue al camión manteniendo la vista 3D inclinada, rotando según
        // hacia dónde mira (igual que navUpdate + setBearing de Leaflet,
        // pero ahora con perspectiva en vez de top-down). Forzamos zoom:18
        // en cada update para que no derive con cada llamada.
        mapRef.current?.animateCamera(
          { center: { latitude: c.lat, longitude: c.lng }, zoom: 18, pitch: 60, ...(hdg !== undefined ? { heading: hdg } : {}) },
          { duration: 400 }
        )
      }
    )
  }

  // BUG CONOCIDO (pendiente de diagnóstico): al hacer varios ciclos
  // play→stop→play→stop seguidos en el mismo lugar, el zoom de salida
  // se aleja gradualmente en vez de quedar fijo en 14. Sospecha: animaciones
  // de animateCamera encolándose/compitiendo entre el watcher de GPS y el
  // stop. Pendiente: revisar con mapRef.current.getCamera() antes/después
  // de cada animateCamera para confirmar el zoom real vs el pedido.
  const stopNavigation = () => {
    if (!watchRef.current) return
    setNavMode(false)
    watchRef.current.remove()
    watchRef.current = null
    setShowInfo(true)
    // Salida de modo navegación: vuelve a norte arriba (heading 0), zoom normal.
    // Usamos location lo más fresco posible (el callback de arriba lo actualiza
    // en cada tick de GPS mientras se navega).
    setLocation((current) => {
      if (current) {
        mapRef.current?.animateCamera(
          { center: { latitude: current.lat, longitude: current.lng }, zoom: 14, heading: 0, pitch: 0 },
          { duration: 500 }
        )
      }
      return current
    })
  }

  // Tap en el mapa: fija destino y calcula ruta (igual que el mapClick de Leaflet)
  const handleMapPress = (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
    if (navMode) return
    const { latitude, longitude } = e.nativeEvent.coordinate
    reverseGeocode(latitude, longitude).then(setSearchText)
    calculateRoute(latitude, longitude)
  }

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        provider={Platform.OS === 'android' ? ('google' as any) : undefined}
        style={s.map}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
        showsMyLocationButton
        showsCompass
        onPress={handleMapPress}
      >
        {destMarker && (
          <Marker
            coordinate={{ latitude: destMarker.lat, longitude: destMarker.lng }}
            pinColor="#2563EB"
          />
        )}
        {originOverride && (
          <Marker
            coordinate={{ latitude: originOverride.lat, longitude: originOverride.lng }}
            pinColor="#16A34A"
          />
        )}
        {/* ETAPA 2: ruta coloreada por segmento (verde apto / rojo no apto / naranja sin datos).
            Durante la simulación, el tramo recorrido se pinta gris tenue (estilo
            Waze/Google Maps) y solo el restante mantiene los colores reales. */}
        {(() => {
          const segs = currentRoute?.segments
          if (!segs?.length) return null
          const { passed, remaining } = simRunning
            ? splitSegmentsByProgress(segs, simProgress)
            : { passed: [], remaining: segs }
          const colors: Record<string, string> = { ok: '#34C759', unauthorized: '#FF3B30', unknown: '#FF9500' }
          return (
            <>
              {passed.length >= 2 && (
                <Polyline coordinates={passed} strokeColor="#9CA3AF" strokeWidth={3} zIndex={1} />
              )}
              {remaining.map((seg: any, idx: number) => {
                if (!seg.coordinates || seg.coordinates.length < 2) return null
                return (
                  <Polyline
                    key={idx}
                    coordinates={seg.coordinates.map((c: any) => ({ latitude: c.lat, longitude: c.lng }))}
                    strokeColor={colors[seg.status] ?? colors.unknown}
                    strokeWidth={4}
                    zIndex={seg.status === 'unauthorized' ? 10 : 5}
                  />
                )
              })}
            </>
          )
        })()}
        {/* ETAPA 3: marcadores de incidentes (multas, controles, obras, etc.) */}
        {incidents.map((inc) => (
          <Marker
            key={inc.id}
            coordinate={{ latitude: inc.lat, longitude: inc.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={s.incidentMarker}>
              <Text style={s.incidentMarkerEmoji}>{INCIDENT_ICONS[inc.type] ?? '⚠️'}</Text>
            </View>
          </Marker>
        ))}
        {/* ETAPA 4: ruta del viaje asignado — segmentos coloreados (preferido)
            o path guardado (fallback), + marcadores de origen/destino.
            También aplica el split gris/color durante la simulación. */}
        {(() => {
          if (!tripSegments) return null
          const { passed, remaining } = simRunning
            ? splitSegmentsByProgress(tripSegments, simProgress)
            : { passed: [], remaining: tripSegments }
          const colors: Record<string, string> = { ok: '#34C759', unauthorized: '#FF3B30', unknown: '#FF9500' }
          return (
            <>
              {passed.length >= 2 && (
                <Polyline coordinates={passed} strokeColor="#9CA3AF" strokeWidth={3} zIndex={1} />
              )}
              {remaining.map((seg: any, idx: number) => {
                if (!seg.coordinates || seg.coordinates.length < 2) return null
                return (
                  <Polyline
                    key={`trip-seg-${idx}`}
                    coordinates={seg.coordinates.map((c: any) => ({ latitude: c.lat, longitude: c.lng }))}
                    strokeColor={colors[seg.status] ?? colors.unknown}
                    strokeWidth={4}
                    zIndex={seg.status === 'unauthorized' ? 10 : 5}
                  />
                )
              })}
            </>
          )
        })()}
        {!tripSegments && tripStoredPath.length >= 2 && (
          <Polyline
            coordinates={tripStoredPath.map((p) => ({ latitude: p.lat, longitude: (p.lon ?? p.lng) as number }))}
            strokeColor="#2563EB"
            strokeWidth={4}
          />
        )}
        {tripOriginDest.originLat != null && tripOriginDest.originLng != null && (
          <Marker
            coordinate={{ latitude: tripOriginDest.originLat, longitude: tripOriginDest.originLng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={s.tripDot} />
          </Marker>
        )}
        {tripOriginDest.destLat != null && tripOriginDest.destLng != null && (
          <Marker
            coordinate={{ latitude: tripOriginDest.destLat, longitude: tripOriginDest.destLng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[s.tripDot, { backgroundColor: '#2563EB' }]} />
          </Marker>
        )}
        {/* ETAPA 6: marcador animado de la simulación, con flecha direccional */}
        {simPosition && (
          <Marker
            coordinate={{ latitude: simPosition.lat, longitude: simPosition.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={simPosition.heading ?? 0}
          >
            <View style={s.simMarker}>
              <View style={s.simMarkerDot} />
              <View style={s.simMarkerArrow} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Header */}
      <View style={s.header}>
        {destMarker && !navMode && !simRunning ? (
          /* ── Modo ruta: origen (arriba, editable) + destino (abajo), estilo Google Maps ── */
          <View style={s.searchRow}>
            <View style={s.routeFields}>
              {/* Origen: por defecto "Tu ubicación" (GPS); se puede cambiar */}
              <View style={s.searchBox}>
                <Ionicons name="ellipse" size={11} color="#16A34A" />
                <TextInput
                  style={s.searchInput}
                  placeholder="Tu ubicación"
                  placeholderTextColor={t.textMuted}
                  value={originText}
                  onChangeText={onOriginChange}
                  onFocus={() => { setShowSearch(false); setShowOriginSearch(true) }}
                  returnKeyType="search"
                  onSubmitEditing={() => searchOriginAddress(originText)}
                />
                {originOverride && (
                  <TouchableOpacity onPress={resetOrigin} accessibilityLabel="Usar mi ubicación">
                    <Ionicons name="close-circle" size={16} color={t.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              <View style={s.fieldDivider} />
              {/* Destino */}
              <View style={s.searchBox}>
                <Ionicons name="location" size={15} color="#2563EB" />
                <TextInput
                  style={s.searchInput}
                  placeholder="Buscar destino..."
                  placeholderTextColor={t.textMuted}
                  value={searchText}
                  onChangeText={onSearchChange}
                  onFocus={() => { setShowSearch(true); setShowOriginSearch(false) }}
                  returnKeyType="search"
                  onSubmitEditing={() => searchAddress(searchText)}
                />
              </View>
            </View>
            <TouchableOpacity style={[s.iconBtn, s.iconBtnDanger]} onPress={clearRoute} accessibilityLabel="Cancelar ruta">
              <Ionicons name="close-outline" size={18} color={t.danger} />
            </TouchableOpacity>
          </View>
        ) : (
          /* ── Modo inicial: solo buscador de destino + accesos ── */
          <View style={s.searchRow}>
            <View style={s.searchBox}>
              <Ionicons name="search-outline" size={16} color={t.text} />
              <TextInput
                style={s.searchInput}
                placeholder="Buscar destino..."
                placeholderTextColor={t.textMuted}
                value={searchText}
                onChangeText={onSearchChange}
                onFocus={() => { setShowSearch(true); setShowOriginSearch(false) }}
                returnKeyType="search"
                onSubmitEditing={() => searchAddress(searchText)}
              />
            </View>

            <TouchableOpacity style={s.iconBtn} onPress={() => router.push('/(tabs)/incidents')} accessibilityLabel="Ver alertas activas">
              <Ionicons name="warning-outline" size={18} color={t.text} />
            </TouchableOpacity>

            <TouchableOpacity style={s.iconBtn} onPress={toggleTheme}>
              <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={18} color={t.text} />
            </TouchableOpacity>

            {(currentRoute || tripSheet || searchText.length > 0) && (
              <TouchableOpacity style={[s.iconBtn, s.iconBtnDanger]} onPress={clearRoute}>
                <Ionicons name="close-outline" size={18} color={t.danger} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {showSearch && (searchResults.length > 0 || searching) && (
          <View style={s.searchResults}>
            {searching && (
              <View style={s.searchResultItem}>
                <ActivityIndicator size="small" color={t.accent} />
                <Text style={s.searchResultAddr}>Buscando...</Text>
              </View>
            )}
            {searchResults.map((result, idx) => (
              <TouchableOpacity
                key={idx}
                style={[s.searchResultItem, idx < searchResults.length - 1 && s.searchResultBorder]}
                onPress={() => selectResult(result)}
              >
                <Text style={s.searchResultName} numberOfLines={1}>
                  {result.display_name.split(',')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {showSearch && !searching && searchText.length === 0 && searchResults.length === 0 && recents.length > 0 && (
          <View style={s.searchResults}>
            <Text style={s.searchSectionLabel}>Recientes</Text>
            {recents.map((r, idx) => (
              <TouchableOpacity
                key={idx}
                style={[s.searchResultItem, idx < recents.length - 1 && s.searchResultBorder]}
                onPress={() => selectResult(r)}
              >
                <Ionicons name="time-outline" size={16} color={t.textMuted} style={{ marginRight: 8 }} />
                <Text style={s.searchResultName} numberOfLines={1}>
                  {r.display_name.split(',')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {/* Resultados de búsqueda del origen */}
        {showOriginSearch && (originResults.length > 0 || originSearching) && (
          <View style={s.searchResults}>
            {originSearching && (
              <View style={s.searchResultItem}>
                <ActivityIndicator size="small" color={t.accent} />
                <Text style={s.searchResultAddr}>Buscando...</Text>
              </View>
            )}
            {originResults.map((result, idx) => (
              <TouchableOpacity
                key={idx}
                style={[s.searchResultItem, idx < originResults.length - 1 && s.searchResultBorder]}
                onPress={() => selectOrigin(result)}
              >
                <Ionicons name="location-outline" size={16} color={t.textMuted} style={{ marginRight: 8 }} />
                <Text style={s.searchResultName} numberOfLines={1}>
                  {result.display_name.split(',')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Banner sin vehículo */}
      {!activeVehicle && (
        <View style={[s.banner, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]}>
          <Ionicons name="warning-outline" size={15} color={t.warning} />
          <Text style={s.bannerText}>Tu empresa aún no te asignó un camión</Text>
        </View>
      )}


      {/* Loading */}
      {loading && (
        <View style={s.loadingOverlay}>
          <View style={s.loadingCard}>
            <ActivityIndicator size="large" color={t.accent} />
            <Text style={s.loadingText}>Calculando ruta para camiones...</Text>
          </View>
        </View>
      )}

      {/* Tarjeta de ruta */}
      {showInfo && currentRoute && !navMode && (
        <View style={[s.routeCard, { paddingBottom: 18 }]}>
          <View style={s.routeCardHeader}>
            <View>
              <Text style={s.routeCardTitle}>Ruta calculada</Text>
              {currentRoute.has_unauthorized && (
                <View style={[s.warnBadge, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                  <Ionicons name="alert-circle-outline" size={12} color={t.warning} />
                  <Text style={s.warnBadgeText}>Tramos no habilitados</Text>
                </View>
              )}
            </View>
            <TouchableOpacity style={s.playBtn} onPress={startNavigation}>
              <Ionicons name="play" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={s.divider} />

          <View style={s.stats}>
            <View style={s.stat}>
              <Text style={s.statVal}>{currentRoute.total_distance_km} km</Text>
              <Text style={s.statLbl}>DISTANCIA</Text>
            </View>
            <View style={s.statDiv} />
            <View style={s.stat}>
              <Text style={s.statVal}>{currentRoute.total_duration_min} min</Text>
              <Text style={s.statLbl}>TIEMPO EST.</Text>
            </View>
          </View>

          <View style={s.legend}>
            {[
              { color: t.success, label: 'Habilitada' },
              { color: t.danger,  label: 'No habilitada' },
              { color: t.warning, label: 'Sin datos' },
            ].map(item => (
              <View key={item.label} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: item.color }]} />
                <Text style={s.legendText}>{item.label}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={s.simRouteBtn} onPress={startSimulation} activeOpacity={0.85}>
            <Ionicons name="navigate-circle-outline" size={18} color={t.text} />
            <Text style={s.simRouteBtnText}>Simular recorrido</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* HUD de navegación */}
      {navMode && currentRoute && (
        <View style={[s.navHUD, { paddingBottom: insets.bottom + 16 }]}>
          <View style={{ flex: 1, marginRight: 16 }}>
            <Text style={s.navDest} numberOfLines={1}>{searchText || 'Destino'}</Text>
            <View style={s.navStats}>
              <Text style={s.navStat}>{currentRoute.total_distance_km} km</Text>
              <Text style={s.navStatDot}>·</Text>
              <Text style={s.navStat}>{currentRoute.total_duration_min} min</Text>
            </View>
          </View>
          <TouchableOpacity style={s.navStopBtn} onPress={stopNavigation}>
            <Ionicons name="stop" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Simulación: para viajes asignados queda como botón flotante (y se oculta
          mientras se busca). En una ruta calculada por búsqueda, el botón
          "Simular recorrido" vive dentro de la card de ruta. */}
      {!simRunning && !navMode && tripSheet?.status === 'in_progress' && !showSearch && !showOriginSearch && (
        <TouchableOpacity style={s.simFab} onPress={startSimulation} activeOpacity={0.85}>
          <Ionicons name="navigate-circle-outline" size={20} color={t.text} />
          <Text style={s.simFabText}>Simular</Text>
        </TouchableOpacity>
      )}

      {/* Barra de control de la simulación en curso */}
      {simRunning && (
        <View style={s.simBar}>
          <TouchableOpacity style={s.simBarBtn} onPress={toggleSimPause} activeOpacity={0.8}>
            <Ionicons name={simPaused ? 'play' : 'pause'} size={18} color="#fff" />
          </TouchableOpacity>
          <Text style={s.simBarText}>{simPaused ? 'Pausado' : 'Simulando recorrido'}</Text>
          <TouchableOpacity style={s.simSpeedBtn} onPress={cycleSimSpeed} activeOpacity={0.8}>
            <Ionicons name="speedometer-outline" size={14} color={t.text} />
            <Text style={s.simSpeedText}>{simSpeed}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.simStopBtn} onPress={stopSimulation} activeOpacity={0.8}>
            <Ionicons name="stop" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* FAB de reporte — oculto en la pantalla de "Ruta calculada" para no
          superponerse con el botón de arrancar (play). */}
      {!(showInfo && currentRoute && !navMode) && (
        <TouchableOpacity
          style={[s.fab, tripSheet && !navMode && s.fabTripRaised, navMode && s.fabNavRaised]}
          onPress={openReportModal}
          activeOpacity={0.85}
        >
          <Ionicons name="alert-circle" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Modal de incidente */}
      <Modal visible={showIncidentModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Reportar incidente</Text>
                <Text style={s.modalSubtitle}>¿Dónde y qué está pasando?</Text>
              </View>
              <TouchableOpacity style={s.modalClose} onPress={closeReportModal}>
                <Ionicons name="close" size={18} color={t.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={s.locModeRow}>
              <TouchableOpacity
                style={[s.locModeBtn, reportLocMode === 'current' && s.locModeBtnActive]}
                onPress={() => { setReportLocMode('current'); setIncidentLocation(location) }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="location-outline" size={15} color={reportLocMode === 'current' ? t.accent : t.textMuted} />
                  <Text style={[s.locModeText, reportLocMode === 'current' && s.locModeTextActive]}>Donde estoy</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.locModeBtn, reportLocMode === 'search' && s.locModeBtnActive]}
                onPress={() => { setReportLocMode('search'); setIncidentLocation(null) }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="search-outline" size={15} color={reportLocMode === 'search' ? t.accent : t.textMuted} />
                  <Text style={[s.locModeText, reportLocMode === 'search' && s.locModeTextActive]}>Buscar calle</Text>
                </View>
              </TouchableOpacity>
            </View>

            {reportLocMode === 'search' && (
              <View style={{ marginBottom: 4 }}>
                <TextInput
                  style={s.reportSearchInput}
                  placeholder="Escribí una calle..."
                  placeholderTextColor={t.textMuted}
                  value={reportSearchText}
                  onChangeText={onReportSearchChange}
                  returnKeyType="search"
                />
                {reportSearching && <ActivityIndicator size="small" color={t.accent} style={{ marginVertical: 8 }} />}
                {reportSearchResults.map((r, idx) => (
                  <TouchableOpacity key={idx} style={s.reportSearchItem} onPress={() => selectReportResult(r)}>
                    <Text style={s.reportSearchItemText} numberOfLines={1}>
                      {r.display_name.split(',').slice(0, 2).join(',')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={[s.locChosen, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
              {incidentLocation && <Ionicons name="pin-outline" size={14} color={t.textMuted} />}
              <Text style={[s.locChosenText, { flex: 1 }]}>
                {incidentLocation
                  ? (reportLocMode === 'current'
                      ? 'Tu ubicación actual'
                      : (reportSearchText || `${incidentLocation.lat.toFixed(5)}, ${incidentLocation.lng.toFixed(5)}`))
                  : (reportLocMode === 'search' ? 'Buscá y elegí una calle' : 'Esperando GPS...')}
              </Text>
            </View>

            <ScrollView style={{ marginTop: 4 }}>
              {INCIDENT_TYPES.map(inc => (
                <TouchableOpacity
                  key={inc.key}
                  style={[s.incidentBtn, !incidentLocation && { opacity: 0.4 }]}
                  onPress={() => reportIncident(inc.key, inc.creates_block)}
                  disabled={reportingIncident || !incidentLocation}
                >
                  <Text style={s.incidentBtnText}>{inc.label}</Text>
                  {inc.creates_block && (
                    <View style={s.blockBadge}>
                      <Text style={s.blockBadgeText}>Bloquea ruta</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Trip Sheet ─────────────────────────────────────────────────── */}
      {tripSheet && !navMode && !showInfo && (
        <View style={[s.tripSheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.tripSheetHandle} />

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              {(() => {
                const cfg: Record<string, { label: string; color: string; bg: string }> = {
                  pending:     { label: 'Pendiente',  color: '#D9881A', bg: '#FBF1E0' },
                  accepted:    { label: 'Aceptado',   color: '#1A56C4', bg: '#EFF4FF' },
                  in_progress: { label: 'En curso',   color: '#1F9D57', bg: '#E7F6EE' },
                  completed:   { label: 'Completado', color: '#9AA3AD', bg: '#F2F4F7' },
                  cancelled:   { label: 'Cancelado',  color: t.accent,  bg: t.accentSoft },
                }
                const c = cfg[tripSheet.status] ?? cfg.pending
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start', marginBottom: 12 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.color }} />
                    <Text style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: c.color }}>{c.label}</Text>
                  </View>
                )
              })()}

              <View style={{ position: 'relative' }}>
                <View style={{ position: 'absolute', left: 5, top: 14, bottom: 14, borderLeftWidth: 2, borderLeftColor: t.borderStrong, borderStyle: 'dashed' }} />
                <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 12 }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: t.textSoft, backgroundColor: 'transparent', marginTop: 2, flexShrink: 0 }} />
                  <Text style={{ fontSize: 14, fontWeight: '600', color: t.text, flex: 1 }} numberOfLines={1}>{tripSheet.origin_label ?? 'Origen'}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.accent, marginTop: 2, flexShrink: 0 }} />
                  <Text style={{ fontSize: 14, fontWeight: '600', color: t.text, flex: 1 }} numberOfLines={1}>{tripSheet.destination_label ?? 'Destino'}</Text>
                </View>
              </View>
            </View>

          </View>

          {(tripSheet.truck_patente || tripSheet.truck_name) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Ionicons name="bus" size={14} color={t.textMuted} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: t.textMuted }}>{tripSheet.truck_name ?? ''}</Text>
              {tripSheet.truck_patente && (
                <View style={{ backgroundColor: t.surface2, borderRadius: 4, borderWidth: 1, borderColor: t.border, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 10.5, fontWeight: '700', color: t.textMuted }}>{tripSheet.truck_patente}</Text>
                </View>
              )}
            </View>
          )}

          {tripUpdating ? (
            <ActivityIndicator color={t.accent} />
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {tripSheet.status !== 'in_progress' && (
                <TouchableOpacity style={[s.tripSheetBtn, { backgroundColor: t.success, flex: 1 }]} onPress={() => handleTripAction('in_progress')}>
                  <Text style={s.tripSheetBtnText}>
                    {tripSheet.status === 'completed' || tripSheet.status === 'cancelled' ? 'Reiniciar viaje' : 'Iniciar viaje'}
                  </Text>
                </TouchableOpacity>
              )}
              {tripSheet.status === 'in_progress' && (
                <TouchableOpacity style={[s.tripSheetBtn, { backgroundColor: t.accent, flex: 1 }]} onPress={() => handleTripAction('completed')}>
                  <Text style={s.tripSheetBtnText}>Llegué al destino</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    map: { flex: 1 },

    header: { position: 'absolute', top: 52, left: 16, right: 16 },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: t.card, borderRadius: 12,
      borderWidth: 1, borderColor: t.cardBorder,
      paddingHorizontal: 12, paddingVertical: 8,
      shadowColor: '#000', shadowOpacity: isDarkTheme(t) ? 0.4 : 0.1,
      shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
    },
    searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
    searchInput: { flex: 1, color: t.text, fontSize: 15, height: 36 },
    routeFields: { flex: 1 },
    fieldDivider: { height: 1, backgroundColor: t.cardBorder, marginVertical: 5, marginLeft: 24 },
    searchClear: { color: t.textMuted, fontSize: 14, paddingHorizontal: 4 },

    iconBtn: {
      backgroundColor: t.surface2, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 7,
    },
    iconBtnDanger: { backgroundColor: t.dangerSoft },

    fab: {
      position: 'absolute', bottom: 24, right: 16,
      width: 62, height: 62, borderRadius: 31,
      backgroundColor: t.navy,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.25,
      shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 7,
    },
    fabActive: { backgroundColor: t.danger, shadowColor: t.danger },
    fabRaised: { bottom: 210 },
    fabTripRaised: { bottom: 300 },
    fabNavRaised: { bottom: 105 },

    playFab: {
      position: 'absolute', bottom: 284, right: 16,
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: t.accent,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.25,
      shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 7,
    },

    navHUD: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: t.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      borderTopWidth: 1, borderColor: t.border,
      padding: 20, paddingBottom: 32,
      flexDirection: 'row', alignItems: 'center',
    },
    navDest: { color: t.textMuted, fontSize: 12, marginBottom: 4 },
    navStats: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    navStat: { color: t.accent, fontSize: 24, fontWeight: '700' },
    navStatDot: { color: t.textMuted, fontSize: 20 },
    navStopBtn: {
      backgroundColor: t.danger, borderRadius: 999,
      width: 50, height: 50, alignItems: 'center', justifyContent: 'center',
      marginRight: 2,
    },

    searchResults: {
      backgroundColor: t.card, borderRadius: 10,
      borderWidth: 1, borderColor: t.border,
      marginTop: 6, overflow: 'hidden',
      shadowColor: '#000', shadowOpacity: isDarkTheme(t) ? 0.4 : 0.1,
      shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5,
    },
    searchResultItem: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 14, paddingVertical: 12,
    },
    searchResultBorder: { borderBottomWidth: 1, borderBottomColor: t.border },
    searchResultIcon: { fontSize: 14 },
    searchResultTexts: { flex: 1 },
    searchResultName: { color: t.text, fontSize: 14, fontWeight: '500' },
    searchResultAddr: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    searchSectionLabel: {
      color: t.textMuted, fontSize: 11, fontWeight: '700',
      letterSpacing: 1, textTransform: 'uppercase',
      paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4,
    },

    banner: {
      position: 'absolute', top: 110, left: 16, right: 16,
      backgroundColor: t.card, borderRadius: 999,
      borderWidth: 1, borderColor: t.warning,
      paddingHorizontal: 16, paddingVertical: 10,
    },
    bannerText: { color: t.warning, fontSize: 13, textAlign: 'center', fontWeight: '600' },

    hintPill: {
      position: 'absolute', top: 110,
      alignSelf: 'center', left: 16, right: 16,
      backgroundColor: t.card, borderRadius: 999,
      borderWidth: 1, borderColor: t.border,
      paddingHorizontal: 16, paddingVertical: 10,
    },
    hintPillText: { color: t.text, fontSize: 13, textAlign: 'center', fontWeight: '500' },

    simFab: {
      position: 'absolute', top: 110, left: 16,
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
      borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
      shadowColor: '#000', shadowOpacity: 0.2,
      shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
    },
    simFabText: { color: t.text, fontSize: 13, fontWeight: '700' },
    // Botón "Simular recorrido" dentro de la card de ruta.
    simRouteBtn: {
      marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: t.surface2, borderRadius: 12, paddingVertical: 12,
    },
    simRouteBtnText: { color: t.text, fontSize: 14, fontWeight: '700' },
    simBar: {
      position: 'absolute', top: 110, left: 16, right: 16,
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: t.card, borderRadius: 999,
      borderWidth: 1, borderColor: t.info,
      paddingHorizontal: 10, paddingVertical: 8,
      shadowColor: '#000', shadowOpacity: isDarkTheme(t) ? 0.4 : 0.12,
      shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
    },
    simBarBtn: {
      backgroundColor: t.info, borderRadius: 999,
      width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
    },
    simBarText: { flex: 1, color: t.text, fontSize: 13, fontWeight: '600' },
    simSpeedBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: t.surface2, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 6,
    },
    simSpeedText: { color: t.text, fontSize: 13, fontWeight: '700' },
    simStopBtn: {
      backgroundColor: t.danger, borderRadius: 999,
      width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
    },

    loadingOverlay: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
    },
    loadingCard: {
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1, borderColor: t.cardBorder,
      padding: 28, alignItems: 'center', gap: 14,
      shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, elevation: 10,
    },
    loadingText: { color: t.text, fontSize: 14, fontWeight: '500' },

    routeCard: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: t.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      borderTopWidth: 1, borderColor: t.border,
      padding: 20,
    },
    routeCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    routeCardTitle: { color: t.text, fontSize: 16, fontWeight: '700' },
    playBtn: {
      backgroundColor: t.accent, borderRadius: 20,
      width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
      marginRight: 7,
    },
    divider: { height: 1, backgroundColor: t.border, marginVertical: 12 },
    stats: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
    stat: { flex: 1, alignItems: 'center' },
    statVal: { color: t.accent, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
    statLbl: { color: t.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.8, marginTop: 2 },
    statDiv: { width: 1, height: 28, backgroundColor: t.border },
    legend: { flexDirection: 'row', justifyContent: 'space-around' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { color: t.textMuted, fontSize: 11 },

    warnBadge: {
      marginTop: 8, alignSelf: 'flex-start',
    },
    warnBadgeText: { color: t.warning, fontSize: 11, fontWeight: '600' },

    tripSheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: t.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      borderTopWidth: 1, borderTopColor: t.border,
      padding: 20, paddingBottom: 36,
      shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16,
      shadowOffset: { width: 0, height: -4 }, elevation: 12,
    },
    tripSheetHandle: {
      width: 36, height: 4, borderRadius: 2,
      backgroundColor: t.borderStrong, alignSelf: 'center', marginBottom: 16,
    },
    tripSheetBtn: {
      paddingVertical: 12, paddingHorizontal: 16,
      borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    },
    tripSheetBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
    modalCard: {
      backgroundColor: t.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      borderTopWidth: 1, borderColor: t.border,
      padding: 24, maxHeight: '80%',
      shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, elevation: 10,
    },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    modalTitle: { color: t.text, fontSize: 18, fontWeight: '700', marginBottom: 4 },
    modalSubtitle: { color: t.textMuted, fontSize: 14 },
    modalClose: { backgroundColor: t.surface2, borderRadius: 8, padding: 8 },
    modalCloseText: { color: t.textMuted, fontSize: 14 },
    locModeRow: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 10 },
    locModeBtn: {
      flex: 1, alignItems: 'center',
      backgroundColor: t.surface2, borderRadius: 10,
      borderWidth: 1, borderColor: t.border,
      paddingVertical: 10,
    },
    locModeBtnActive: { backgroundColor: t.accentSoft, borderColor: t.accent },
    locModeText: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
    locModeTextActive: { color: t.accent },

    reportSearchInput: {
      backgroundColor: t.surface2, borderRadius: 10,
      borderWidth: 1, borderColor: t.border,
      paddingHorizontal: 12, paddingVertical: 10,
      color: t.text, fontSize: 14,
    },
    reportSearchItem: {
      paddingHorizontal: 12, paddingVertical: 11,
      borderBottomWidth: 1, borderBottomColor: t.border,
    },
    reportSearchItemText: { color: t.text, fontSize: 13 },

    locChosen: {
      backgroundColor: t.surface2, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8,
    },
    locChosenText: { color: t.textMuted, fontSize: 12, fontWeight: '500' },

    incidentBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: t.surface2, borderRadius: 10,
      padding: 14, marginBottom: 6,
    },
    incidentBtnText: { color: t.text, fontSize: 15 },
    incidentMarker: {
      alignItems: 'center', justifyContent: 'center',
    },
    incidentMarkerEmoji: {
      fontSize: 22,
      textShadowColor: 'rgba(0,0,0,0.4)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    tripDot: {
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: '#1F9D57',
      borderWidth: 3, borderColor: 'white',
      shadowColor: '#000', shadowOpacity: 0.3,
      shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 4,
    },
    simMarker: {
      width: 34, height: 34,
      alignItems: 'center', justifyContent: 'center',
    },
    simMarkerDot: {
      position: 'absolute',
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: '#007AFF',
      borderWidth: 3, borderColor: 'white',
      shadowColor: '#007AFF', shadowOpacity: 0.5,
      shadowRadius: 4, shadowOffset: { width: 0, height: 0 }, elevation: 5,
    },
    simMarkerArrow: {
      position: 'absolute',
      top: -10,
      width: 0, height: 0,
      borderLeftWidth: 7, borderLeftColor: 'transparent',
      borderRightWidth: 7, borderRightColor: 'transparent',
      borderBottomWidth: 16, borderBottomColor: '#007AFF',
    },

    blockBadge: {
      backgroundColor: t.warningSoft, borderRadius: 999,
      paddingHorizontal: 8, paddingVertical: 3,
    },
    blockBadgeText: { color: t.warning, fontSize: 11, fontWeight: '600' },
  })
}