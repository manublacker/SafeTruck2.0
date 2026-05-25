import { useState, useEffect, useRef, useMemo } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  Modal, ScrollView, TextInput, Keyboard,
} from 'react-native'
import { WebView } from 'react-native-webview'
import * as Location from 'expo-location'
import { useStore } from '../../src/store/useStore'
import { supabase } from '../../src/services/supabase'
import { Theme, getTheme } from '../../src/theme'
import { Ionicons } from '@expo/vector-icons'
import React from 'react';

const BACKEND = "https://safetruck-backend-production.up.railway.app";

const INCIDENT_TYPES = [
  { key: 'fine',         label: '💸 Multa a camión',    creates_block: true  },
  { key: 'police_check', label: '👮 Control policial',  creates_block: false },
  { key: 'accident',     label: '🚨 Accidente',         creates_block: false },
  { key: 'road_work',    label: '🚧 Obras',             creates_block: false },
  { key: 'low_bridge',   label: '🌉 Puente bajo',       creates_block: true  },
  { key: 'road_closed',  label: '🚫 Calle cerrada',     creates_block: true  },
  { key: 'weight_check', label: '⚖️ Control de peso',  creates_block: false },
]

// El modo noche aplica filtro CSS sobre tiles OSM — fondo oscuro, calles visibles, parques verdes
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
  var map = L.map('map',{zoomControl:true}).setView([-34.6037,-58.3816],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© OSM', maxZoom:19
  }).addTo(map);
  var userMarker=null, destMarker=null, routeLayers=[], incidentMarkers=[];

  function setMapTheme(dark) {
    if (dark) map.getContainer().classList.add('night-mode');
    else map.getContainer().classList.remove('night-mode');
  }

  map.on('click', function(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'mapClick', lat: e.latlng.lat, lng: e.latlng.lng
    }));
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([e.latlng.lat, e.latlng.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="background:#FF6B35;width:14px;height:14px;border-radius:50%;border:2.5px solid white"></div>'
      })
    }).addTo(map);
  });

  function setUserLocation(lat, lng) {
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker([lat, lng], {
      radius: 7, fillColor: '#FF6B35', color: 'white', weight: 2, fillOpacity: 1
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

  const { activeVehicle, currentRoute, setCurrentRoute, setOrigin, setDestination } = useStore()
  const profile = useStore(st => st.profile)
  const mapSource = useMemo(() => ({ html: MAP_HTML }), [])

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [reportMode, setReportMode] = useState(false)
  const [showIncidentModal, setShowIncidentModal] = useState(false)
  const [incidentLocation, setIncidentLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [reportingIncident, setReportingIncident] = useState(false)

  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

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
    webRef.current?.injectJavaScript(`map.setView([${lat}, ${lng}], 15); true;`)
    calculateRoute(lat, lng)
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

  const calculateRoute = async (destLat: number, destLng: number) => {
    if (loading) return
    if (!location) return Alert.alert('Error', 'Esperando GPS...')
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
          origin: location,
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

      if (profile && activeVehicle) {
        supabase.rpc('insert_trip', {
          p_user_id: profile.id,
          p_vehicle_id: activeVehicle.id,
          p_origin_lat: location.lat,
          p_origin_lng: location.lng,
          p_dest_lat: destLat,
          p_dest_lng: destLng,
          p_origin_address: `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`,
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
    setCurrentRoute(null)
    setShowInfo(false)
    setSearchText('')
    webRef.current?.injectJavaScript(`clearRoute(); true;`)
  }

  const onMessage = (e: any) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data)
      if (msg.type === 'mapClick') {
        if (reportModeRef.current) {
          setIncidentLocation({ lat: msg.lat, lng: msg.lng })
          setShowIncidentModal(true)
        } else {
          setSearchText(`${msg.lat.toFixed(5)}, ${msg.lng.toFixed(5)}`)
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
        {/* Barra de búsqueda */}
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
              <TouchableOpacity onPress={() => { setSearchText(''); setSearchResults([]); setShowSearch(false) }}>
                <Text style={s.searchClear}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

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

        {/* Resultados de búsqueda */}
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

      {/* Banner sin vehículo */}
      {!activeVehicle && (
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
      {showInfo && currentRoute && (
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
            <TouchableOpacity onPress={() => setShowInfo(false)}>
              <Text style={s.routeCardClose}>▼</Text>
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

      {/* FAB de reporte */}
      <TouchableOpacity
        style={[s.fab, reportMode && s.fabActive, showInfo && currentRoute && s.fabRaised]}
        onPress={toggleReportMode}
        activeOpacity={0.85}
      >
        <Ionicons
          name={reportMode ? 'close' : 'warning'}
          size={32}
          color="#fff"
        />
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
    </View>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    map: { flex: 1 },

    // Header
    header: { position: 'absolute', top: 52, left: 16, right: 16 },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: t.card, borderRadius: 12,
      borderWidth: 1, borderColor: t.cardBorder,
      paddingHorizontal: 12, paddingVertical: 8,
      // Sombra solo en este elemento (es el modal de la web)
      shadowColor: '#000', shadowOpacity: isDarkTheme(t) ? 0.4 : 0.1,
      shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
    },
    searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },

    searchInput: { flex: 1, color: t.text, fontSize: 15, height: 36 },
    searchClear: { color: t.textMuted, fontSize: 14, paddingHorizontal: 4 },

    // Botones icono del header (ghost style)
    iconBtn: {
      backgroundColor: t.surface2, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 7,
    },
    iconBtnDanger: { backgroundColor: t.dangerSoft },

    // FAB de reporte (bottom right)
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

    // Dropdown de resultados
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

    // Banner (sin vehículo)
    banner: {
      position: 'absolute', top: 110, left: 16, right: 16,
      backgroundColor: t.card, borderRadius: 999,
      borderWidth: 1, borderColor: t.warning,
      paddingHorizontal: 16, paddingVertical: 10,
    },
    bannerText: { color: t.warning, fontSize: 13, textAlign: 'center', fontWeight: '600' },

    // Hint pill (--dash-placeholder__tag style)
    hintPill: {
      position: 'absolute', top: 110,
      alignSelf: 'center', left: 16, right: 16,
      backgroundColor: t.card, borderRadius: 999,
      borderWidth: 1, borderColor: t.border,
      paddingHorizontal: 16, paddingVertical: 10,
    },
    hintPillText: { color: t.text, fontSize: 13, textAlign: 'center', fontWeight: '500' },

    // Loading overlay
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

    // Tarjeta de ruta (flat bottom sheet)
    routeCard: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: t.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      borderTopWidth: 1, borderColor: t.border,
      padding: 20,
    },
    routeCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    routeCardTitle: { color: t.text, fontSize: 16, fontWeight: '700' },
    routeCardClose: { color: t.textMuted, fontSize: 18, paddingLeft: 16 },
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

    // Badge de advertencia (pill)
    warnBadge: {
      marginTop: 4, alignSelf: 'flex-start',
      backgroundColor: t.warningSoft, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 3,
    },
    warnBadgeText: { color: t.warning, fontSize: 11, fontWeight: '600' },

    // Modal de incidente
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

// Helper para saber si el tema es dark (para ajustar sombras)
function isDarkTheme(t: Theme) { return t.bg === '#1C1C1E' }
