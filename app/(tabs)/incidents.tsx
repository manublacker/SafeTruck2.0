import { useState, useEffect, useMemo } from 'react'
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'

const INCIDENT_LABELS: Record<string, string> = {
  fine:         '💸 Multa a camión',
  police_check: '👮 Control policial',
  accident:     '🚨 Accidente',
  road_work:    '🚧 Obras',
  low_bridge:   '🌉 Puente bajo',
  road_closed:  '🚫 Calle cerrada',
  weight_check: '⚖️ Control de peso',
  other:        '⚠️ Otro',
}

const INCIDENT_COLORS: Record<string, string> = {
  fine:         '#FF3B30',
  police_check: '#FF9500',
  accident:     '#FF3B30',
  road_work:    '#FF9500',
  low_bridge:   '#FF3B30',
  road_closed:  '#FF3B30',
  weight_check: '#FF9500',
  other:        '#8E8E93',
}

const FILTERS = ['fine', 'accident', 'police_check', 'road_work', 'low_bridge', 'road_closed']

export default function IncidentsScreen() {
  const profile = useStore(s => s.profile)
  const isDark = useStore(s => s.isDark)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])

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
      }},
    ])
  }

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `hace ${mins} min`
    return `hace ${Math.floor(mins / 60)}h`
  }

  const filtered = filter ? incidents.filter(i => i.incident_type === filter) : incidents

  return (
    <View style={s.container}>
      {/* Topbar */}
      <View style={s.topbar}>
        <Text style={s.topbarTitle}>Alertas activas</Text>
        <Text style={s.topbarSub}>
          {incidents.length} incidente{incidents.length !== 1 ? 's' : ''} en el AMBA
        </Text>
      </View>

      {/* Filtros -- dash-filter-chip style: pill, borde, active = acento sólido */}
      <View style={s.filters}>
        <TouchableOpacity
          style={[s.chip, !filter && s.chipActive]}
          onPress={() => setFilter(null)}
        >
          <Text style={[s.chipText, !filter && s.chipTextActive]}>Todos</Text>
        </TouchableOpacity>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[s.chip, filter === f && s.chipActive]}
            onPress={() => setFilter(filter === f ? null : f)}
          >
            <Text style={[s.chipText, filter === f && s.chipTextActive]}>
              {INCIDENT_LABELS[f].split(' ')[0]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadIncidents} tintColor={t.accent} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyIcon}><Text style={{ fontSize: 28 }}>✅</Text></View>
            <Text style={s.emptyTitle}>Sin alertas activas</Text>
            <Text style={s.emptyText}>El área está despejada por el momento</Text>
          </View>
        }
        renderItem={({ item }) => (
          // --dash-incident-card: flat, franja lateral de color
          <View style={s.card}>
            <View style={[s.cardAccent, { backgroundColor: INCIDENT_COLORS[item.incident_type] || '#8E8E93' }]} />
            <View style={s.cardBody}>
              <View style={s.cardTop}>
                <Text style={s.cardType}>{INCIDENT_LABELS[item.incident_type] || '⚠️ Incidente'}</Text>
                <Text style={s.cardTime}>{timeAgo(item.created_at)}</Text>
              </View>
              <View style={s.cardBottom}>
                <Text style={s.cardExpiry}>⏱ Expira {timeAgo(item.expires_at)}</Text>
                {/* --dash-vote-btn: pill */}
                <View style={s.votes}>
                  <TouchableOpacity style={s.voteBtn}>
                    <Text style={s.voteBtnText}>👍 {item.upvotes || 0}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.voteBtn}>
                    <Text style={s.voteBtnText}>👎 {item.downvotes || 0}</Text>
                  </TouchableOpacity>
                  {item.user_id === profile?.id && (
                    <TouchableOpacity
                      style={[s.voteBtn, { backgroundColor: 'rgba(255,59,48,0.15)' }]}
                      onPress={() => deactivate(item.id)}
                    >
                      <Text style={[s.voteBtnText, { color: t.danger }]}>✕</Text>
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

    // --dash-filter-chip style
    filters: {
      flexDirection: 'row', flexWrap: 'wrap',
      paddingHorizontal: 16, paddingVertical: 12, gap: 8,
    },
    chip: {
      backgroundColor: t.card, borderWidth: 1, borderColor: t.border,
      borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
    },
    chipActive: { backgroundColor: t.accent, borderColor: t.accent },
    chipText: { color: t.textMuted, fontSize: 13, fontWeight: '500' },
    chipTextActive: { color: '#fff', fontWeight: '600' },

    // --dash-incident-card: flat
    card: {
      flexDirection: 'row',
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1, borderColor: t.cardBorder,
      overflow: 'hidden',
    },
    cardAccent: { width: 4 },
    cardBody: { flex: 1, padding: 16 },
    cardTop: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', marginBottom: 12,
    },
    cardType: { color: t.text, fontSize: 15, fontWeight: '600' },
    cardTime: { color: t.textSoft, fontSize: 12 },
    cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardExpiry: { color: t.textSoft, fontSize: 11 },

    // --dash-vote-btn: pill shape
    votes: { flexDirection: 'row', gap: 6 },
    voteBtn: {
      backgroundColor: t.surface2, borderRadius: 999,
      paddingHorizontal: 12, paddingVertical: 5,
    },
    voteBtnText: { color: t.text, fontSize: 13, fontWeight: '600' },

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
