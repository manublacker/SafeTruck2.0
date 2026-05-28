import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native'
import * as Location from 'expo-location'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'
import {
  fetchAllMyTrips,
  updateTripStatus,
  sendLocation,
  clearLocation,
  type AssignedTrip,
} from '../../src/services/assignedTrips'

const GPS_INTERVAL_MS = 15_000

const STATUS_LABELS: Record<string, string> = {
  pending:     'Pendiente',
  accepted:    'Aceptado',
  in_progress: 'En curso',
  completed:   'Completado',
  cancelled:   'Cancelado',
}

const STATUS_COLORS: Record<string, string> = {
  pending:     '#f59e0b',
  accepted:    '#2563eb',
  in_progress: '#16a34a',
  completed:   '#6b7280',
  cancelled:   '#dc2626',
}

export default function TripsScreen() {
  const profile = useStore(s => s.profile)
  const isDark = useStore(s => s.isDark)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])

  const [trips, setTrips]       = useState<AssignedTrip[]>([])
  const [loading, setLoading]   = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const activeTrip = trips.find(trip => trip.status === 'in_progress') ?? null
  const pollIntervalMs = activeTrip ? 15_000 : 30_000

  const loadTrips = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const data = await fetchAllMyTrips()
      setTrips(data)
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }, [profile])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void loadTrips()
    pollRef.current = setInterval(() => void loadTrips(), pollIntervalMs)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [loadTrips, pollIntervalMs])

  // GPS tracking mientras el viaje está en curso
  useEffect(() => {
    if (!activeTrip) {
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current)
        gpsIntervalRef.current = null
        void clearLocation()
      }
      return
    }

    async function sendCurrentLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      await sendLocation(
        loc.coords.latitude,
        loc.coords.longitude,
        activeTrip!.id,
        profile?.full_name ?? 'Conductor',
      ).catch(() => null)
    }

    void sendCurrentLocation()
    gpsIntervalRef.current = setInterval(() => void sendCurrentLocation(), GPS_INTERVAL_MS)

    return () => {
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current)
        gpsIntervalRef.current = null
      }
    }
  }, [activeTrip?.id])

  async function handleStatusChange(trip: AssignedTrip, newStatus: AssignedTrip['status']) {
    setUpdating(trip.id)
    try {
      await updateTripStatus(trip.id, newStatus)
      if (newStatus === 'completed') {
        await clearLocation()
      }
      await loadTrips()
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setUpdating(null)
    }
  }

  function confirmStatusChange(trip: AssignedTrip, newStatus: AssignedTrip['status'], label: string) {
    Alert.alert(
      label,
      `¿Confirmar "${label}" para el viaje\n${trip.origin_label ?? 'Origen'} → ${trip.destination_label ?? 'Destino'}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: label, onPress: () => void handleStatusChange(trip, newStatus) },
      ]
    )
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <View style={s.container}>
      <View style={s.topbar}>
        <Text style={s.topbarTitle}>Mis viajes</Text>
        <Text style={s.topbarSub}>
          {trips.length} viaje{trips.length !== 1 ? 's' : ''} asignado{trips.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <FlatList
        data={trips}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadTrips} tintColor={t.accent} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyIcon}><Text style={{ fontSize: 28 }}>🗺️</Text></View>
            <Text style={s.emptyTitle}>Sin viajes asignados</Text>
            <Text style={s.emptyText}>El empresario te asignará viajes desde la plataforma web</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isUpdating = updating === item.id
          const statusColor = STATUS_COLORS[item.status] ?? '#6b7280'

          return (
            <View style={s.card}>
              <View style={[s.cardAccent, { backgroundColor: statusColor }]} />
              <View style={s.cardBody}>
                <View style={s.cardHeader}>
                  <Text style={s.cardDate}>{formatDate(item.scheduled_at ?? item.created_at)}</Text>
                  <View style={[s.statusBadge, { backgroundColor: statusColor + '22' }]}>
                    <Text style={[s.statusBadgeText, { color: statusColor }]}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </Text>
                  </View>
                </View>

                <View style={s.route}>
                  <View style={s.routePoint}>
                    <View style={[s.routeDot, { backgroundColor: t.success }]} />
                    <Text style={s.routeText} numberOfLines={1}>{item.origin_label ?? 'Origen'}</Text>
                  </View>
                  <View style={s.routeLine} />
                  <View style={s.routePoint}>
                    <View style={[s.routeDot, { backgroundColor: t.accent }]} />
                    <Text style={s.routeText} numberOfLines={1}>{item.destination_label ?? 'Destino'}</Text>
                  </View>
                </View>

                {isUpdating ? (
                  <ActivityIndicator color={t.accent} style={{ marginTop: 10 }} />
                ) : (
                  <View style={s.actions}>
                    {item.status === 'pending' && (
                      <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: '#2563eb' }]}
                        onPress={() => confirmStatusChange(item, 'accepted', 'Aceptar')}
                      >
                        <Text style={s.actionBtnText}>Aceptar</Text>
                      </TouchableOpacity>
                    )}
                    {item.status === 'accepted' && (
                      <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: '#16a34a' }]}
                        onPress={() => confirmStatusChange(item, 'in_progress', 'Iniciar viaje')}
                      >
                        <Text style={s.actionBtnText}>Iniciar viaje</Text>
                      </TouchableOpacity>
                    )}
                    {item.status === 'in_progress' && (
                      <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: t.accent }]}
                        onPress={() => confirmStatusChange(item, 'completed', 'Completar')}
                      >
                        <Text style={s.actionBtnText}>Llegué al destino</Text>
                      </TouchableOpacity>
                    )}
                    {(item.status === 'pending' || item.status === 'accepted') && (
                      <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: '#dc262622', borderWidth: 1, borderColor: '#dc2626' }]}
                        onPress={() => confirmStatusChange(item, 'cancelled', 'Cancelar')}
                      >
                        <Text style={[s.actionBtnText, { color: '#dc2626' }]}>Cancelar</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          )
        }}
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
      alignItems: 'center', marginBottom: 14,
    },
    cardDate: { color: t.textSoft, fontSize: 12 },

    statusBadge: {
      borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
    },
    statusBadgeText: { fontSize: 11, fontWeight: '700' },

    route: { marginBottom: 14 },
    routePoint: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
    routeDot: { width: 9, height: 9, borderRadius: 5, marginRight: 10, flexShrink: 0 },
    routeText: { color: t.text, fontSize: 14, flex: 1 },
    routeLine: { width: 1, height: 12, backgroundColor: t.border, marginLeft: 4, marginVertical: 1 },

    actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    actionBtn: {
      flex: 1, minWidth: 100,
      paddingVertical: 10, paddingHorizontal: 12,
      borderRadius: 10, alignItems: 'center',
    },
    actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

    empty: { alignItems: 'center', paddingTop: 64 },
    emptyIcon: {
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: t.surface2,
      alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    },
    emptyTitle: { color: t.text, fontSize: 16, fontWeight: '600', marginBottom: 6 },
    emptyText: { color: t.textMuted, fontSize: 14, textAlign: 'center' },
  })
}
