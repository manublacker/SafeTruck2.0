import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, FlatList, RefreshControl,
  TouchableOpacity, ActivityIndicator, Animated,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'
import { fetchAllMyTrips, type AssignedTrip } from '../../src/services/assignedTrips'
import { useRealtime } from '../../src/services/realtime'

// ── Status config ──────────────────────────────────────────────────────────
// Paleta única de estados (espeja admin.css en la web vía tokens del theme):
// pendiente=ámbar, aceptado=azul, en curso=verde, completado=gris, cancelado=rojo.
function statusConfig(t: Theme): Record<string, { label: string; color: string; softBg: string }> {
  return {
    in_progress: { label: 'En curso',   color: t.success,  softBg: t.successSoft },
    accepted:    { label: 'Aceptado',   color: t.info,     softBg: t.infoSoft },
    pending:     { label: 'Pendiente',  color: t.warning,  softBg: t.warningSoft },
    completed:   { label: 'Completado', color: t.textSoft, softBg: t.surface2 },
    cancelled:   { label: 'Cancelado',  color: t.danger,   softBg: t.dangerSoft },
  }
}

function PulseDot({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])
  return (
    <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity }} />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  )
}

function StatusPill({ status, t }: { status: string; t: Theme }) {
  const map = statusConfig(t)
  const cfg = map[status] ?? map.pending
  const isActive = status === 'in_progress'
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 4,
      borderRadius: 999, backgroundColor: cfg.softBg,
    }}>
      {isActive ? <PulseDot color={cfg.color} /> : (
        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: cfg.color }} />
      )}
      <Text style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: cfg.color }}>
        {cfg.label}
      </Text>
    </View>
  )
}

function RouteBlock({ from, to, dim, t }: { from: string; to: string; dim: boolean; t: Theme }) {
  const ink = dim ? t.textSoft : t.text
  const addrColor = t.textMuted
  const [fromCity, ...fromRest] = from.split(',')
  const [toCity,   ...toRest]   = to.split(',')
  return (
    <View style={{ position: 'relative', paddingVertical: 2 }}>
      {/* dashed vertical line */}
      <View style={{
        position: 'absolute', left: 5, top: 18, bottom: 18,
        width: 0, borderLeftWidth: 2, borderLeftColor: t.borderStrong, borderStyle: 'dashed',
      }} />
      {/* Origin */}
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: dim ? t.textSoft : t.textMuted, backgroundColor: 'transparent', marginTop: 3, flexShrink: 0 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: ink, lineHeight: 18 }} numberOfLines={1}>{fromCity?.trim() || from}</Text>
          {fromRest.length > 0 && <Text style={{ fontSize: 11.5, color: addrColor, marginTop: 2 }} numberOfLines={1}>{fromRest.join(',').trim()}</Text>}
        </View>
      </View>
      {/* Destination */}
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: dim ? t.textSoft : t.info, marginTop: 3, flexShrink: 0 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: ink, lineHeight: 18 }} numberOfLines={1}>{toCity?.trim() || to}</Text>
          {toRest.length > 0 && <Text style={{ fontSize: 11.5, color: addrColor, marginTop: 2 }} numberOfLines={1}>{toRest.join(',').trim()}</Text>}
        </View>
      </View>
    </View>
  )
}

