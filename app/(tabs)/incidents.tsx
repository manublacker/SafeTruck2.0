import { useState, useEffect, useMemo, useCallback } from 'react'
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native'
import { Alert } from '../../components/AppAlert'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'

const BACKEND = (process.env.EXPO_PUBLIC_API_URL ?? 'https://safetruck20-production.up.railway.app').replace(/\/$/, '')

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const INCIDENT_LABELS: Record<string, string> = {
  multa:            '💸 Multa a camión',
  control_policial: '👮 Control policial',
  accidente:        '🚨 Accidente',
  obra:             '🚧 Obras',
  puente_bajo:      '🌉 Puente bajo',
  corte:            '🚫 Calle cerrada',
  control_peso:     '⚖️ Control de peso',
  otro:             '⚠️ Otro',
  trafico:          '🚗 Tráfico',
  objeto_en_via:    '⚠️ Objeto en vía',
}

// Mapa de tipo de incidente -> token de marca.
// Peligro/bloqueo => danger; advertencia => warning; resto => textSoft.
const INCIDENT_DANGER = ['multa', 'accidente', 'puente_bajo', 'corte']
const INCIDENT_WARNING = ['control_policial', 'obra', 'control_peso', 'trafico', 'objeto_en_via']

function incidentColor(type: string, t: Theme): string {
  if (INCIDENT_DANGER.includes(type)) return t.danger
  if (INCIDENT_WARNING.includes(type)) return t.warning
  return t.textSoft
}

const FILTERS = ['multa', 'accidente', 'control_policial', 'obra', 'puente_bajo', 'corte']

// Etiqueta corta para los chips de filtro (emoji + texto, no solo emoji).
const FILTER_SHORT: Record<string, string> = {
  multa:            '💸 Multa',
  accidente:        '🚨 Accidente',
  control_policial: '👮 Control',
  obra:             '🚧 Obra',
  puente_bajo:      '🌉 Puente bajo',
  corte:            '🚫 Corte',
}

