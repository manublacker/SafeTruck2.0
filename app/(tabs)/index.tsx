import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  Modal, ScrollView, TextInput, Keyboard,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { supabase } from '../../src/services/supabase'
import { Theme, getTheme, isDarkTheme } from '../../src/theme'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { fetchAllMyTrips, updateTripStatus, sendLocation, clearLocation, fetchMyAssignedTruck, type AssignedTrip } from '../../src/services/assignedTrips'
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

const MAP_HTML = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
* { margin:0;padding:0;box-sizing:border-box; }
html,body,#map { width:100%;height:100%; }
.night-mode .leaflet-tile-pane {
  filter: invert(100%) hue-rotate(180deg) brightness(90%) contrast(85%) saturate(0.85);
}
</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map',{zoomControl:false}).setView([-34.6037,-58.3816],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© OSM', maxZoom:19
  }).addTo(map);
  var userMarker=null, destMarker=null, routeLayers=[], incidentMarkers=[];
  var navActive=false, headingMarker=null, tripMarkers=[];

  function setMapTheme(dark) {
    if (dark) map.getContainer().classList.add('night-mode');
    else map.getContainer().classList.remove('night-mode');
  }

  map.on('click', function(e) {
    if (navActive) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'mapClick', lat: e.latlng.lat, lng: e.latlng.lng
    }));
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([e.latlng.lat, e.latlng.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="background:#2563EB;width:14px;height:14px;border-radius:50%;border:2.5px solid white"></div>'
      })
    }).addTo(map);
  });

  function setUserLocation(lat, lng) {
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker([lat, lng], {
      radius: 8, fillColor: '#007AFF', color: 'white', weight: 3, fillOpacity: 1
    }).addTo(map);
    map.setView([lat, lng], 14);
  }

  function drawRoute(segments) {
    clearRoute();
    var colors = { ok: '#34C759', unauthorized: '#FF3B30', unknown: '#FF9500' };
    var bounds = [];
    segments.forEach(function(seg) {
      if (!seg.coordinates || seg.coordinates.length < 2) return;
      var latlngs = seg.coordinates.map(function(c) { return [c.lat, c.lng]; });
      var line = L.polyline(latlngs, {
        color: colors[seg.status] || colors.unknown,
        weight: 5, opacity: 0.9,
        dashArray: seg.status === 'unauthorized' ? '10,6' : null
      }).addTo(map);
      routeLayers.push(line);
      bounds = bounds.concat(latlngs);
    });
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [80, 40] });
  }

  function clearRoute() {
    routeLayers.forEach(function(l) { map.removeLayer(l); });
    routeLayers = [];
    tripMarkers.forEach(function(m) { map.removeLayer(m); });
    tripMarkers = [];
    if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  }

  var ICONS = {
    multa:'💸', control_policial:'👮', accidente:'🚨',
    obra:'🚧', puente_bajo:'🌉', corte:'🚫',
    control_peso:'⚖️', otro:'⚠️', trafico:'🚗', objeto_en_via:'⚠️'
  };

  function addIncidentMarker(lat, lng, type) {
    var marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="font-size:22px;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.4))">' + (ICONS[type] || '⚠️') + '</div>',
        iconAnchor: [11, 11]
      })
    }).addTo(map);
    incidentMarkers.push(marker);
  }

  function loadIncidents(incidents) {
    incidentMarkers.forEach(function(m) { map.removeLayer(m); });
    incidentMarkers = [];
    incidents.forEach(function(inc) {
      if (!inc.location) return;
      var lat, lng;
      if (typeof inc.location === 'string') {
        var m = inc.location.match(/POINT\\(([\\d.-]+) ([\\d.-]+)\\)/);
        if (m) { lng = parseFloat(m[1]); lat = parseFloat(m[2]); }
      } else if (inc.location.coordinates) {
        lng = inc.location.coordinates[0]; lat = inc.location.coordinates[1];
      }
      if (lat && lng) addIncidentMarker(lat, lng, inc.incident_type);
    });
  }

  function enterNavMode(lat, lng, heading) {
    navActive = true;
    map.setView([lat, lng], 18, { animate: true, duration: 0.6 });
    updateNavMarker(lat, lng, heading);
  }

  function navUpdate(lat, lng, heading) {
    if (!navActive) return;
    map.panTo([lat, lng], { animate: true, duration: 0.4 });
    updateNavMarker(lat, lng, heading);
    if (heading !== null) map.setBearing(heading);
  }

  function updateNavMarker(lat, lng, heading) {
    if (userMarker) map.removeLayer(userMarker);
    if (headingMarker) map.removeLayer(headingMarker);
    userMarker = L.circleMarker([lat, lng], {
      radius: 9, fillColor: '#007AFF', color: 'white', weight: 3, fillOpacity: 1
    }).addTo(map);
    if (heading !== null) {
      var rad = (heading - 90) * Math.PI / 180;
      var r = 0.0003;
      var tipLat = lat + r * Math.cos((heading - 90) * Math.PI / 180) * 0.7;
      var tipLng = lng + r * Math.sin((heading - 90) * Math.PI / 180) * 0.7 / Math.cos(lat * Math.PI / 180);
      headingMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:18px solid #007AFF;transform:rotate(' + heading + 'deg);transform-origin:center bottom;margin-left:-7px;margin-top:-18px;filter:drop-shadow(0 1px 4px rgba(0,122,255,0.5))"></div>',
          iconAnchor: [0, 0]
        })
      }).addTo(map);
    }
  }

  function exitNavMode(lat, lng) {
    navActive = false;
    if (headingMarker) { map.removeLayer(headingMarker); headingMarker = null; }
    if (lat !== null) {
      map.setView([lat, lng], 14, { animate: true, duration: 0.5 });
    }
    if (userMarker) map.removeLayer(userMarker);
    if (lat !== null) {
      userMarker = L.circleMarker([lat, lng], {
        radius: 8, fillColor: '#007AFF', color: 'white', weight: 3, fillOpacity: 1
      }).addTo(map);
    }
    try { map.setBearing(0); } catch(e) {}
  }

  function drawTripPath(points, originLat, originLng, destLat, destLng) {
    clearRoute();
    var latlngs = [];
    if (points && points.length > 1) {
      latlngs = points.map(function(p) { return [p.lat, p.lon !== undefined ? p.lon : p.lng]; });
    } else if (originLat && destLat) {
      latlngs = [[originLat, originLng], [destLat, destLng]];
    }
    if (latlngs.length < 2) return;
    var poly = L.polyline(latlngs, { color: '#2563EB', weight: 5, opacity: 0.9, lineCap: 'round' }).addTo(map);
    routeLayers.push(poly);
    // Origen (verde) y destino (azul) — el rojo se reserva para tramos no habilitados.
    var oMarker = L.circleMarker(latlngs[0], { radius: 9, fillColor: '#1F9D57', color: 'white', weight: 3, fillOpacity: 1 }).addTo(map);
    var dest = latlngs[latlngs.length - 1];
    var dMarker = L.circleMarker(dest, { radius: 9, fillColor: '#2563EB', color: 'white', weight: 3, fillOpacity: 1 }).addTo(map);
    tripMarkers.push(oMarker, dMarker);
    map.fitBounds(poly.getBounds(), { padding: [80, 80] });
  }

  // ── SIMULACIÓN DE RECORRIDO ─────────────────────────────────────────────
  // Anima un marcador a lo largo de la ruta (array de [lat,lng]) interpolando
  // por segmentos. El loop corre acá en JS (suave). La cámara solo recentra al
  // iniciar o cuando el marcador se acerca al borde, no en cada paso.
  var simTimer=null, simMarker=null, simHeadingM=null, simData=null;
  var SIM_TICK_MS = 100;

  function simHaversine(a, b) {
    var R=6371000;
    var dLat=(b[0]-a[0])*Math.PI/180, dLng=(b[1]-a[1])*Math.PI/180;
    var la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
    var x=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.sin(dLng/2)*Math.sin(dLng/2)*Math.cos(la1)*Math.cos(la2);
    return 2*R*Math.asin(Math.sqrt(x));
  }
  function simBearing(a, b) {
    var la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180, dLng=(b[1]-a[1])*Math.PI/180;
    var y=Math.sin(dLng)*Math.cos(la2);
    var x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLng);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  }

  function simStart(path, speedKmh) {
    simStop();
    if (!path || path.length < 2) return;
    navActive = false;
    // Ocultar el marcador de ubicación actual: el de la simulación lo reemplaza.
    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    simData = { path: path, idx: 0, frac: 0, speed: speedKmh || 40, paused: false };
    map.setView(path[0], 16, { animate: true, duration: 0.6 });
    simRender(path[0][0], path[0][1], simBearing(path[0], path[1]), true);
    simTimer = setInterval(simTick, SIM_TICK_MS);
  }

  function simTick() {
    var s = simData; if (!s || s.paused) return;
    var path = s.path;
    if (s.idx >= path.length - 1) { simFinish(); return; }
    var meters = s.speed * 1000/3600 * (SIM_TICK_MS/1000);
    while (meters > 0 && s.idx < path.length - 1) {
      var a = path[s.idx], b = path[s.idx+1];
      var segLen = simHaversine(a, b);
      if (segLen < 0.01) { s.idx++; s.frac = 0; continue; }
      var distLeft = segLen * (1 - s.frac);
      if (distLeft > meters) { s.frac += meters / segLen; meters = 0; }
      else { meters -= distLeft; s.idx++; s.frac = 0; }
    }
    if (s.idx >= path.length - 1) {
      var last = path[path.length-1], prev = path[path.length-2];
      simRender(last[0], last[1], simBearing(prev, last), false);
      simFinish(); return;
    }
    var a2 = path[s.idx], b2 = path[s.idx+1];
    var lat = a2[0] + (b2[0]-a2[0]) * s.frac;
    var lng = a2[1] + (b2[1]-a2[1]) * s.frac;
    simRender(lat, lng, simBearing(a2, b2), false);
  }

  function simRender(lat, lng, heading, recenter) {
    if (!simMarker) {
      simMarker = L.circleMarker([lat,lng], { radius:9, fillColor:'#007AFF', color:'white', weight:3, fillOpacity:1 }).addTo(map);
    } else { simMarker.setLatLng([lat,lng]); }
    if (simHeadingM) { map.removeLayer(simHeadingM); simHeadingM=null; }
    if (heading !== null && heading !== undefined) {
      simHeadingM = L.marker([lat,lng], { icon: L.divIcon({ className:'', html:'<div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:18px solid #007AFF;transform:rotate('+heading+'deg);transform-origin:center bottom;margin-left:-7px;margin-top:-18px;filter:drop-shadow(0 1px 4px rgba(0,122,255,0.5))"></div>', iconAnchor:[0,0] }) }).addTo(map);
    }
    if (recenter || !map.getBounds().pad(-0.25).contains(L.latLng(lat,lng))) {
      map.panTo([lat,lng], { animate: true, duration: 0.5 });
    }
  }

  function simFinish() { if (simTimer) { clearInterval(simTimer); simTimer=null; } }
  function simPause() { if (simData) simData.paused = true; }
  function simResume() { if (simData) simData.paused = false; }
  function simSetSpeed(k) { if (simData) simData.speed = k; }
  function simStop() {
    if (simTimer) { clearInterval(simTimer); simTimer=null; }
    if (simMarker) { map.removeLayer(simMarker); simMarker=null; }
    if (simHeadingM) { map.removeLayer(simHeadingM); simHeadingM=null; }
    simData = null;
  }

  // Inicio de viaje REAL (no simulado): centra la cámara en el inicio de la ruta
  // y ajusta la ubicación al inicio de las líneas.
  function navStartTrip(path) {
    if (!path || path.length < 2) return;
    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    userMarker = L.circleMarker(path[0], { radius:8, fillColor:'#007AFF', color:'white', weight:3, fillOpacity:1 }).addTo(map);
    map.setView(path[0], 16, { animate: true, duration: 0.8 });
  }
