import { useState, useEffect, useMemo } from 'react'
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'

export default function TripsScreen() {
  const profile = useStore(s => s.profile)
  const isDark = useStore(s => s.isDark)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])

  const [trips, setTrips] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadTrips() }, [])

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
    return d.toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <View style={s.container}>
      {/* Topbar */}
      <View style={s.topbar}>
        <Text style={s.topbarTitle}>Mis viajes</Text>
        <Text style={s.topbarSub}>
          {trips.length} viaje{trips.length !== 1 ? 's' : ''} registrado{trips.length !== 1 ? 's' : ''}
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
            <Text style={s.emptyTitle}>Sin viajes registrados</Text>
            <Text style={s.emptyText}>Calculá una ruta en el mapa para empezar</Text>
          </View>
        }
        renderItem={({ item }) => (
          // Estilo --dash-incident-card: flat, sin borde, con franja de color lateral
          <View style={s.card}>
            <View style={s.cardAccent} />
            <View style={s.cardBody}>
              {/* Header */}
              <View style={s.cardHeader}>
                <Text style={s.cardDate}>{formatDate(item.created_at)}</Text>
                <View style={s.vehicleBadge}>
                  <Text style={s.vehicleBadgeText}>{item.st_vehicles?.plate || 'Vehículo'}</Text>
                </View>
              </View>

              {/* Ruta */}
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

              {/* Stats */}
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
                  <View style={s.statusBadge}>
                    <Text style={s.statusBadgeText}>
                      {item.status === 'completed' ? '✓ Completado' : item.status}
                    </Text>
                  </View>
                  <Text style={s.statLbl}>ESTADO</Text>
                </View>
              </View>
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

    // --dash-topbar style
    topbar: {
      paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16,
      borderBottomWidth: 1, borderBottomColor: t.border,
      backgroundColor: t.bg,
    },
    topbarTitle: { color: t.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
    topbarSub: { color: t.textMuted, fontSize: 14, marginTop: 3 },

    // --dash-incident-card: flat, sin borde
    card: {
      flexDirection: 'row',
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1, borderColor: t.cardBorder,
      overflow: 'hidden',
    },
    cardAccent: { width: 4, backgroundColor: t.accent },
    cardBody: { flex: 1, padding: 16 },
    cardHeader: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', marginBottom: 14,
    },
    cardDate: { color: t.textSoft, fontSize: 12 },
    vehicleBadge: {
      backgroundColor: t.accentSoft, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 3,
    },
    vehicleBadgeText: { color: t.accent, fontSize: 12, fontWeight: '600' },

    // Ruta
    route: { marginBottom: 14 },
    routePoint: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
    routeDot: { width: 9, height: 9, borderRadius: 5, marginRight: 10, flexShrink: 0 },
    routeText: { color: t.text, fontSize: 14, flex: 1 },
    routeLine: { width: 1, height: 12, backgroundColor: t.border, marginLeft: 4, marginVertical: 1 },

    // Stats (--dash-stat style)
    statsRow: {
      flexDirection: 'row', alignItems: 'center',
      borderTopWidth: 1, borderTopColor: t.border, paddingTop: 12,
    },
    statItem: { flex: 1, alignItems: 'center' },
    statVal: { color: t.accent, fontSize: 15, fontWeight: '700' },
    statLbl: { color: t.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginTop: 2 },
    statDivider: { width: 1, height: 28, backgroundColor: t.border },
    statusBadge: {
      backgroundColor: t.successSoft, borderRadius: 999,
      paddingHorizontal: 8, paddingVertical: 3,
    },
    statusBadgeText: { color: t.success, fontSize: 11, fontWeight: '600' },

    // --dash-empty style
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
