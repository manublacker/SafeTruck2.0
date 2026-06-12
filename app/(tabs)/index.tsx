import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  Modal, ScrollView, TextInput, Keyboard,
} from 'react-native'
import { WebView } from 'react-native-webview'
import * as Location from 'expo-location'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { supabase } from '../../src/services/supabase'
import { Theme, getTheme } from '../../src/theme'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { fetchAllMyTrips, updateTripStatus, sendLocation, clearLocation, fetchMyAssignedTruck, type AssignedTrip } from '../../src/services/assignedTrips'
import { createDeviationMonitor, stepDeviationMonitor, type DeviationMonitorState } from '../../src/services/deviationMonitor'
import { toLatLng, type LatLng } from '../../src/services/routeDeviation'

const BACKEND = "https://safetruck20-production.up.railway.app"

const INCIDENT_TYPES = [
  { key: 'fine',         label: '💸 Multa a camión',    creates_block: true  },
  { key: 'police_check', label: '👮 Control policial',  creates_block: false },
  { key: 'accident',     label: '🚨 Accidente',         creates_block: false },
  { key: 'road_work',    label: '🚧 Obras',             creates_block: false },
  { key: 'low_bridge',   label: '🌉 Puente bajo',       creates_block: true  },
  { key: 'road_closed',  label: '🚫 Calle cerrada',     creates_block: true  },
  { key: 'weight_check', label: '⚖️ Control de peso',  creates_block: false },
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
  var userMarker=null, originMarker=null, destMarker=null, routeLayers=[], incidentMarkers=[];
  var navActive=false, headingMarker=null;

  function setMapTheme(dark) {
    if (dark) map.getContainer().classList.add('night-mode');
    else map.getContainer().classList.remove('night-mode');
  }

  // El marcador concreto lo decide React Native segun el campo activo (origen/destino)
  map.on('click', function(e) {
    if (navActive) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'mapClick', lat: e.latlng.lat, lng: e.latlng.lng
    }));
    // El marcador (origen o destino) lo coloca React Native segun el campo activo.
  });

  function setUserLocation(lat, lng) {
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker([lat, lng], {
      radius: 7, fillColor: '#E5342B', color: 'white', weight: 2, fillOpacity: 1
    }).addTo(map);
    map.setView([lat, lng], 14);
  }

  // Punto de partida elegido a mano (distinto del GPS): pin verde
  function setOriginMarker(lat, lng) {
    if (originMarker) map.removeLayer(originMarker);
    originMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="background:#34C759;width:14px;height:14px;border-radius:50%;border:2.5px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>',
        iconAnchor: [7, 7]
      })
    }).addTo(map);
  }

  function removeOriginMarker() {
    if (originMarker) { map.removeLayer(originMarker); originMarker = null; }
  }

  function setDestMarker(lat, lng) {
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="background:#FF6B35;width:14px;height:14px;border-radius:50%;border:2.5px solid white"></div>',
        iconAnchor: [7, 7]
      })
    }).addTo(map);
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
    if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  }

  var ICONS = {
    fine:'💸', police_check:'👮', accident:'🚨',
    road_work:'🚧', low_bridge:'🌉', road_closed:'🚫',
    weight_check:'⚖️', other:'⚠️'
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
      radius: 9, fillColor: '#E5342B', color: 'white', weight: 3, fillOpacity: 1
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
        radius: 7, fillColor: '#E5342B', color: 'white', weight: 2, fillOpacity: 1
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
    var poly = L.polyline(latlngs, { color: '#E5342B', weight: 5, opacity: 0.9, lineCap: 'round' }).addTo(map);
    routeLayers.push(poly);
    L.circleMarker(latlngs[0], { radius: 8, fillColor: '#1F9D57', color: 'white', weight: 2.5, fillOpacity: 1 }).addTo(map);
    var dest = latlngs[latlngs.length - 1];
    L.circleMarker(dest, { radius: 8, fillColor: '#E5342B', color: 'white', weight: 2.5, fillOpacity: 1 }).addTo(map);
    map.fitBounds(poly.getBounds(), { padding: [80, 80] });
  }
