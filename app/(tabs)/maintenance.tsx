import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useStore } from '../../src/store/useStore'
import { useRealtime } from '../../src/services/realtime'
import { getTheme, Theme } from '../../src/theme'
import { fetchMyMaintenance, type MyMaintenance } from '../../src/services/assignedTrips'

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_LABEL: Record<string, string> = {
  service: 'Service',
  reparacion: 'Reparación',
  neumaticos: 'Neumáticos',
  vtv: 'VTV',
  seguro: 'Seguro',
  otro: 'Otro',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatKm(km: number | null): string {
  return km != null ? `${km.toLocaleString('es-AR')} km` : '—'
}

function relativeDays(days: number | null): string {
  if (days === null) return 'sin fecha'
  if (days < 0) return `vencido hace ${Math.abs(days)}d`
  if (days === 0) return 'vence hoy'
  return `en ${days}d`
}

/** Estado según urgencia: verde (ok), ámbar (≤30d), rojo (vencido). */
function urgency(days: number | null, t: Theme): { color: string; soft: string; label: string } {
  if (days === null) return { color: t.textSoft, soft: t.surface2, label: 'Sin datos' }
  if (days < 0) return { color: t.danger, soft: t.dangerSoft, label: 'Vencido' }
  if (days <= 30) return { color: t.warning, soft: t.warningSoft, label: 'Próximo' }
  return { color: t.success, soft: t.successSoft, label: 'Al día' }
}

// ── Sub-componentes (espejan profile.tsx) ────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={{ fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', color: '#9AA3AD', marginBottom: 10, paddingLeft: 2 }}>
      {children}
    </Text>
  )
}

function Card({ children, style, t }: { children: React.ReactNode; style?: object; t: Theme }) {
  return (
    <View style={[{
      backgroundColor: t.card, borderRadius: 12,
      borderWidth: 1, borderColor: t.cardBorder, overflow: 'hidden',
      shadowColor: '#10203080', shadowOpacity: 0.05, shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 }, elevation: 1,
    }, style]}>
      {children}
    </View>
  )
}

function DataRow({ label, value, valueColor, isLast = false, t }: { label: string; value: string | null; valueColor?: string; isLast?: boolean; t: Theme }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: t.border }}>
      <Text style={{ fontSize: 13.5, color: t.textMuted, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 13.5, fontWeight: '600', color: valueColor ?? t.text }}>{value ?? '—'}</Text>
    </View>
  )
}

function StatusBadge({ days, t }: { days: number | null; t: Theme }) {
  const u = urgency(days, t)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: u.soft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: u.color }} />
      <Text style={{ fontSize: 11, fontWeight: '700', color: u.color }}>{u.label} · {relativeDays(days)}</Text>
    </View>
  )
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

