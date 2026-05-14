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
    const sub = supabase
      .channel('incidents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'st_incidents' }, () => loadIncidents())
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

  const deactivate = async (incidentId: string) => {
    Alert.alert('Desactivar', '¿Este incidente ya no está activo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí', style: 'destructive', onPress: async () => {
        await supabase.from('st_incidents').update({ is_active: false }).eq('id', incidentId)
        loadIncidents()
      }}
    ])
  }

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `hace ${mins} min`
    return `hace ${Math.floor(mins / 60)}h`
  }

  const FILTERS = ['fine', 'accident', 'police_check', 'road_work', 'low_bridge', 'road_closed']
  const filtered = filter ? incidents.filter(i => i.incident_type === filter) : incidents

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Alertas activas</Text>
        <Text style={s.subtitle}>{incidents.length} incidente{incidents.length !== 1 ? 's' : ''} en el AMBA</Text>
      </View>
      <View style={s.filters}>
        <TouchableOpacity style={[s.chip, !filter && s.chipActive]} onPress={() => setFilter(null)}>
          <Text style={[s.chipText, !filter && s.chipTextActive]}>Todos</Text>
        </TouchableOpacity>
        {FILTERS.map(f => (
          <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(filter === f ? null : f)}>
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>{INCIDENT_LABELS[f].split(' ')[0]}</Text>
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
            <Text style={s.emptyText}>No hay alertas activas</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={[s.accent, { backgroundColor: INCIDENT_COLORS[item.incident_type] || '#8E8E93' }]} />
            <View style={s.cardBody}>
              <View style={s.cardTop}>
                <Text style={s.cardType}>{INCIDENT_LABELS[item.incident_type] || '⚠️ Incidente'}</Text>
                <Text style={s.cardTime}>{timeAgo(item.created_at)}</Text>
              </View>
              <View style={s.cardBottom}>
                <Text style={s.cardExpiry}>⏱ {timeAgo(item.expires_at)}</Text>
                <View style={s.actions}>
                  <TouchableOpacity style={s.actionBtn}>
                    <Text style={s.actionText}>👍 {item.upvotes || 0}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn}>
                    <Text style={s.actionText}>👎 {item.downvotes || 0}</Text>
                  </TouchableOpacity>
                  {item.user_id === profile?.id && (
                    <TouchableOpacity style={[s.actionBtn, { backgroundColor: 'rgba(255,59,48,0.2)' }]} onPress={() => deactivate(item.id)}>
                      <Text style={s.actionText}>✕</Text>
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
  chip: { backgroundColor: '#2C2C2E', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#3A3A3C' },
  chipActive: { backgroundColor: '#FF6B35', borderColor: '#FF6B35' },
  chipText: { color: '#8E8E93', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  card: { flexDirection: 'row', backgroundColor: '#2C2C2E', borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
  accent: { width: 4 },
  cardBody: { flex: 1, padding: 16 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  cardType: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardTime: { color: '#8E8E93', fontSize: 12 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardExpiry: { color: '#8E8E93', fontSize: 11 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: { backgroundColor: '#3A3A3C', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  actionText: { color: '#fff', fontSize: 13 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#8E8E93', fontSize: 16 },
})