</script>
</body>
</html>`

export default function MapScreen() {
  const webRef = useRef<WebView>(null)
  const reportModeRef = useRef(false)
  const searchTimeout = useRef<any>(null)

  const isDark = useStore(st => st.isDark)
  const toggleTheme = useStore(st => st.toggleTheme)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])

  const { activeVehicle, currentRoute, destination, setCurrentRoute, setOrigin, setDestination } = useStore()
  const profile = useStore(st => st.profile)
  const mapSource = useMemo(() => ({ html: MAP_HTML }), [])

  // Cargar el vehículo activo si todavía no está en el store. Antes los
  // vehículos solo se cargaban al entrar a Perfil, por eso el mapa mostraba
  // "Configurá tu camión" aunque el usuario ya tuviera uno (hasta visitar Perfil).
  // checkedVehicles evita el "flash" del cartel mientras la consulta está en curso.
  const [checkedVehicles, setCheckedVehicles] = useState(false)
  useEffect(() => {
    if (activeVehicle || !profile) return
    supabase
      .from('st_vehicles')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data?.length) {
          const { setVehicles, setActiveVehicle } = useStore.getState()
          setVehicles(data)
          setActiveVehicle(data.find(v => v.is_default) ?? data[0])
        }
        setCheckedVehicles(true)
      })
  }, [profile, activeVehicle])

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [reportMode, setReportMode] = useState(false)
  const [showIncidentModal, setShowIncidentModal] = useState(false)
  const [incidentLocation, setIncidentLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [reportingIncident, setReportingIncident] = useState(false)

  // Destino
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [navMode, setNavMode] = useState(false)
  const watchRef = useRef<any>(null)

  // ── Trip visualization (navegado desde Viajes) ─────────────────────────
  const { tripId } = useLocalSearchParams<{ tripId?: string }>()
  const router = useRouter()
  const [tripSheet, setTripSheet] = useState<AssignedTrip | null>(null)
  const [tripUpdating, setTripUpdating] = useState(false)
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Monitor de desvío de ruta (pasos 1-2) ─────────────────────────────
  // Vigila la posición GPS contra la ruta planificada del viaje en curso y, al
  // confirmarse un desvío, recalcula la ruta desde la posición actual.
  const monitorRef = useRef<DeviationMonitorState>(createDeviationMonitor())
  const tripRouteRef = useRef<LatLng[]>([])
  const tripOriginRef = useRef<LatLng | null>(null)
  const tripDestRef = useRef<LatLng | null>(null)
  const tripVehicleRef = useRef<{ weight_kg: number; height_m: number; width_m: number } | null>(null)
  const [recalculating, setRecalculating] = useState(false)

  const loadTripById = useCallback(async (id: string) => {
    try {
      const all = await fetchAllMyTrips()
      const found = all.find(t => String(t.id) === id)
      if (found) {
        setTripSheet(found)
        // Draw trip route on map
        const path = (() => {
          try {
            const p = typeof found.path === 'string' ? JSON.parse(found.path) : found.path
            return (p?.path || p?.polyline || p?.segments?.flatMap((s: any) => s.coordinates) || []) as { lat: number; lon?: number; lng?: number }[]
          } catch { return [] }
        })()
        // Alimentar el monitor de desvío con la ruta planificada y los extremos del viaje
        tripRouteRef.current = path.map(toLatLng)
        tripOriginRef.current = found.origin_lat != null && found.origin_lon != null
          ? { lat: found.origin_lat, lng: found.origin_lon } : null
        tripDestRef.current = found.destination_lat != null && found.destination_lon != null
          ? { lat: found.destination_lat, lng: found.destination_lon } : null
        tripVehicleRef.current = null // dims del camión: se resuelven al primer recálculo
        webRef.current?.injectJavaScript(
          `drawTripPath(${JSON.stringify(path)}, ${found.origin_lat ?? 'null'}, ${found.origin_lon ?? 'null'}, ${found.destination_lat ?? 'null'}, ${found.destination_lon ?? 'null'}); true;`
        )
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (tripId) {
      void loadTripById(tripId)
    } else {
      setTripSheet(null)
      if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null }
    }
  }, [tripId])

  // Dims del camión para el recálculo: el vehículo activo del store o, si no hay
  // (caso chofer), el camión asignado. Se resuelve una sola vez por viaje.
  const resolveTripVehicle = async (): Promise<{ weight_kg: number; height_m: number; width_m: number } | null> => {
    if (activeVehicle) return { weight_kg: activeVehicle.weight_kg, height_m: activeVehicle.height_m, width_m: activeVehicle.width_m }
    if (tripVehicleRef.current) return tripVehicleRef.current
    const truck = await fetchMyAssignedTruck().catch(() => null)
    if (truck) {
      tripVehicleRef.current = { weight_kg: truck.max_weight_kg, height_m: truck.max_height_m, width_m: truck.max_width_m }
      return tripVehicleRef.current
    }
    return null
  }

  // Recalcula la ruta desde la posición actual hacia el destino del viaje y la
  // redibuja. Espeja la llamada de `calculateRoute` (mismo endpoint y forma),
  // pero sin crear un viaje nuevo ni abrir la tarjeta de ruta: es silencioso.
  // El aviso al chofer (globito) es el paso 4; acá solo se actualiza el mapa.
  const recalculateAfterDeviation = async (fromLat: number, fromLng: number) => {
    const dest = tripDestRef.current
    if (!dest) return
    const vehicle = await resolveTripVehicle()
    if (!vehicle) return
    setRecalculating(true)
    try {
      const res = await fetch(`${BACKEND}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: { lat: fromLat, lng: fromLng }, destination: { lat: dest.lat, lng: dest.lng }, vehicle }),
      })
      const data = await res.json()
      if (!res.ok || !data.route) throw new Error(data.error ?? 'No se pudo recalcular la ruta')
      setCurrentRoute(data.route)
      webRef.current?.injectJavaScript(`drawRoute(${JSON.stringify(data.route.segments)}); true;`)
      // El monitor pasa a vigilar la ruta nueva; arranca de cero para no
      // arrastrar la racha del desvío recién resuelto.
      const nuevos = (data.route.segments ?? []).flatMap((s: any) => s.coordinates ?? [])
      if (nuevos.length >= 2) tripRouteRef.current = nuevos.map(toLatLng)
      monitorRef.current = createDeviationMonitor()
    } catch {
      // Silencioso por ahora; el aviso de fallo de recálculo se define en el paso 4.
    } finally {
      setRecalculating(false)
    }
  }

  // GPS tracking + detección de desvío para el viaje en curso.
  // Frecuencia de muestreo a 5s (antes 15s): 15s es demasiado grueso para
  // detectar un desvío a tiempo. El envío de ubicación a la central se mantiene
  // throttled a 15s para no multiplicar la carga del servidor.
  useEffect(() => {
    if (!tripSheet || tripSheet.status !== 'in_progress') {
      if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null }
      return
    }
    monitorRef.current = createDeviationMonitor() // racha limpia al arrancar el viaje
    let lastSentAt = 0
    const tick = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const lat = loc.coords.latitude, lng = loc.coords.longitude
      const nowMs = Date.now()
      // 1) Compartir ubicación con la central (throttled a 15s)
      if (nowMs - lastSentAt >= 15_000) {
        lastSentAt = nowMs
        await sendLocation(lat, lng, String(tripSheet.id), profile?.full_name ?? 'Conductor', tripSheet.truck_patente ?? undefined).catch(() => null)
      }
      // 2) Detección de desvío contra la ruta planificada
      const route = tripRouteRef.current
      const origin = tripOriginRef.current
      const dest = tripDestRef.current
      if (route.length >= 2 && origin && dest) {
        const r = stepDeviationMonitor(monitorRef.current, { point: { lat, lng }, route, origin, destination: dest, now: nowMs })
        monitorRef.current = r.state
        if (r.triggered) void recalculateAfterDeviation(lat, lng)
      }
    }
    void tick()
    gpsIntervalRef.current = setInterval(() => void tick(), 5_000)
    return () => { if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null } }
  }, [tripSheet?.id, tripSheet?.status])

  const handleTripAction = async (newStatus: AssignedTrip['status']) => {
    if (!tripSheet) return
    setTripUpdating(true)
    try {
      await updateTripStatus(String(tripSheet.id), newStatus)
      if (newStatus === 'completed') await clearLocation().catch(() => null)
      if (newStatus === 'in_progress' && location) {
        webRef.current?.injectJavaScript(
          `map.flyTo([${location.lat}, ${location.lng}], 16, { animate: true, duration: 1.2 }); true;`
        )
      }
      setTripSheet(prev => prev ? { ...prev, status: newStatus } : null)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setTripUpdating(false)
    }
  }

  // Origen — por defecto el GPS ("Mi ubicación"); editable a mano
  const [originText, setOriginText] = useState('Mi ubicación')
  const [originResults, setOriginResults] = useState<any[]>([])
  const [originSearching, setOriginSearching] = useState(false)
  const [showOriginSearch, setShowOriginSearch] = useState(false)
  // Coordenadas de origen elegidas a mano. null = usar GPS (location)
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null)
  // Campo al que aplica un tap en el mapa
  const [activeField, setActiveField] = useState<'origin' | 'destination'>('destination')
  const originTimeout = useRef<any>(null)

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

  const geocode = async (query: string): Promise<any[]> => {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Buenos Aires, Argentina')}&format=json&limit=5&countrycodes=ar&bounded=1&viewbox=-59.2,-35.1,-57.8,-34.2`,
      { headers: { 'User-Agent': 'SafeTruck/1.0' } }
    )
    return res.json()
  }

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

  // ── Destino ──────────────────────────────────────────────
  const searchAddress = async (query: string) => {
    if (query.length < 3) { setSearchResults([]); return }
    setSearching(true)
    try {
      setSearchResults(await geocode(query))
    } catch (e) {
      console.log('Search error:', e)
    } finally {
      setSearching(false)
    }
  }

  const onSearchChange = (text: string) => {
    setSearchText(text)
    setActiveField('destination')
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
    webRef.current?.injectJavaScript(`setDestMarker(${lat}, ${lng}); map.setView([${lat}, ${lng}], 15); true;`)
    calculateRoute(lat, lng)
  }

  // ── Origen ───────────────────────────────────────────────
  const searchOrigin = async (query: string) => {
    if (query.length < 3) { setOriginResults([]); return }
    setOriginSearching(true)
    try {
      setOriginResults(await geocode(query))
    } catch (e) {
      console.log('Origin search error:', e)
    } finally {
      setOriginSearching(false)
    }
  }

  const onOriginChange = (text: string) => {
    setOriginText(text)
    setActiveField('origin')
    if (originTimeout.current) clearTimeout(originTimeout.current)
    originTimeout.current = setTimeout(() => searchOrigin(text), 400)
  }

  const selectOrigin = (result: any) => {
    const lat = parseFloat(result.lat)
    const lng = parseFloat(result.lon)
    setOriginText(result.display_name.split(',').slice(0, 2).join(','))
    setOriginResults([])
    setShowOriginSearch(false)
    Keyboard.dismiss()
    setOrigin(applyOrigin({ lat, lng }))
  }

  // Vuelve a usar el GPS como punto de partida
  const resetOriginToGps = () => {
    setOriginCoords(null)
    setOriginText('Mi ubicación')
    setOriginResults([])
    setShowOriginSearch(false)
    webRef.current?.injectJavaScript(`removeOriginMarker(); true;`)
    if (location) {
      webRef.current?.injectJavaScript(`map.setView([${location.lat}, ${location.lng}], 14); true;`)
      setOrigin(location)
    }
    // Recalcular con el GPS si ya hay destino fijado
    if (destination) calculateRoute(destination.lat, destination.lng, location)
  }

  // Fija un origen elegido a mano: marca el mapa y recalcula si hay destino
  const applyOrigin = (coords: { lat: number; lng: number }) => {
    setOriginCoords(coords)
    webRef.current?.injectJavaScript(`setOriginMarker(${coords.lat}, ${coords.lng}); map.setView([${coords.lat}, ${coords.lng}], 15); true;`)
    if (destination) calculateRoute(destination.lat, destination.lng, coords)
    return coords
  }

  const loadIncidents = async () => {
    const { data } = await supabase
      .from('st_incidents')
      .select('*')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
    if (data) webRef.current?.injectJavaScript(`loadIncidents(${JSON.stringify(data)}); true;`)
  }

  const toggleReportMode = () => {
    const newMode = !reportMode
    setReportMode(newMode)
    reportModeRef.current = newMode
    if (newMode) Alert.alert('Modo reporte', 'Tocá el lugar en el mapa donde ocurrió el incidente')
  }

  const calculateRoute = async (
    destLat: number,
    destLng: number,
    originOverride?: { lat: number; lng: number } | null,
  ) => {
    if (loading) return
    // Origen: el pasado explícitamente, el elegido a mano, o el GPS
    const routeOrigin = originOverride ?? originCoords ?? location
    if (!routeOrigin) return Alert.alert('Error', 'Esperando GPS o elegí un punto de partida')
    if (!activeVehicle) return Alert.alert('Sin vehículo', 'Configurá tu camión en Perfil')
    webRef.current?.injectJavaScript(`clearRoute(); true;`)
    setCurrentRoute(null)
    setShowInfo(false)
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND}/route`, {
        method: 'POST',
        signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 60000); return c.signal })(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: routeOrigin,
          destination: { lat: destLat, lng: destLng },
          vehicle: {
            weight_kg: activeVehicle.weight_kg,
            height_m: activeVehicle.height_m,
            width_m: activeVehicle.width_m,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCurrentRoute(data.route)
      setDestination({ lat: destLat, lng: destLng })
      setShowInfo(true)

      // Mantener visible el marcador del punto de partida cuando no es el GPS
      if (originCoords || originOverride) {
        webRef.current?.injectJavaScript(`setOriginMarker(${routeOrigin.lat}, ${routeOrigin.lng}); true;`)
      }

      if (profile && activeVehicle) {
        const originIsGps = !(originOverride ?? originCoords)
        supabase.rpc('insert_trip', {
          p_user_id: profile.id,
          p_vehicle_id: activeVehicle.id,
          p_origin_lat: routeOrigin.lat,
          p_origin_lng: routeOrigin.lng,
          p_dest_lat: destLat,
          p_dest_lng: destLng,
          p_origin_address: originIsGps
            ? `${routeOrigin.lat.toFixed(4)}, ${routeOrigin.lng.toFixed(4)}`
            : (originText || `${routeOrigin.lat.toFixed(4)}, ${routeOrigin.lng.toFixed(4)}`),
          p_dest_address: searchText || `${destLat.toFixed(4)}, ${destLng.toFixed(4)}`,
          p_distance_km: data.route.total_distance_km,
          p_duration_min: data.route.total_duration_min,
        }).then(({ error }) => { if (error) console.log('Trip error:', error) })
      }

      webRef.current?.injectJavaScript(`drawRoute(${JSON.stringify(data.route.segments)}); true;`)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  const reportIncident = async (type: string, creates_block: boolean) => {
    if (!incidentLocation || !profile) return
    setReportingIncident(true)
    try {
      const { data: incidentId, error } = await supabase.rpc('insert_incident', {
        p_user_id: profile.id,
        p_lat: incidentLocation.lat,
        p_lng: incidentLocation.lng,
        p_type: type,
      })
      if (error) throw error
      if (creates_block) {
        await supabase.rpc('insert_cooperative_block', {
          p_incident_id: incidentId,
          p_lat: incidentLocation.lat,
          p_lng: incidentLocation.lng,
          p_reason: type,
        })
      }
      setShowIncidentModal(false)
      setReportMode(false)
      reportModeRef.current = false
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
        if (reportModeRef.current) {
          setIncidentLocation({ lat: msg.lat, lng: msg.lng })
          setShowIncidentModal(true)
        } else if (activeField === 'origin') {
          // El tap fija el punto de partida
          setOriginText(`${msg.lat.toFixed(5)}, ${msg.lng.toFixed(5)}`)
          setOriginResults([])
          setShowOriginSearch(false)
          setOrigin(applyOrigin({ lat: msg.lat, lng: msg.lng }))
        } else {
          // El tap fija el destino: marcador inmediato + direccion linda via reverseGeocode
          setSearchText(`${msg.lat.toFixed(5)}, ${msg.lng.toFixed(5)}`)
          webRef.current?.injectJavaScript(`setDestMarker(${msg.lat}, ${msg.lng}); true;`)
          reverseGeocode(msg.lat, msg.lng).then(setSearchText)
          calculateRoute(msg.lat, msg.lng)
        }
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
        onLoadEnd={() => webRef.current?.injectJavaScript(`setMapTheme(${isDark}); true;`)}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
      />

      {/* Header */}
      <View style={s.header}>
        {/* Barra de búsqueda: Origen + Destino */}
        <View style={s.searchRow}>
          <View style={s.searchWidget}>
            {/* Origen (punto de partida) */}
            <View style={s.fieldRow}>
              <View style={[s.fieldDot, { backgroundColor: t.success }]} />
              <TextInput
                style={s.searchInput}
                placeholder="Punto de partida"
                placeholderTextColor={t.textMuted}
                value={originText}
                onChangeText={onOriginChange}
                onFocus={() => { setActiveField('origin'); setShowOriginSearch(true) }}
                returnKeyType="search"
                onSubmitEditing={() => searchOrigin(originText)}
              />
              {originCoords ? (
                <TouchableOpacity onPress={resetOriginToGps} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="locate" size={16} color={t.accent} />
                </TouchableOpacity>
              ) : (
                <Ionicons name="navigate-circle-outline" size={16} color={t.textMuted} />
              )}
            </View>

            <View style={s.fieldDivider} />

            {/* Destino */}
            <View style={s.fieldRow}>
              <View style={[s.fieldDot, { backgroundColor: t.accent }]} />
              <TextInput
                style={s.searchInput}
                placeholder="Buscar destino..."
                placeholderTextColor={t.textMuted}
                value={searchText}
                onChangeText={onSearchChange}
                onFocus={() => { setActiveField('destination'); setShowSearch(true) }}
                returnKeyType="search"
                onSubmitEditing={() => searchAddress(searchText)}
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => { setSearchText(''); setSearchResults([]); setShowSearch(false) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={s.searchClear}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={s.headerBtns}>
            <TouchableOpacity style={s.iconBtn} onPress={toggleTheme}>
              <Ionicons
                name={isDark ? 'sunny-outline' : 'moon-outline'}
                size={18}
                color={t.text}
              />
            </TouchableOpacity>

            {currentRoute && (
              <TouchableOpacity style={[s.iconBtn, s.iconBtnDanger]} onPress={clearRoute}>
                <Ionicons name="close-outline" size={18} color={t.danger} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Resultados de búsqueda — origen */}
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
                <Text style={s.searchResultName} numberOfLines={1}>
                  {result.display_name.split(',')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Resultados de búsqueda — destino */}
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
      </View>

      {/* Banner sin vehículo — solo tras confirmar que realmente no hay ninguno */}
      {!activeVehicle && checkedVehicles && (
        <View style={s.banner}>
          <Text style={s.bannerText}>⚠️ Configurá tu camión en Perfil</Text>
        </View>
      )}

      {/* Hint inicial */}
      {!currentRoute && !loading && activeVehicle && !reportMode && searchText.length === 0 && (
        <View style={s.hintPill}>
          <Text style={s.hintPillText}>Buscá un destino o tocá el mapa</Text>
        </View>
      )}

      {/* Hint modo reporte */}
      {reportMode && (
        <View style={[s.hintPill, { backgroundColor: t.dangerSoft, borderColor: t.danger }]}>
          <Text style={[s.hintPillText, { color: t.danger }]}>Tocá donde ocurrió el incidente</Text>
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
        <View style={s.routeCard}>
          <View style={s.routeCardHeader}>
            <View>
              <Text style={s.routeCardTitle}>Ruta calculada</Text>
              {currentRoute.has_unauthorized && (
                <View style={s.warnBadge}>
                  <Text style={s.warnBadgeText}>⚠️ Tramos no habilitados</Text>
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
        <View style={s.navHUD}>
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

      {/* FAB de reporte */}
      <TouchableOpacity
        style={[s.fab, reportMode && s.fabActive, showInfo && currentRoute && !navMode && s.fabRaised, navMode && s.fabNavRaised]}
        onPress={toggleReportMode}
        activeOpacity={0.85}
      >
        <Ionicons name={reportMode ? 'close' : 'warning'} size={32} color="#fff" />
      </TouchableOpacity>

      {/* Modal de incidente */}
      <Modal visible={showIncidentModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Reportar incidente</Text>
                <Text style={s.modalSubtitle}>¿Qué está pasando en esta ubicación?</Text>
              </View>
              <TouchableOpacity
                style={s.modalClose}
                onPress={() => { setShowIncidentModal(false); setReportMode(false); reportModeRef.current = false }}
              >
                <Text style={s.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ marginTop: 8 }}>
              {INCIDENT_TYPES.map(inc => (
                <TouchableOpacity
                  key={inc.key}
                  style={s.incidentBtn}
                  onPress={() => reportIncident(inc.key, inc.creates_block)}
                  disabled={reportingIncident}
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
        <View style={s.tripSheet}>
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
              <Text style={{ color: t.textMuted, fontSize: 14, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Truck badge */}
          {(tripSheet.truck_patente || tripSheet.truck_name) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Text style={{ fontSize: 14, color: t.textMuted }}>🚛</Text>
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
              {(tripSheet.status === 'pending' || tripSheet.status === 'accepted') && (
                <TouchableOpacity style={[s.tripSheetBtn, { backgroundColor: t.success, flex: 1 }]} onPress={() => handleTripAction('in_progress')}>
                  <Text style={s.tripSheetBtnText}>Iniciar viaje</Text>
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

    // Widget combinado origen + destino (estilo Waze)
    searchWidget: { flex: 1 },
    fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    fieldDot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
    fieldDivider: { height: 1, backgroundColor: t.border, marginVertical: 4, marginLeft: 17 },
    headerBtns: { gap: 8 },

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
      backgroundColor: t.accent,
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

    // Banner (sin vehículo) — debajo del widget origen/destino (2 filas)
    banner: {
      position: 'absolute', top: 160, left: 16, right: 16,
      backgroundColor: t.card, borderRadius: 999,
      borderWidth: 1, borderColor: t.warning,
      paddingHorizontal: 16, paddingVertical: 10,
    },
    bannerText: { color: t.warning, fontSize: 13, textAlign: 'center', fontWeight: '600' },

    // Hint pill (--dash-placeholder__tag style) — debajo del widget origen/destino (2 filas)
    hintPill: {
      position: 'absolute', top: 160,
      alignSelf: 'center', left: 16, right: 16,
      backgroundColor: t.card, borderRadius: 999,
      borderWidth: 1, borderColor: t.border,
      paddingHorizontal: 16, paddingVertical: 10,
    },
    hintPillText: { color: t.text, fontSize: 13, textAlign: 'center', fontWeight: '500' },

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

function isDarkTheme(t: Theme) { return t.bg === '#1C1C1E' }