export default function MaintenanceScreen() {
  const isDark = useStore(s => s.isDark)
  const t = getTheme(isDark)
  const insets = useSafeAreaInsets()
  const bgColor = isDark ? t.bg : '#F7F8FA'

  const [data, setData] = useState<MyMaintenance | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const res = await fetchMyMaintenance()
      setData(res)
      setError(null)
    } catch {
      setError('No pudimos cargar el mantenimiento. Revisá tu conexión.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useFocusEffect(useCallback(() => { void load({ silent: true }) }, [load]))
  // Si la empresa reasigna/cambia el camión, refrescamos al instante.
  useRealtime(useCallback((e) => {
    if (e.type === 'truck_update') void load({ silent: true })
  }, [load]))

  const truck = data?.truck ?? null
  const license = data?.license ?? null
  const lastM = data?.last_maintenance ?? null

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: bgColor }}
      contentContainerStyle={{ padding: 18, paddingTop: insets.top + 14, paddingBottom: 60, width: '100%', maxWidth: 640, alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.accent} />}
    >
      {/* Eyebrow */}
      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: t.accent, marginBottom: 16 }}>
        MANTENIMIENTO
      </Text>

      {loading && data === undefined ? (
        <ActivityIndicator color={t.accent} style={{ marginVertical: 40 }} />
      ) : error ? (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <Text style={{ fontSize: 32, marginBottom: 12 }}>📡</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 6 }}>No se pudo cargar</Text>
          <Text style={{ fontSize: 13, color: t.textMuted, textAlign: 'center', marginBottom: 18 }}>{error}</Text>
          <TouchableOpacity onPress={() => load()} activeOpacity={0.85} style={{ backgroundColor: t.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 11 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13.5 }}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* ── Camión asignado ──────────────────────────────────────── */}
          <SectionLabel>Estado del camión</SectionLabel>
          <View style={{ marginBottom: 22 }}>
            {truck ? (
              <Card t={t}>
                {/* Header del camión */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderBottomWidth: 1, borderBottomColor: t.border }}>
                  <View style={{ width: 46, height: 46, borderRadius: 8, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="bus" size={22} color={t.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: t.text }}>{truck.name}</Text>
                    {truck.patente && <Text style={{ fontSize: 12.5, color: t.textMuted, marginTop: 2 }}>{truck.patente}</Text>}
                  </View>
                </View>
                {/* Próximo service con badge de estado */}
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.border }}>
                  <Text style={{ fontSize: 13.5, color: t.textMuted, flex: 1 }}>Próximo service</Text>
                  <StatusBadge days={truck.days_left} t={t} />
                </View>
                <DataRow label="Fecha próx. service" value={formatDate(truck.proximo_service)} valueColor={urgency(truck.days_left, t).color} t={t} />
                <DataRow label="Último service" value={formatDate(truck.fecha_service)} t={t} />
                <DataRow label="Km actual" value={formatKm(truck.km_actual)} t={t} />
                <DataRow label="Peso máximo" value={truck.max_weight_kg != null ? `${truck.max_weight_kg.toLocaleString('es-AR')} kg` : null} t={t} />
                <DataRow label="Altura máxima" value={truck.max_height_m != null ? `${truck.max_height_m.toLocaleString('es-AR')} m` : null} isLast t={t} />
              </Card>
            ) : (
              <Card style={{ padding: 14 }} t={t}>
                <Text style={{ fontSize: 13, color: t.textSoft }}>Todavía no tenés un camión configurado.</Text>
              </Card>
            )}
          </View>

          {/* ── Último mantenimiento ─────────────────────────────────── */}
          {lastM && (
            <>
              <SectionLabel>Último mantenimiento</SectionLabel>
              <Card style={{ marginBottom: 22 }} t={t}>
                <DataRow label="Tipo" value={TIPO_LABEL[lastM.tipo] ?? lastM.tipo} t={t} />
                <DataRow label="Fecha" value={formatDate(lastM.fecha)} t={t} />
                <DataRow label="Km" value={formatKm(lastM.km_al_service)} t={t} />
                <DataRow label="Taller" value={lastM.taller} isLast={!lastM.notas} t={t} />
                {lastM.notas ? (
                  <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
                    <Text style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 4 }}>Notas</Text>
                    <Text style={{ fontSize: 13.5, color: t.text }}>{lastM.notas}</Text>
                  </View>
                ) : null}
              </Card>
            </>
          )}

          {/* ── Licencia de conducir ─────────────────────────────────── */}
          <SectionLabel>Mi licencia</SectionLabel>
          <Card style={{ marginBottom: 18 }} t={t}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.border }}>
              <Text style={{ fontSize: 13.5, color: t.textMuted, flex: 1 }}>Vencimiento</Text>
              {license?.vencimiento_licencia
                ? <StatusBadge days={license.days_left} t={t} />
                : <Text style={{ fontSize: 13.5, fontWeight: '600', color: t.textSoft }}>—</Text>}
            </View>
            <DataRow label="Fecha de vencimiento" value={formatDate(license?.vencimiento_licencia ?? null)} valueColor={license ? urgency(license.days_left, t).color : undefined} t={t} />
            <DataRow label="Categoría" value={license?.categoria_licencia ?? null} isLast t={t} />
          </Card>

          <Text style={{ textAlign: 'center', fontSize: 11, color: '#9AA3AD', letterSpacing: 0.4, paddingBottom: 8 }}>
            Los datos los gestiona tu empresa desde el panel.
          </Text>
        </>
      )}
    </ScrollView>
  )
}
