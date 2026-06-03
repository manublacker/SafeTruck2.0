import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, ActivityIndicator, Animated,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'
import { fetchAllMyTrips, type AssignedTrip } from '../../src/services/assignedTrips'

// ── Status config ──────────────────────────────────────────────────────────
const STATUS: Record<string, { label: string; color: string; softBg: string }> = {
  in_progress: { label: 'En curso',   color: '#1F9D57', softBg: '#E7F6EE' },
  accepted:    { label: 'Aceptado',   color: '#1A56C4', softBg: '#EFF4FF' },
  pending:     { label: 'Pendiente',  color: '#D9881A', softBg: '#FBF1E0' },
  completed:   { label: 'Completado', color: '#9AA3AD', softBg: '#F2F4F7' },
  cancelled:   { label: 'Cancelado',  color: '#E5342B', softBg: '#FDECEA' },
}

function PulseDot({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    ).start()
  }, [])
  return (
    <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity }} />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  )
}

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS[status] ?? STATUS.pending
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

function RouteBlock({ from, to, dim }: { from: string; to: string; dim: boolean }) {
  const ink = dim ? '#9AA3AD' : '#16202C'
  const addrColor = '#69727E'
  const [fromCity, ...fromRest] = from.split(',')
  const [toCity,   ...toRest]   = to.split(',')
  return (
    <View style={{ position: 'relative', paddingVertical: 2 }}>
      {/* dashed vertical line */}
      <View style={{
        position: 'absolute', left: 5, top: 18, bottom: 18,
        width: 0, borderLeftWidth: 2, borderLeftColor: '#D6DAE0', borderStyle: 'dashed',
      }} />
      {/* Origin */}
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: dim ? '#9AA3AD' : '#69727E', backgroundColor: 'transparent', marginTop: 3, flexShrink: 0 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: ink, lineHeight: 18 }} numberOfLines={1}>{fromCity?.trim() || from}</Text>
          {fromRest.length > 0 && <Text style={{ fontSize: 11.5, color: addrColor, marginTop: 2 }} numberOfLines={1}>{fromRest.join(',').trim()}</Text>}
        </View>
      </View>
      {/* Destination */}
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: dim ? '#9AA3AD' : '#E5342B', marginTop: 3, flexShrink: 0 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: ink, lineHeight: 18 }} numberOfLines={1}>{toCity?.trim() || to}</Text>
          {toRest.length > 0 && <Text style={{ fontSize: 11.5, color: addrColor, marginTop: 2 }} numberOfLines={1}>{toRest.join(',').trim()}</Text>}
        </View>
      </View>
    </View>
  )
}

function TripCard({ trip, onView }: { trip: AssignedTrip; onView: () => void }) {
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
      backgroundColor: '#FFFFFF',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: trip.status === 'in_progress' ? 'rgba(31,157,87,0.3)' : '#E6E8EC',
      padding: 16, opacity: dim ? 0.8 : 1,
      shadowColor: '#10203080', shadowOpacity: 0.06, shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 }, elevation: 2,
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <StatusPill status={trip.status} />
        <Text style={{ fontSize: 11.5, fontWeight: '600', color: '#69727E', letterSpacing: 0.3 }}>
          {dateStr}{timeStr ? `  ·  ${timeStr}` : ''}
        </Text>
      </View>

      {/* Ruta */}
      <RouteBlock
        from={trip.origin_label ?? 'Origen'}
        to={trip.destination_label ?? 'Destino'}
        dim={dim}
      />

      {/* Footer */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E6E8EC' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Text style={{ fontSize: 15, color: '#69727E' }}>🚛</Text>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#16202C' }} numberOfLines={1}>
            {trip.truck_name ?? 'Camión asignado'}
          </Text>
          {trip.truck_patente && (
            <View style={{ backgroundColor: '#F2F4F7', borderRadius: 4, borderWidth: 1, borderColor: '#E6E8EC', paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10.5, fontWeight: '700', fontVariantNumeric: 'tabular-nums', color: '#16202C' }}>{trip.truck_patente}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#E5342B' }}>Ver viaje</Text>
          <Text style={{ fontSize: 14, color: '#E5342B', fontWeight: '700' }}>›</Text>
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

  const [trips, setTrips]     = useState<AssignedTrip[]>([])
  const [loading, setLoading] = useState(true)

  const loadTrips = useCallback(async () => {
    if (!profile) return
    try {
      const data = await fetchAllMyTrips()
      setTrips(Array.isArray(data) ? data : [])
    } catch {}
    setLoading(false)
  }, [profile])

  useEffect(() => {
    void loadTrips()
    const id = setInterval(() => void loadTrips(), 30_000)
    return () => clearInterval(id)
  }, [loadTrips])

  const firstName    = profile?.full_name?.split(' ')[0] ?? 'conductor'
  const enCurso      = trips.filter(t => t.status === 'in_progress' || t.status === 'accepted')
  const pendientes   = trips.filter(t => t.status === 'pending')
  const completados  = trips.filter(t => t.status === 'completed' || t.status === 'cancelled').slice(0, 10)

  const goToMap = (trip: AssignedTrip) =>
    router.push({ pathname: '/(tabs)/', params: { tripId: String(trip.id) } } as any)

  const bgColor = isDark ? t.bg : '#F7F8FA'

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: bgColor }}
      contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadTrips} tintColor={t.accent} />}
      data={[]}
      renderItem={null}
      ListHeaderComponent={
        <>
          {/* Header */}
          <View style={{ paddingTop: 60, marginBottom: 22 }}>
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

          {!loading && trips.length === 0 && (
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
              {enCurso.map(trip => <TripCard key={trip.id} trip={trip} onView={() => goToMap(trip)} />)}
            </TripSection>
          )}

          {pendientes.length > 0 && (
            <TripSection label="Pendientes" count={pendientes.length}>
              {pendientes.map(trip => <TripCard key={trip.id} trip={trip} onView={() => goToMap(trip)} />)}
            </TripSection>
          )}

          {completados.length > 0 && (
            <TripSection label="Completados" count={completados.length}>
              {completados.map(trip => <TripCard key={trip.id} trip={trip} onView={() => goToMap(trip)} />)}
            </TripSection>
          )}
        </>
      }
    />
  )
}