function TripCard({ trip, onView, t }: { trip: AssignedTrip; onView: () => void; t: Theme }) {
  const dim = trip.status === 'completed' || trip.status === 'cancelled'
  const formatDate = (s: string | null) => {
    if (!s) return '—'
    const d = new Date(s)
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  }
  const formatTime = (s: string | null) => {
    if (!s) return ''
    return new Date(s).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  }
  const dateStr = formatDate(trip.scheduled_at ?? trip.created_at)
  const timeStr = formatTime(trip.scheduled_at ?? trip.created_at)
  return (
    <TouchableOpacity onPress={onView} activeOpacity={0.85} style={{
      backgroundColor: t.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: trip.status === 'in_progress' ? 'rgba(31,157,87,0.4)' : t.cardBorder,
      padding: 16, opacity: dim ? 0.8 : 1,
      shadowColor: '#10203080', shadowOpacity: 0.06, shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 }, elevation: 2,
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <StatusPill status={trip.status} t={t} />
        <Text style={{ fontSize: 11.5, fontWeight: '600', color: t.textMuted, letterSpacing: 0.3 }}>
          {dateStr}{timeStr ? `  ·  ${timeStr}` : ''}
        </Text>
      </View>

      {/* Ruta */}
      <RouteBlock
        from={trip.origin_label ?? 'Origen'}
        to={trip.destination_label ?? 'Destino'}
        dim={dim}
        t={t}
      />

      {/* Footer */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Ionicons name="bus" size={14} color={t.textMuted} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: t.text }} numberOfLines={1}>
            {trip.truck_name ?? 'Camión asignado'}
          </Text>
          {trip.truck_patente && (
            <View style={{ backgroundColor: t.surface2, borderRadius: 4, borderWidth: 1, borderColor: t.border, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10.5, fontWeight: '700', fontVariantNumeric: 'tabular-nums', color: t.text }}>{trip.truck_patente}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: t.accent }}>Ver viaje</Text>
          <Text style={{ fontSize: 14, color: t.accent, fontWeight: '700' }}>›</Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

function TripSection({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', color: '#9AA3AD' }}>{label}</Text>
        <Text style={{ fontSize: 11, color: '#9AA3AD', fontVariantNumeric: 'tabular-nums' }}>{String(count).padStart(2, '0')}</Text>
      </View>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  )
}

export default function TripsScreen() {
  const profile = useStore(s => s.profile)
  const isDark   = useStore(s => s.isDark)
  const t        = getTheme(isDark)
  const router   = useRouter()
  const insets   = useSafeAreaInsets()

  const [trips, setTrips]         = useState<AssignedTrip[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const loadTrips = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (!profile) return
    if (mode === 'refresh') setRefreshing(true)
    try {
      const data = await fetchAllMyTrips()
      setTrips(Array.isArray(data) ? data : [])
      setError(null)
    } catch {
      setError('No pudimos cargar tus viajes. Revisá tu conexión y reintentá.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [profile])

  useEffect(() => {
    void loadTrips('initial')
    const id = setInterval(() => void loadTrips('silent'), 30_000)
    return () => clearInterval(id)
  }, [loadTrips])

  // Tiempo real: si la empresa asigna un viaje o cambia su estado, refrescamos
  // la lista al instante (sin esperar al polling de 30s ni recargar la app).
  useRealtime((e) => {
    if (e.type === 'trip_assigned' || e.type === 'trip_update') {
      void loadTrips('silent')
    }
  })

  const firstName    = profile?.full_name?.split(' ')[0] ?? 'conductor'
  const enCurso      = trips.filter(tr => tr.status === 'in_progress' || tr.status === 'accepted')
  const pendientes   = trips.filter(tr => tr.status === 'pending')
  const completados  = trips.filter(tr => tr.status === 'completed' || tr.status === 'cancelled').slice(0, 10)

  const goToMap = (trip: AssignedTrip) =>
    router.navigate({ pathname: '/(tabs)/', params: { tripId: String(trip.id) } } as any)

  const bgColor = isDark ? t.bg : '#F7F8FA'

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: bgColor }}
      contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadTrips('refresh')} tintColor={t.accent} />}
      data={[]}
      renderItem={null}
      ListHeaderComponent={
        <>
          {/* Header */}
          <View style={{ paddingTop: insets.top + 14, marginBottom: 22 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: t.accent, marginBottom: 8 }}>
              MIS VIAJES
            </Text>
            <Text style={{ fontSize: 27, fontWeight: '800', color: t.text, letterSpacing: -0.5, lineHeight: 30, marginBottom: 8 }}>
              Hola, {firstName}.
            </Text>
            <Text style={{ fontSize: 13.5, color: t.textMuted, lineHeight: 20 }}>
              {enCurso.length > 0
                ? `Tenés ${enCurso.length} viaje${enCurso.length > 1 ? 's' : ''} en curso y ${pendientes.length} pendiente${pendientes.length !== 1 ? 's' : ''}.`
                : pendientes.length > 0
                  ? `Tenés ${pendientes.length} viaje${pendientes.length > 1 ? 's' : ''} pendiente${pendientes.length !== 1 ? 's' : ''}.`
                  : 'No tenés viajes asignados por ahora.'
              }
            </Text>
          </View>

          {loading && trips.length === 0 && (
            <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />
          )}

          {!loading && error && trips.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 32, marginBottom: 14 }}>📡</Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: t.text, marginBottom: 6 }}>No se pudo cargar</Text>
              <Text style={{ fontSize: 13.5, color: t.textMuted, textAlign: 'center', marginBottom: 18 }}>{error}</Text>
              <TouchableOpacity
                onPress={() => loadTrips('refresh')}
                activeOpacity={0.85}
                style={{ backgroundColor: t.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 11 }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13.5 }}>Reintentar</Text>
              </TouchableOpacity>
            </View>
          )}

          {!loading && !error && trips.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 32, marginBottom: 14 }}>🗺️</Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: t.text, marginBottom: 6 }}>Sin viajes asignados</Text>
              <Text style={{ fontSize: 13.5, color: t.textMuted, textAlign: 'center' }}>
                El empresario te asignará viajes desde la plataforma web
              </Text>
            </View>
          )}

          {enCurso.length > 0 && (
            <TripSection label="En curso" count={enCurso.length}>
              {enCurso.map(trip => <TripCard key={trip.id} trip={trip} onView={() => goToMap(trip)} t={t} />)}
            </TripSection>
          )}

          {pendientes.length > 0 && (
            <TripSection label="Pendientes" count={pendientes.length}>
              {pendientes.map(trip => <TripCard key={trip.id} trip={trip} onView={() => goToMap(trip)} t={t} />)}
            </TripSection>
          )}

          {completados.length > 0 && (
            <TripSection label="Completados" count={completados.length}>
              {completados.map(trip => <TripCard key={trip.id} trip={trip} onView={() => goToMap(trip)} t={t} />)}
            </TripSection>
          )}
        </>
      }
    />
  )
}
