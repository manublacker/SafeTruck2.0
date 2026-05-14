import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'

export default function TripsScreen() {
  const profile = useStore(s => s.profile)
  const [trips, setTrips] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadTrips() }, [profile])

  const loadTrips = async () => {
    if (!profile) return
    setLoading(true)
    const { data } = await supabase
      .from('st_trips')
      .select('*, st_vehicles(name, plate)')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setTrips(data || [])
    setLoading(false)
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Mis viajes</Text>
        <Text style={s.subtitle}>{trips.length} viaje{trips.length !== 1 ? 's' : ''} registrado{trips.length !== 1 ? 's' : ''}</Text>
      </View>
      <FlatList
        data={trips}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadTrips} tintColor="#FF6B35" />}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🗺️</Text>
            <Text style={s.emptyText}>Todavía no tenés viajes registrados</Text>
            <Text style={s.emptyHint}>Calculá una ruta en el mapa para empezar</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.statusDot} />
              <Text style={s.cardDate}>{formatDate(item.created_at)}</Text>
              <Text style={s.cardVehicle}>{item.st_vehicles?.plate || 'Vehículo'}</Text>
            </View>
            <View style={s.route}>
              <View style={s.routePoint}>
                <View style={[s.dot, { backgroundColor: '#34C759' }]} />
                <Text style={s.routeText} numberOfLines={1}>
                  {item.origin_address || 'Origen'}
                </Text>
              </View>
              <View style={s.routeLine} />
              <View style={s.routePoint}>
                <View style={[s.dot, { backgroundColor: '#FF6B35' }]} />
                <Text style={s.routeText} numberOfLines={1}>
                  {item.destination_address || 'Destino'}
                </Text>
              </View>
            </View>
            <View style={s.stats}>
              <View style={s.stat}>
                <Text style={s.statVal}>{item.distance_km ?? '-'} km</Text>
                <Text style={s.statLbl}>Distancia</Text>
              </View>
              <View style={s.statDiv} />
              <View style={s.stat}>
                <Text style={s.statVal}>{item.duration_min ?? '-'} min</Text>
                <Text style={s.statLbl}>Duración est.</Text>
              </View>
              <View style={s.statDiv} />
              <View style={s.stat}>
                <Text style={[s.statVal, { color: '#34C759', fontSize: 12 }]}>
                  {item.status === 'completed' ? '✓ Completado' : item.status}
                </Text>
                <Text style={s.statLbl}>Estado</Text>
              </View>
            </View>
          </View>
        )}
      />
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#8E8E93', fontSize: 14, marginTop: 4 },
  card: { backgroundColor: '#2C2C2E', borderRadius: 16, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759', marginRight: 8 },
  cardDate: { color: '#8E8E93', fontSize: 12, flex: 1 },
  cardVehicle: { color: '#FF6B35', fontSize: 12, fontWeight: '600' },
  route: { marginBottom: 14 },
  routePoint: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  routeText: { color: '#fff', fontSize: 14, flex: 1 },
  routeLine: { width: 2, height: 16, backgroundColor: '#3A3A3C', marginLeft: 4, marginVertical: 2 },
  stats: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#3A3A3C', paddingTop: 12 },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { color: '#FF6B35', fontSize: 16, fontWeight: '700' },
  statLbl: { color: '#8E8E93', fontSize: 11, marginTop: 2 },
  statDiv: { width: 1, height: 30, backgroundColor: '#3A3A3C' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyHint: { color: '#8E8E93', fontSize: 14 },
})
