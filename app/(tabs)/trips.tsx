import { useState, useEffect, useMemo } from 'react'
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert } from 'react-native'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'
import { router } from 'expo-router'
import React from 'react'

export default function TripsScreen() {
  const profile = useStore(s => s.profile)
  const isDark = useStore(s => s.isDark)
  const setDestination = useStore(s => s.setDestination)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])

  const [trips, setTrips] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'assigned' | 'completed'>('assigned')

  useEffect(() => {
    if (profile) loadTrips()
  }, [profile])

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

  const startTrip = async (trip: any) => {
    if (!trip.destination) {
      Alert.alert('Error', 'Este viaje no tiene destino configurado')
      return
    }

    // Marcar como en progreso
    await supabase
      .from('st_trips')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', trip.id)

    // Extraer coordenadas del destino (viene como GeoJSON o WKT)
    let destLat: number, destLng: number
    if (trip.destination?.coordinates) {
      destLng = trip.destination.coordinates[0]
      destLat = trip.destination.coordinates[1]
    } else {
      Alert.alert('Error', 'No se pudieron obtener las coordenadas del destino')
      return
    }

    setDestination({ lat: destLat, lng: destLng })
    router.push('/(tabs)')
    loadTrips()
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const assigned = trips.filter(t => t.status === 'pending' || t.status === 'in_progress')
  const completed = trips.filter(t => t.status === 'completed')
  const displayedTrips = tab === 'assigned' ? assigned : completed

  const getStatusColor = (status: string) => {
    if (status === 'pending') return '#FF9500'
    if (status === 'in_progress') return '#007AFF'
    return t.success
  }

  const getStatusLabel = (status: string) => {
    if (status === 'pending') return '⏳ Pendiente'
    if (status === 'in_progress') return '🚛 En curso'
    return '✓ Completado'
  }

  return (
    <View style={s.container}>
      <View style={s.topbar}>
        <Text style={s.topbarTitle}>Mis viajes</Text>
        <Text style={s.topbarSub}>
          {assigned.length} asignado{assigned.length !== 1 ? 's' : ''} · {completed.length} completado{completed.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        <TouchableOpacity
          style={[s.tab, tab === 'assigned' && s.tabActive]}
          onPress={() => setTab('assigned')}
        >
          <Text style={[s.tabText, tab === 'assigned' && s.tabTextActive]}>
            Asignados {assigned.length > 0 && `(${assigned.length})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, tab === 'completed' && s.tabActive]}
          onPress={() => setTab('completed')}
        >
          <Text style={[s.tabText, tab === 'completed' && s.tabTextActive]}>
            Completados
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={displayedTrips}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadTrips} tintColor={t.accent} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Text style={{ fontSize: 28 }}>{tab === 'assigned' ? '📋' : '🗺️'}</Text>
            </View>
            <Text style={s.emptyTitle}>
              {tab === 'assigned' ? 'Sin viajes asignados' : 'Sin viajes completados'}
            </Text>
            <Text style={s.emptyText}>
              {tab === 'assigned'
                ? 'Tu empresa te asignará viajes desde el portal web'
                : 'Calculá una ruta en el mapa para empezar'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={[s.cardAccent, { backgroundColor: getStatusColor(item.status) }]} />
            <View style={s.cardBody}>
              <View style={s.cardHeader}>
                <Text style={s.cardDate}>{formatDate(item.created_at)}</Text>
                <View style={[s.vehicleBadge, { backgroundColor: t.accentSoft }]}>
                  <Text style={s.vehicleBadgeText}>{item.st_vehicles?.plate || 'Vehículo'}</Text>
                </View>
              </View>

              {item.notes && (
                <Text style={s.notes}>📝 {item.notes}</Text>
              )}

              <View style={s.route}>
                <View style={s.routePoint}>
                  <View style={[s.routeDot, { backgroundColor: t.success }]} />
                  <Text style={s.routeText} numberOfLines={1}>{item.origin_address || 'Origen'}</Text>
                </View>
                <View style={s.routeLine} />
                <View style={s.routePoint}>
                  <View style={[s.routeDot, { backgroundColor: t.accent }]} />
                  <Text style={s.routeText} numberOfLines={1}>{item.destination_address || 'Destino'}</Text>
                </View>
              </View>

              <View style={s.statsRow}>
                <View style={s.statItem}>
                  <Text style={s.statVal}>{item.distance_km ?? '—'} km</Text>
                  <Text style={s.statLbl}>DISTANCIA</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statItem}>
                  <Text style={s.statVal}>{item.duration_min ?? '—'} min</Text>
                  <Text style={s.statLbl}>DURACIÓN EST.</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statItem}>
                  <View style={[s.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
                    <Text style={[s.statusBadgeText, { color: getStatusColor(item.status) }]}>
                      {getStatusLabel(item.status)}
                    </Text>
                  </View>
                  <Text style={s.statLbl}>ESTADO</Text>
                </View>
              </View>

              {/* Botón iniciar para viajes pendientes */}
              {item.status === 'pending' && (
                <TouchableOpacity
                  style={s.startBtn}
                  onPress={() => startTrip(item)}
                >
                  <Text style={s.startBtnText}>▶ Iniciar viaje</Text>
                </TouchableOpacity>
              )}

              {item.status === 'in_progress' && (
                <TouchableOpacity
                  style={[s.startBtn, { backgroundColor: '#007AFF' }]}
                  onPress={() => startTrip(item)}
                >
                  <Text style={s.startBtnText}>🚛 Continuar viaje</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />
    </View>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    topbar: {
      paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16,
      borderBottomWidth: 1, borderBottomColor: t.border,
      backgroundColor: t.bg,
    },
    topbarTitle: { color: t.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
    topbarSub: { color: t.textMuted, fontSize: 14, marginTop: 3 },

    tabs: {
      flexDirection: 'row',
      paddingHorizontal: 16, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: t.border,
      backgroundColor: t.bg,
    },
    tab: {
      flex: 1, paddingVertical: 8, alignItems: 'center',
      borderRadius: 8,
    },
    tabActive: { backgroundColor: t.accentSoft },
    tabText: { color: t.textMuted, fontSize: 14, fontWeight: '500' },
    tabTextActive: { color: t.accent, fontWeight: '700' },

    card: {
      flexDirection: 'row',
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1, borderColor: t.cardBorder,
      overflow: 'hidden',
    },
    cardAccent: { width: 4 },
    cardBody: { flex: 1, padding: 16 },
    cardHeader: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', marginBottom: 10,
    },
    cardDate: { color: t.textSoft, fontSize: 12 },
    vehicleBadge: {
      borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
    },
    vehicleBadgeText: { color: t.accent, fontSize: 12, fontWeight: '600' },
    notes: { color: t.textMuted, fontSize: 13, marginBottom: 10, fontStyle: 'italic' },

    route: { marginBottom: 14 },
    routePoint: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
    routeDot: { width: 9, height: 9, borderRadius: 5, marginRight: 10, flexShrink: 0 },
    routeText: { color: t.text, fontSize: 14, flex: 1 },
    routeLine: { width: 1, height: 12, backgroundColor: t.border, marginLeft: 4, marginVertical: 1 },

    statsRow: {
      flexDirection: 'row', alignItems: 'center',
      borderTopWidth: 1, borderTopColor: t.border, paddingTop: 12,
      marginBottom: 12,
    },
    statItem: { flex: 1, alignItems: 'center' },
    statVal: { color: t.accent, fontSize: 15, fontWeight: '700' },
    statLbl: { color: t.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginTop: 2 },
    statDivider: { width: 1, height: 28, backgroundColor: t.border },
    statusBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
    statusBadgeText: { fontSize: 11, fontWeight: '600' },

    startBtn: {
      backgroundColor: '#34C759',
      borderRadius: 10, padding: 12,
      alignItems: 'center',
    },
    startBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

    empty: { alignItems: 'center', paddingTop: 64 },
    emptyIcon: {
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: t.surface2,
      alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    },
    emptyTitle: { color: t.text, fontSize: 16, fontWeight: '600', marginBottom: 6 },
    emptyText: { color: t.textMuted, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  })
}