</script>
</body>
</html>`

export default function MapScreen() {
  const webRef = useRef<WebView>(null)
  const searchTimeout = useRef<any>(null)
  const reportSearchTimeout = useRef<any>(null)

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
  const mapSource = useMemo(() => ({ html: MAP_HTML }), [])

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
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
  const [navMode, setNavMode] = useState(false)
  const watchRef = useRef<any>(null)

  // ── Simulación de recorrido (sigue la ruta calculada o el viaje asignado) ──
  const [simRunning, setSimRunning] = useState(false)
  const [simPaused, setSimPaused] = useState(false)
  const [simSpeed, setSimSpeed] = useState(40) // km/h
  const simSpeedRef = useRef(40)
  const tripPathRef = useRef<{ lat: number; lon?: number; lng?: number }[]>([])
  const SIM_SPEEDS = [10, 40, 80]

  // ── Trip visualization (navegado desde Viajes) ─────────────────────────
  const { tripId } = useLocalSearchParams<{ tripId?: string }>()
  const router = useRouter()
  const [tripSheet, setTripSheet] = useState<AssignedTrip | null>(null)
  const [tripUpdating, setTripUpdating] = useState(false)
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadTripById = useCallback(async (id: string) => {
    try {
      const all = await fetchAllMyTrips()
      const found = all.find(t => String(t.id) === id)
      if (!found) {
        Alert.alert('Viaje no disponible', 'No encontramos ese viaje. Puede que haya cambiado o ya no esté asignado a vos.')
        return
      }
      setTripSheet(found)
      // Draw trip route on map
      const path = (() => {
        try {
          const p = typeof found.path === 'string' ? JSON.parse(found.path) : found.path
          return (p?.path || p?.polyline || p?.segments?.flatMap((s: any) => s.coordinates) || []) as { lat: number; lon?: number; lng?: number }[]
        } catch { return [] }
      })()
      tripPathRef.current = path
      webRef.current?.injectJavaScript(
        `drawTripPath(${JSON.stringify(path)}, ${found.origin_lat ?? 'null'}, ${found.origin_lon ?? 'null'}, ${found.destination_lat ?? 'null'}, ${found.destination_lon ?? 'null'}); true;`
      )
    } catch {
      Alert.alert('Error', 'No se pudo cargar el viaje. Revisá tu conexión e intentá de nuevo.')
    }
  }, [])

  // Liberar la suscripción de GPS de alta precisión si el componente se desmonta
  // (cambio de tab / logout) estando en navegación: evita fuga de batería y
  // callbacks sobre un WebView ya desmontado.
  useEffect(() => () => {
    watchRef.current?.remove?.()
    watchRef.current = null
  }, [])

  useEffect(() => {
    if (tripId) {
      void loadTripById(tripId)
    } else {
      setTripSheet(null)
      if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null }
    }
  }, [tripId])

  // ── Simulación de recorrido ─────────────────────────────────────────────
  // Devuelve la ruta a simular como [[lat,lng],...]: prioriza la ruta calculada
  // (destino tocado) y si no, el path del viaje asignado.
  const simPathLatLng = (): [number, number][] => {
    const segs = (currentRoute as any)?.segments as { coordinates?: { lat: number; lng: number }[] }[] | undefined
    if (segs?.length) {
      const pts: [number, number][] = []
      for (const s of segs) for (const c of (s.coordinates ?? [])) pts.push([c.lat, c.lng])
      if (pts.length >= 2) return pts
    }
    const tp = tripPathRef.current
    if (tp.length >= 2) return tp.map(p => [p.lat, (p.lon ?? p.lng) as number])
    return []
  }

  const startSimulation = () => {
    const path = simPathLatLng()
    if (path.length < 2) {
      Alert.alert('Simulación', 'No hay una ruta para simular. Tocá un destino o iniciá un viaje asignado.')
      return
    }
    setSimRunning(true)
    setSimPaused(false)
    setShowInfo(false)
    webRef.current?.injectJavaScript(`simStart(${JSON.stringify(path)}, ${simSpeedRef.current}); true;`)
  }

  const stopSimulation = () => {
    setSimRunning(false)
    setSimPaused(false)
    webRef.current?.injectJavaScript(`simStop(); true;`)
    // Restaurar el marcador de ubicación actual (lo había ocultado simStart).
    if (location) {
      webRef.current?.injectJavaScript(`setUserLocation(${location.lat}, ${location.lng}); true;`)
    }
  }

  const toggleSimPause = () => {
    setSimPaused(p => {
      const next = !p
      webRef.current?.injectJavaScript(`${next ? 'simPause' : 'simResume'}(); true;`)
      return next
    })
  }

  const cycleSimSpeed = () => {
    setSimSpeed(prev => {
      const next = SIM_SPEEDS[(SIM_SPEEDS.indexOf(prev) + 1) % SIM_SPEEDS.length]
      simSpeedRef.current = next
      webRef.current?.injectJavaScript(`simSetSpeed(${next}); true;`)
      return next
    })
  }

  // Repinta en el mapa la ruta del viaje + círculos de origen (verde) y destino
  // (rojo). Se usa al cargar el viaje, al recargar el WebView y al reiniciar.
  const redrawTrip = (trip: AssignedTrip | null = tripSheet) => {
    if (!trip) return
    const path = tripPathRef.current
    webRef.current?.injectJavaScript(
      `drawTripPath(${JSON.stringify(path)}, ${trip.origin_lat ?? 'null'}, ${trip.origin_lon ?? 'null'}, ${trip.destination_lat ?? 'null'}, ${trip.destination_lon ?? 'null'}); true;`
    )
  }

  // GPS tracking for in_progress trip
  useEffect(() => {
    if (!tripSheet || tripSheet.status !== 'in_progress') {
      if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null }
      return
    }
    // `cancelled` evita la "ubicación fantasma": si el viaje se completa mientras
    // un getCurrentPositionAsync está en vuelo, no reinsertamos la ubicación que
    // recién se borró. El permiso se pide UNA vez, no en cada tick.
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
        // Sacar la ruta y los círculos de origen/destino del mapa al terminar.
        stopSimulation()
        webRef.current?.injectJavaScript(`clearRoute(); true;`)
      }
      if (newStatus === 'in_progress') {
        // Repintar la ruta/círculos (pueden haberse borrado si estaba completado)
        // y centrar + rotar la cámara a la dirección de la ruta, ajustando la
        // ubicación al inicio de las líneas.
        redrawTrip()
        const path = simPathLatLng()
        if (path.length >= 2) {
          webRef.current?.injectJavaScript(`navStartTrip(${JSON.stringify(path)}); true;`)
        } else {
          const startLat = tripSheet.origin_lat ?? location?.lat
          const startLng = tripSheet.origin_lon ?? location?.lng
          if (startLat != null && startLng != null) {
            webRef.current?.injectJavaScript(
              `map.flyTo([${startLat}, ${startLng}], 16, { animate: true, duration: 1.2 }); true;`
            )
          }
        }
      }
      // Preferimos el viaje fresco que devuelve el backend (trae timestamps
      // actualizados); si no vino, parcheamos solo el status localmente.
      setTripSheet(prev => updated ?? (prev ? { ...prev, status: newStatus } : null))
    } catch (e: any) {
      if (e?.status === 409) {
        Alert.alert('Ya tenés un viaje en curso', e.message ?? 'Finalizá el viaje actual antes de iniciar otro.')
      } else {
        Alert.alert('No se pudo actualizar', e?.message ?? 'Revisá tu conexión e intentá de nuevo.')
      }
    } finally {
      setTripUpdating(false)
    }
  }

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude }
      setLocation(coords)
      setOrigin(coords)
      webRef.current?.injectJavaScript(`setUserLocation(${coords.lat}, ${coords.lng}); true;`)
    })()
    loadIncidents()
  }, [])

  useEffect(() => {
    webRef.current?.injectJavaScript(`setMapTheme(${isDark}); true;`)
  }, [isDark])

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
    webRef.current?.injectJavaScript(`map.setView([${lat}, ${lng}], 15); true;`)
    calculateRoute(lat, lng)
  }

  const loadIncidents = async () => {
    try {
      const res = await fetch(`${BACKEND}/api/incidents`)
      const json = await res.json()
      const data = json.incidents ?? []
      webRef.current?.injectJavaScript(`loadIncidents(${JSON.stringify(data)}); true;`)
    } catch (e) {
      console.log('loadIncidents error:', e)
    }
  }

  // Abre el modal de denuncia. Por defecto apunta a la ubicación actual (GPS):
  // el caso más común es "denunciar la arista donde estoy parado".
  const openReportModal = () => {
    setReportLocMode('current')
    setIncidentLocation(location) // {lat,lng} actual, o null si todavía no hay GPS
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

  // Buscador interno SOLO para denuncias (independiente del buscador de destino,
  // para no pisar searchResults). Reusa Nominatim acotado al AMBA.
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

  // Al elegir una calle del buscador, esa pasa a ser la ubicación a denunciar.
  const selectReportResult = (result: any) => {
    setIncidentLocation({ lat: parseFloat(result.lat), lng: parseFloat(result.lon) })
    setReportSearchText(result.display_name.split(',').slice(0, 2).join(','))
    setReportSearchResults([])
    Keyboard.dismiss()
  }

  const calculateRoute = async (destLat: number, destLng: number) => {
    if (loading) return
    if (!location) return Alert.alert('Error', 'Esperando GPS...')
    if (!activeVehicle) return Alert.alert('Sin vehículo', 'Tu empresa aún no te asignó un camión')
    webRef.current?.injectJavaScript(`clearRoute(); true;`)
    setCurrentRoute(null)
    setShowInfo(false)
    setLoading(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)
    try {
      const res = await fetch(`${BACKEND}/route`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: location,
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
      setCurrentRoute(data.route)
      setDestination({ lat: destLat, lng: destLng })
      setShowInfo(true)

      // insert_trip (st_trips) eliminado en Fase 3 — el historial de viajes
      // se registra en assigned_trips via /api/assigned-trips.

      webRef.current?.injectJavaScript(`drawRoute(${JSON.stringify(data.route.segments)}); true;`)
    } catch (e: any) {
      Alert.alert('Error', e?.name === 'AbortError'
        ? 'El cálculo de ruta tardó demasiado. Intentá de nuevo.'
        : (e?.message ?? 'No se pudo calcular la ruta.'))
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  const reportIncident = async (type: string, creates_block: boolean) => {
    if (!incidentLocation || !profile) return
    setReportingIncident(true)
    try {
      // ── (1) Registrar incidente en la tabla incidents via API ─────────────
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

      // ── (2) CAPA DE PESO — backend Aiven (POST /reports) ──────────────────
      // Snapea el punto a la arista de pgr_edges más cercana y acumula
      // penalización (pgr_edges.denuncia_penalty) por umbral. El motor real de
      // ruteo, pgr_route_truck, suma esa penalización al costo => en la próxima
      // ruta esquiva o bloquea la arista denunciada. ESTA es la parte que pesa.
      // El backend hace el snap; sólo mandamos lat/lng. El tipo concreto va como
      // nota; el sistema de peso lo trata todo como 'multa' (evento negativo).
      // Lógica SQL: src/backend/migrations/003_denuncia_penalty_pgr.sql.
      // Fire-and-forget: si Aiven falla, el marcador visual igual quedó.
      try {
        await fetch(`${BACKEND}/reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: incidentLocation.lat,
            lng: incidentLocation.lng,
            type,                           // tipo concreto (control, accidente…) -> nota
            trip_id: tripSheet?.id ?? null, // viaje en curso si lo hay (opcional)
          }),
        })
      } catch (e) {
        console.log('Reporte de peso (Aiven) falló:', e)
      }

      closeReportModal()
      Alert.alert('Reporte enviado', 'Gracias por contribuir a SafeTruck')
      loadIncidents()
      webRef.current?.injectJavaScript(
        `addIncidentMarker(${incidentLocation.lat}, ${incidentLocation.lng}, '${type}'); true;`
      )
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setReportingIncident(false)
    }
  }

  const clearRoute = () => {
    stopNavigation()
    setCurrentRoute(null)
    setShowInfo(false)
    setSearchText('')
    webRef.current?.injectJavaScript(`clearRoute(); true;`)
  }

  const startNavigation = async () => {
    if (!location) return
    setNavMode(true)
    setShowInfo(false)
    const heading = null
    webRef.current?.injectJavaScript(`enterNavMode(${location.lat}, ${location.lng}, null); true;`)
    watchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        const hdg = pos.coords.heading != null && pos.coords.heading >= 0 ? pos.coords.heading : null
        setLocation(c)
        webRef.current?.injectJavaScript(`navUpdate(${c.lat}, ${c.lng}, ${hdg}); true;`)
      }
    )
  }

  const stopNavigation = () => {
    if (!watchRef.current) return
    setNavMode(false)
    watchRef.current.remove()
    watchRef.current = null
    setLocation(loc => {
      const latVal = loc ? loc.lat : null
      const lngVal = loc ? loc.lng : null
      webRef.current?.injectJavaScript(`exitNavMode(${latVal}, ${lngVal}); true;`)
      return loc
    })
    setShowInfo(true)
  }

  const onMessage = (e: any) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data)
      if (msg.type === 'mapClick') {
        // El tap en el mapa es sólo para fijar destino y calcular ruta.
        // La denuncia ya NO usa el tap: se elige ubicación dentro del modal
        // (GPS actual o buscador interno). Ver openReportModal / reportIncident.
        reverseGeocode(msg.lat, msg.lng).then(setSearchText)
        calculateRoute(msg.lat, msg.lng)
      }
    } catch {}
  }

  return (
    <View style={s.container}>
      <WebView
        ref={webRef}
        style={s.map}
        source={mapSource}
        onMessage={onMessage}
        onLoadEnd={() => {
          const w = webRef.current
          if (!w) return
          w.injectJavaScript(`setMapTheme(${isDark}); true;`)
          if (location) w.injectJavaScript(`setUserLocation(${location.lat}, ${location.lng}); true;`)
          if (tripSheet) redrawTrip()
          // Repintar la capa de denuncias una vez que el mapa está listo: en el
          // primer load la inyección del effect de montaje puede correr antes de
          // que el WebView defina loadIncidents() y perderse en silencio.
          void loadIncidents()
        }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
      />

      {/* Header */}
      <View style={s.header}>
        <View style={s.searchRow}>
          <View style={s.searchBox}>
            <Ionicons name="search-outline" size={16} color={t.text} />
            <TextInput
              style={s.searchInput}
              placeholder="Buscar destino..."
              placeholderTextColor={t.textMuted}
              value={searchText}
              onChangeText={onSearchChange}
              onFocus={() => setShowSearch(true)}
              returnKeyType="search"
              onSubmitEditing={() => searchAddress(searchText)}
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchText(''); setSearchResults([]); setShowSearch(false) }} style={{ paddingHorizontal: 4 }}>
                <Ionicons name="close" size={18} color={t.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={s.iconBtn} onPress={() => router.push('/(tabs)/incidents')} accessibilityLabel="Ver alertas activas">
            <Ionicons name="warning-outline" size={18} color={t.text} />
          </TouchableOpacity>

          <TouchableOpacity style={s.iconBtn} onPress={toggleTheme}>
            <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={18} color={t.text} />
          </TouchableOpacity>

          {currentRoute && (
            <TouchableOpacity style={[s.iconBtn, s.iconBtnDanger]} onPress={clearRoute}>
              <Ionicons name="close-outline" size={18} color={t.danger} />
            </TouchableOpacity>
          )}
        </View>

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
      </View>

      {/* Banner sin vehículo */}
      {!activeVehicle && (
        <View style={[s.banner, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]}>
          <Ionicons name="warning-outline" size={15} color={t.warning} />
          <Text style={s.bannerText}>Tu empresa aún no te asignó un camión</Text>
        </View>
      )}

      {/* Hint inicial */}
      {!currentRoute && !tripSheet && !simRunning && !loading && activeVehicle && searchText.length === 0 && (
        <View style={s.hintPill}>
          <Text style={s.hintPillText}>Buscá un destino o tocá el mapa</Text>
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
        <View style={[s.routeCard, { paddingBottom: insets.bottom + 16 }]}>
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

      {/* Simulación: botón para simular el recorrido sobre la ruta calculada
          o el viaje asignado. Aparece con una ruta/viaje y no en navegación. */}
      {!simRunning && !navMode && (tripSheet?.status === 'in_progress' || (currentRoute && !tripSheet)) && (
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

      {/* FAB de reporte: abre el modal de denuncia directamente (ubicación se
          elige adentro: GPS actual o buscador interno). */}
      <TouchableOpacity
        style={[s.fab, showInfo && currentRoute && !navMode && s.fabRaised, navMode && s.fabNavRaised]}
        onPress={openReportModal}
        activeOpacity={0.85}
      >
        <Ionicons name="alert-circle" size={28} color="#fff" />
      </TouchableOpacity>

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

            {/* Selector de ubicación: GPS actual vs buscar una calle */}
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

            {/* Buscador interno (sólo en modo 'search') */}
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

            {/* Ubicación elegida (feedback) */}
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

      {/* ── Trip Sheet (Google Maps style bottom panel) ─────────────── */}
      {tripSheet && !navMode && !showInfo && (
        <View style={[s.tripSheet, { paddingBottom: insets.bottom + 20 }]}>
          {/* Handle */}
          <View style={s.tripSheetHandle} />

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              {/* Status badge */}
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

              {/* Route */}
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

            {/* Close */}
            <TouchableOpacity onPress={() => { setTripSheet(null); webRef.current?.injectJavaScript('clearRoute(); true;'); router.replace('/(tabs)/') }} style={{ backgroundColor: t.surface2, borderRadius: 8, padding: 8, marginLeft: 12 }}>
              <Ionicons name="close" size={18} color={t.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Truck badge */}
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

          {/* Actions */}
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
    divider: { height: 1, backgroundColor: t.border, marginVertical: 14 },
    stats: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    stat: { flex: 1, alignItems: 'center' },
    statVal: { color: t.accent, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
    statLbl: { color: t.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.8, marginTop: 3 },
    statDiv: { width: 1, height: 36, backgroundColor: t.border },
    legend: { flexDirection: 'row', justifyContent: 'space-around' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { color: t.textMuted, fontSize: 11 },

    warnBadge: {
      marginTop: 4, alignSelf: 'flex-start',
      backgroundColor: t.warningSoft, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 3,
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
    // Selector de ubicación de la denuncia (📍 acá / 🔍 buscar)
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
    blockBadge: {
      backgroundColor: t.warningSoft, borderRadius: 999,
      paddingHorizontal: 8, paddingVertical: 3,
    },
    blockBadgeText: { color: t.warning, fontSize: 11, fontWeight: '600' },
  })
}