export default function IncidentsScreen() {
  const profile = useStore(s => s.profile)
  const isDark = useStore(s => s.isDark)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const [incidents, setIncidents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  // Incidentes que el usuario ya confirmó en esta sesión (evita doble voto en la UI).
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadIncidents()
  }, [])

  // Esta pantalla es un tab oculto que queda montado tras la primera visita:
  // sin esto, un incidente recién reportado desde el mapa no aparecía (ni
  // desaparecían los expirados) hasta hacer pull-to-refresh manual.
  useFocusEffect(useCallback(() => { void loadIncidents({ silent: true }) }, []))

  const loadIncidents = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const res = await fetch(`${BACKEND}/api/incidents`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setIncidents(json.incidents ?? [])
      setError(null)
    } catch (e) {
      console.log('loadIncidents error:', e)
      setError('No se pudieron cargar las alertas. Revisá tu conexión.')
    } finally {
      setLoading(false)
    }
  }

  const deactivate = async (incidentId: string | number) => {
    Alert.alert('Desactivar', '¿Este incidente ya no está activo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí', style: 'destructive', onPress: async () => {
        try {
          const headers = await authHeaders()
          const res = await fetch(`${BACKEND}/api/incidents/${incidentId}/deactivate`, {
            method: 'PATCH',
            headers,
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          loadIncidents()
        } catch (e) {
          console.log('deactivate error:', e)
          Alert.alert('Error', 'No se pudo desactivar la alerta. Intentá de nuevo.')
        }
      }},
    ])
  }

  // Confirma que un incidente ajeno sigue activo. Optimista: suma el voto en la
  // UI al instante y revierte si el backend falla.
  const confirm = async (incidentId: string | number) => {
    const key = String(incidentId)
    if (confirmedIds.has(key)) return
    setConfirmedIds(prev => new Set(prev).add(key))
    setIncidents(prev => prev.map(i =>
      String(i.id) === key ? { ...i, confirmed_count: (i.confirmed_count || 0) + 1 } : i
    ))
    try {
      const headers = await authHeaders()
      const res = await fetch(`${BACKEND}/api/incidents/${incidentId}/confirm`, {
        method: 'PATCH',
        headers,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      console.log('confirm error:', e)
      // Revertir: quito el voto local y el id de confirmados.
      setIncidents(prev => prev.map(i =>
        String(i.id) === key ? { ...i, confirmed_count: Math.max(0, (i.confirmed_count || 1) - 1) } : i
      ))
      setConfirmedIds(prev => { const n = new Set(prev); n.delete(key); return n })
      Alert.alert('Error', 'No se pudo confirmar la alerta. Intentá de nuevo.')
    }
  }

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'recién'
    if (mins < 60) return `hace ${mins} min`
    return `hace ${Math.floor(mins / 60)}h`
  }

  // expires_at es futuro: mostramos cuánto FALTA, no "hace -X".
  const timeUntil = (dateStr: string) => {
    const diff = new Date(dateStr).getTime() - Date.now()
    if (diff <= 0) return 'expirada'
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `en ${mins} min`
    return `en ${Math.floor(mins / 60)}h`
  }

  // Ocultamos los que ya vencieron (pueden expirar con la pantalla abierta):
  // evita listar alertas con "⏱ Expira expirada".
  const active = incidents.filter(i => !i.expires_at || new Date(i.expires_at).getTime() > Date.now())
  const filtered = filter ? active.filter(i => i.incident_type === filter) : active

  return (
    <View style={s.container}>
      {/* Topbar */}
      <View style={[s.topbar, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/'))}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={s.backBtn}
          accessibilityLabel="Volver"
        >
          <Ionicons name="chevron-back" size={20} color={t.text} />
          <Text style={s.backText}>Mapa</Text>
        </TouchableOpacity>
        <Text style={s.topbarTitle}>Alertas activas</Text>
        <Text style={s.topbarSub}>
          {active.length} incidente{active.length !== 1 ? 's' : ''} en el AMBA
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
              {FILTER_SHORT[f] ?? INCIDENT_LABELS[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => String(item.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadIncidents} tintColor={t.accent} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, width: '100%', maxWidth: 640, alignSelf: 'center' }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          loading ? null : error ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}><Text style={{ fontSize: 28 }}>📡</Text></View>
              <Text style={s.emptyTitle}>No se pudo cargar</Text>
              <Text style={s.emptyText}>{error}</Text>
              <TouchableOpacity
                onPress={loadIncidents}
                activeOpacity={0.85}
                style={{ marginTop: 16, backgroundColor: t.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 11 }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13.5 }}>Reintentar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.empty}>
              <View style={s.emptyIcon}><Text style={{ fontSize: 28 }}>✅</Text></View>
              <Text style={s.emptyTitle}>Sin alertas activas</Text>
              <Text style={s.emptyText}>El área está despejada por el momento</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          // --dash-incident-card: flat, franja lateral de color
          <View style={s.card}>
            <View style={[s.cardAccent, { backgroundColor: incidentColor(item.incident_type, t) }]} />
            <View style={s.cardBody}>
              <View style={s.cardTop}>
                <Text style={s.cardType}>{INCIDENT_LABELS[item.incident_type] || '⚠️ Incidente'}</Text>
                <Text style={s.cardTime}>{timeAgo(item.reported_at)}</Text>
              </View>
              <View style={s.cardBottom}>
                <Text style={s.cardExpiry}>⏱ Expira {timeUntil(item.expires_at)}</Text>
                {/* --dash-vote-btn: pill */}
                <View style={s.votes}>
                  <View style={s.voteCount}>
                    <Text style={s.voteBtnText}>✅ {item.confirmed_count || 0}</Text>
                  </View>
                  {item.user_id === profile?.id ? (
                    <TouchableOpacity
                      style={[s.voteBtn, { backgroundColor: 'rgba(255,59,48,0.15)' }]}
                      onPress={() => deactivate(item.id)}
                    >
                      <Text style={[s.voteBtnText, { color: t.danger }]}>✕</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[s.voteBtn, confirmedIds.has(String(item.id)) && { opacity: 0.5 }]}
                      disabled={confirmedIds.has(String(item.id))}
                      onPress={() => confirm(item.id)}
                    >
                      <Text style={[s.voteBtnText, { color: t.accent }]}>
                        {confirmedIds.has(String(item.id)) ? '✓ Confirmado' : 'Sigue acá'}
                      </Text>
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
    backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginLeft: -4 },
    backText: { color: t.text, fontSize: 15, fontWeight: '600', marginLeft: 2 },
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
    votes: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    voteCount: {
      backgroundColor: t.surface2, borderRadius: 999,
      paddingHorizontal: 12, paddingVertical: 5,
    },
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
