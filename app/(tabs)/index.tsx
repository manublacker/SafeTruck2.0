import { useState, useEffect, useRef } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal, ScrollView } from 'react-native'
import { WebView } from 'react-native-webview'
import * as Location from 'expo-location'
import { useStore } from '../../src/store/useStore'
import { supabase } from '../../src/services/supabase'

const BACKEND = 'http://192.168.1.24:3001'

const INCIDENT_TYPES = [
  { key: 'fine', label: '💸 Multa a camión', creates_block: true },
  { key: 'police_check', label: '👮 Control policial', creates_block: false },
  { key: 'accident', label: '🚨 Accidente', creates_block: false },
  { key: 'road_work', label: '🚧 Obras', creates_block: false },
  { key: 'low_bridge', label: '🌉 Puente bajo', creates_block: true },
  { key: 'road_closed', label: '🚫 Calle cerrada', creates_block: true },
  { key: 'weight_check', label: '⚖️ Control de peso', creates_block: false },
]

export default function MapScreen() {
  const webRef = useRef<WebView>(null)
  const { activeVehicle, currentRoute, setCurrentRoute, setOrigin, setDestination } = useStore()
  const profile = useStore(s => s.profile)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [showIncidentModal, setShowIncidentModal] = useState(false)
  const [reportMode, setReportMode] = useState(false)
  const [incidentLocation, setIncidentLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [reportingIncident, setReportingIncident] = useState(false)

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

  const loadIncidents = async () => {
    const { data } = await supabase
      .from('st_incidents')
      .select('*')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
    if (data) {
      webRef.current?.injectJavaScript(`loadIncidents(${JSON.stringify(data)}); true;`)
    }
  }

  const calculateRoute = async (destLat: number, destLng: number) => {
    if (!location) return Alert.alert('Error', 'Esperando GPS...')
    if (!activeVehicle) return Alert.alert('Sin vehículo', 'Configurá tu camión en Perfil')
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND}/route`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: location,
          destination: { lat: destLat, lng: destLng },
          vehicle: { weight_kg: activeVehicle.weight_kg, height_m: activeVehicle.height_m, width_m: activeVehicle.width_m },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCurrentRoute(data.route)
      setDestination({ lat: destLat, lng: destLng })
      setShowInfo(true)
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
      const { data: incident, error } = await supabase
        .from('st_incidents')
        .insert({
          user_id: profile.id,
          location: `POINT(${incidentLocation.lng} ${incidentLocation.lat})`,
          incident_type: type,
          is_active: true,
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single()
      if (error) throw error
      if (creates_block) {
        await supabase.from('st_cooperative_blocks').insert({
          incident_id: incident.id,
          geom: `POINT(${incidentLocation.lng} ${incidentLocation.lat})`,
          block_reason: type,
          penalty_multiplier: 50.0,
          active: true,
          report_count: 1,
        })
      }
      setShowIncidentModal(false)
      setReportMode(false)
      Alert.alert('✅ Reporte enviado', 'Gracias por contribuir a SafeTruck')
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
    webRef.current?.injectJavaScript(`clearRoute(); true;`)
  }

  const onMessage = (e: any) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data)
      if (msg.type === 'mapClick') {
        if (reportMode) {
          setIncidentLocation({ lat: msg.lat, lng: msg.lng })
          setShowIncidentModal(true)
        } else {
          calculateRoute(msg.lat, msg.lng)
        }
      }
    } catch {}
  }

  const mapHtml = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>* { margin:0;padding:0;box-sizing:border-box; } html,body,#map { width:100%;height:100%; }</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map',{zoomControl:true}).setView([-34.6037,-58.3816],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxZoom:19}).addTo(map);
  var userMarker=null,destMarker=null,routeLayers=[],incidentMarkers=[];

  map.on('click',function(e){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapClick',lat:e.latlng.lat,lng:e.latlng.lng}));
    if(destMarker) map.removeLayer(destMarker);
    destMarker=L.marker([e.latlng.lat,e.latlng.lng],{icon:L.divIcon({className:'',html:'<div style="background:#FF6B35;width:16px;height:16px;border-radius:50%;border:3px solid white"></div>'})}).addTo(map);
  });

  function setUserLocation(lat,lng){
    if(userMarker) map.removeLayer(userMarker);
    userMarker=L.circleMarker([lat,lng],{radius:8,fillColor:'#007AFF',color:'white',weight:2,fillOpacity:1}).addTo(map);
    map.setView([lat,lng],14);
  }

  function drawRoute(segments){
    clearRoute();
    var colors={ok:'#34C759',unauthorized:'#FF3B30',unknown:'#FF9500'};
    var bounds=[];
    segments.forEach(function(seg){
      if(!seg.coordinates||seg.coordinates.length<2) return;
      var latlngs=seg.coordinates.map(function(c){return[c.lat,c.lng];});
      var line=L.polyline(latlngs,{color:colors[seg.status]||colors.unknown,weight:6,opacity:0.9,dashArray:seg.status==='unauthorized'?'10,6':null}).addTo(map);
      routeLayers.push(line);
      bounds=bounds.concat(latlngs);
    });
    if(bounds.length>0) map.fitBounds(bounds,{padding:[80,40]});
  }

  function clearRoute(){
    routeLayers.forEach(function(l){map.removeLayer(l);});
    routeLayers=[];
  }

  var ICONS={fine:'💸',police_check:'👮',accident:'🚨',road_work:'��',low_bridge:'🌉',road_closed:'🚫',weight_check:'⚖️',other:'⚠️'};

  function addIncidentMarker(lat,lng,type){
    var marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div style="font-size:24px;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.5))">'+(ICONS[type]||'⚠️')+'</div>',iconAnchor:[12,12]})}).addTo(map);
    incidentMarkers.push(marker);
  }

  function loadIncidents(incidents){
    incidentMarkers.forEach(function(m){map.removeLayer(m);});
    incidentMarkers=[];
    incidents.forEach(function(inc){
      if(!inc.location) return;
      var lat,lng;
      if(typeof inc.location==='string'){
        var m=inc.location.match(/POINT\\(([\\d.-]+) ([\\d.-]+)\\)/);
        if(m){lng=parseFloat(m[1]);lat=parseFloat(m[2]);}
      } else if(inc.location.coordinates){lng=inc.location.coordinates[0];lat=inc.location.coordinates[1];}
      if(lat&&lng) addIncidentMarker(lat,lng,inc.incident_type);
    });
  }
</script>
</body>
</html>`

  return (
    <View style={s.container}>
      <WebView ref={webRef} style={s.map} source={{html:mapHtml}} onMessage={onMessage} javaScriptEnabled domStorageEnabled originWhitelist={['*']} />

      <View style={s.header}>
        <Text style={s.headerText}>🚛 SafeTruck</Text>
        {currentRoute && <TouchableOpacity style={s.clearBtn} onPress={clearRoute}><Text style={s.clearBtnText}>✕</Text></TouchableOpacity>}
      </View>

      {/* Botón reportar incidente */}
      <TouchableOpacity
        style={[s.reportBtn, reportMode && s.reportBtnActive]}
        onPress={() => {
          setReportMode(!reportMode)
          if (!reportMode) Alert.alert('Modo reporte', 'Tocá el lugar en el mapa donde ocurrió el incidente')
        }}
      >
        <Text style={s.reportBtnText}>{reportMode ? '✕ Cancelar' : '⚠️ Reportar'}</Text>
      </TouchableOpacity>

      {!activeVehicle && (
        <View style={s.banner}><Text style={s.bannerText}>⚠️ Configurá tu camión en Perfil</Text></View>
      )}

      {!currentRoute && !loading && activeVehicle && !reportMode && (
        <View style={s.hint}><Text style={s.hintText}>Tocá el mapa para calcular ruta</Text></View>
      )}

      {reportMode && (
        <View style={[s.hint, {backgroundColor:'rgba(255,59,48,0.9)'}]}>
          <Text style={[s.hintText,{color:'#fff'}]}>Tocá donde ocurrió el incidente</Text>
        </View>
      )}

      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color="#FF6B35" />
          <Text style={s.loadingText}>Calculando ruta para camiones...</Text>
        </View>
      )}

      {showInfo && currentRoute && (
        <View style={s.routeCard}>
          <View style={s.routeCardHeader}>
            <Text style={s.routeCardTitle}>Ruta calculada</Text>
            <TouchableOpacity onPress={() => setShowInfo(false)}><Text style={s.routeCardClose}>▼</Text></TouchableOpacity>
          </View>
          <View style={s.stats}>
            <View style={s.stat}><Text style={s.statVal}>{currentRoute.total_distance_km} km</Text><Text style={s.statLbl}>Distancia</Text></View>
            <View style={s.statDiv} />
            <View style={s.stat}><Text style={s.statVal}>{currentRoute.total_duration_min} min</Text><Text style={s.statLbl}>Tiempo est.</Text></View>
          </View>
          <View style={s.legend}>
            <View style={s.legendItem}><View style={[s.legendDot,{backgroundColor:'#34C759'}]}/><Text style={s.legendText}>Habilitada</Text></View>
            <View style={s.legendItem}><View style={[s.legendDot,{backgroundColor:'#FF3B30'}]}/><Text style={s.legendText}>No habilitada</Text></View>
            <View style={s.legendItem}><View style={[s.legendDot,{backgroundColor:'#FF9500'}]}/><Text style={s.legendText}>Sin datos</Text></View>
          </View>
          {currentRoute.has_unauthorized && (
            <View style={s.warningBox}><Text style={s.warningText}>⚠️ Incluye tramos no habilitados para camiones</Text></View>
          )}
        </View>
      )}

      <Modal visible={showIncidentModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Reportar incidente</Text>
            <Text style={s.modalSubtitle}>¿Qué está pasando en esta ubicación?</Text>
            <ScrollView>
              {INCIDENT_TYPES.map(inc => (
                <TouchableOpacity key={inc.key} style={s.incidentBtn}
                  onPress={() => reportIncident(inc.key, inc.creates_block)}
                  disabled={reportingIncident}>
                  <Text style={s.incidentBtnText}>{inc.label}</Text>
                  {inc.creates_block && <Text style={s.incidentBtnTag}>Bloquea ruta</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.modalCancelBtn} onPress={() => { setShowIncidentModal(false); setReportMode(false) }}>
              <Text style={s.modalCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  container:{flex:1}, map:{flex:1},
  header:{position:'absolute',top:52,left:16,right:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#2C2C2E',borderRadius:12,paddingHorizontal:16,paddingVertical:12,shadowColor:'#000',shadowOpacity:0.3,shadowRadius:8,elevation:5},
  headerText:{color:'#fff',fontSize:16,fontWeight:'700'},
  clearBtn:{backgroundColor:'#FF3B30',borderRadius:8,paddingHorizontal:10,paddingVertical:4},
  clearBtnText:{color:'#fff',fontSize:13},
  reportBtn:{position:'absolute',bottom:160,right:16,backgroundColor:'#2C2C2E',borderRadius:12,paddingHorizontal:14,paddingVertical:10,shadowColor:'#000',shadowOpacity:0.3,shadowRadius:6,elevation:4},
  reportBtnActive:{backgroundColor:'#FF3B30'},
  reportBtnText:{color:'#fff',fontSize:13,fontWeight:'600'},
  banner:{position:'absolute',top:116,left:16,right:100,backgroundColor:'#FF9500',borderRadius:10,padding:12},
  bannerText:{color:'#fff',fontSize:13,textAlign:'center',fontWeight:'600'},
  hint:{position:'absolute',top:116,left:16,right:100,backgroundColor:'rgba(44,44,46,0.9)',borderRadius:10,padding:12},
  hintText:{color:'#8E8E93',fontSize:13,textAlign:'center'},
  loadingOverlay:{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(0,0,0,0.6)',alignItems:'center',justifyContent:'center'},
  loadingText:{color:'#fff',marginTop:12,fontSize:16},
  routeCard:{position:'absolute',bottom:80,left:0,right:0,backgroundColor:'#2C2C2E',borderTopLeftRadius:20,borderTopRightRadius:20,padding:20},
  routeCardHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:16},
  routeCardTitle:{color:'#fff',fontSize:16,fontWeight:'700'},
  routeCardClose:{color:'#8E8E93',fontSize:18},
  stats:{flexDirection:'row',alignItems:'center',marginBottom:16},
  stat:{flex:1,alignItems:'center'},
  statVal:{color:'#FF6B35',fontSize:28,fontWeight:'700'},
  statLbl:{color:'#8E8E93',fontSize:12,marginTop:2},
  statDiv:{width:1,height:40,backgroundColor:'#3A3A3C'},
  legend:{flexDirection:'row',justifyContent:'space-around',marginBottom:12},
  legendItem:{flexDirection:'row',alignItems:'center'},
  legendDot:{width:10,height:10,borderRadius:5,marginRight:5},
  legendText:{color:'#8E8E93',fontSize:11},
  warningBox:{backgroundColor:'rgba(255,149,0,0.15)',borderRadius:8,padding:10},
  warningText:{color:'#FF9500',fontSize:13,textAlign:'center'},
  modalOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'},
  modalCard:{backgroundColor:'#2C2C2E',borderTopLeftRadius:20,borderTopRightRadius:20,padding:24,maxHeight:'80%'},
  modalTitle:{color:'#fff',fontSize:18,fontWeight:'700',marginBottom:4},
  modalSubtitle:{color:'#8E8E93',fontSize:14,marginBottom:20},
  incidentBtn:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#3A3A3C',borderRadius:12,padding:16,marginBottom:8},
  incidentBtnText:{color:'#fff',fontSize:16},
  incidentBtnTag:{color:'#FF9500',fontSize:11,backgroundColor:'rgba(255,149,0,0.15)',paddingHorizontal:8,paddingVertical:2,borderRadius:6},
  modalCancelBtn:{marginTop:8,padding:16,alignItems:'center'},
  modalCancelText:{color:'#FF3B30',fontSize:16,fontWeight:'600'},
})
