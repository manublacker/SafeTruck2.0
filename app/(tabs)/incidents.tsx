import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'

const INCIDENT_LABELS: Record<string, string> = {
  fine: '💸 Multa a camión',
  police_check: '👮 Control policial',
  accident: '🚨 Accidente',
  road_work: '🚧 Obras',
  low_bridge: '🌉 Puente bajo',
  road_closed: '🚫 Calle cerrada',
  weight_check: '⚖️ Control de peso',
  other: '⚠️ Otro',
}

const INCIDENT_COLORS: Record<string, string> = {
  fine: '#FF3B30',
  police_check: '#FF9500',
  accident: '#FF3B30',
  road_work: '#FF9500',
  low_bridge: '#FF3B30',
  road_closed: '#FF3B30',
  weight_check: '#FF9500',
  other: '#8E8E93',
}

export default function IncidentsScreen() {
  const profile = useStore(s => s.profile)
  const [incidents, setIncidents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => {
    loadIncidents()

    // Suscripción en tiempo real
    const sub = supabase
      .channel('incidents')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'st_incidents',
      }, () => loadIncidents())
      .subscribe()

    return () => { supabase.removeChannel(sub) }
  }, [])

  const loadIncidents = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('st_incidents')
      .select('*')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    setIncidents(data || [])
    setLoading(false)
  }

  const vote = async (incidentId: string, vote: number) => {
    if (!profile) return
    await supabase.from('st_incident_votes').upsert({
      user_id: profile.id,
      incident_id: incidentId,
      vote,
    })
    if (vote === 1) {
      await supabase.from('st_incidents').update({ upvotes: supabase.rpc('upvotes + 1') })
    }
    loadIncidents()
  }

  const deactivate = async (incidentId: string) => {
    Alert.alert('Desactivar', '¿Este incidente ya no está activo?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sí, desactivar', style: 'destructive',
        onPress: async () => {
          await supabase.from('st_incidents').update({ is_active: false }).eq('id', incidentId)
          loadIncidents()
        }
      }
    ])
  }

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `hace ${mins} min`
    const hrs = Math.floor(mins / 60)
    return `hace ${hrs}h`
  }

  const filtered = filter ? incidents.filter(i => i.incident_type === filter) : incidents

  const FILTERS = ['fine', 'accident', 'police_check', 'road_work', 'low_bridge', 'road_closed']

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Alertas activas</Text>
        <Text style={s.subtitle}>{incidents.length} incidente{incidents.length !== 1 ? 's' : ''} en el AMBA</Text>
      </View>

      {/* Filtros */}
      <View style={s.filters}>
        <TouchableOpacity
          style={[s.filterChip, !filter && s.filterChipActive]}
          onPress={() => setFilter(null)}
        >
          <Text style={[s.filterChipText, !filter && s.filterChipTextActive]}>Todos</Text>
        </TouchableOpacity>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[s.filterChip, filter === f && s.filterChipActive]}
            onPress={() => setFilter(filter === f ? null : f)}
          >
            <Text style={[s.filterChipText, filter === f && s.filterChipTextActive]}>
              {INCIDENT_LABELS[f].split(' ')[0]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadIncidents} tintColor="#FF6B35" />}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>✅</Text>
            <Text style={s.emptyText}>No hay alertas activas en este momento</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={[s.cardAccent, { backgroundColor: INCIDENT_COLORS[item.incident_type] || '#8E8E93' }]} />
            <View style={s.cardContent}>
              <View style={s.cardHeader}>
                <Text style={s.cardType}>{INCIDENT_LABELS[item.incident_type] || '⚠️ Incidente'}</Text>
                <Text style={s.cardTime}>{timeAgo(item.created_at)}</Text>
              </View>
              {item.description && (
                <Text style={s.cardDesc}>{item.description}</Text>
              )}
              <View style={s.cardFooter}>
                <Text style={s.cardExpiry}>
                  Expira {timeAgo(item.expires_at).replace('hace', 'en')}
                </Text>
                <View style={s.cardActions}>
                  <TouchableOpacity style={s.actionBtn} onPress={() => vote(item.id, 1)}>
                    <Text style={s.actionBtnText}>👍 {item.upvotes || 0}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => vote(item.id, -1)}>
                    <Text style={s.actionBtnText}>👎 {item.downvotes || 0}</Text>
                  </TouchableOpacity>
                  {item.user_id === profile?.id && (
                    <TouchableOpacity style={[s.actionBtn, s.actionBtnRed]} onPress={() => deactivate(item.id)}>
                      <Text style={s.actionBtnText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  filterChip: { backgroundColor: '#2C2C2E', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#3A3A3C' },
  filterChipActive: { backgroundColor: '#FF6B35', borderColor: '#FF6B35' },
  filterChipText: { color: '#8E8E93', fontSize: 13 },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },
  card: { flexDirection: 'row', backgroundColor: '#2C2C2E', borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
  cardAccent: { width: 4 },
  cardContent: { flex: 1, padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardType: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardTime: { color: '#8E8E93', fontSize: 12 },
  cardDesc: { color: '#8E8E93', fontSize: 13, marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardExpiry: { color: '#3A3A3C', fontSize: 11 },
  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { backgroundColor: '#3A3A3C', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  actionBtnRed: { backgroundColor: 'rgba(255,59,48,0.2)' },
  actionBtnText: { color: '#fff', fontSize: 13 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#8E8E93', fontSize: 16, textAlign: 'center' },
})
