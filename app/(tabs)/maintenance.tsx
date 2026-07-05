import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity,
  TextInput, Modal,
} from 'react-native'
import { Alert } from '../../components/AppAlert'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import { useRealtime } from '../../src/services/realtime'
import { getTheme, Theme } from '../../src/theme'
import {
  fetchMyMaintenance, fetchMyAssignedTruck, updateMyTruckSpecs, effectiveWeightKg,
  type MyMaintenance, type AssignedTruck,
} from '../../src/services/assignedTrips'

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

// Campos editables del camión desde Mantenimiento.
//  • current_weight_kg (peso actual): lo edita cualquier conductor.
//  • max_* (capacidad): solo el independiente (dueño sin panel web).
type SpecField = 'current_weight_kg' | 'max_weight_kg' | 'max_height_m' | 'max_width_m' | 'max_length_m'
const TRUCK_SPEC_META: Record<SpecField, { label: string; unit: string; placeholder: string }> = {
  current_weight_kg: { label: 'Peso actual', unit: 'kg', placeholder: 'Ej: 18000' },
  max_weight_kg:     { label: 'Peso máximo', unit: 'kg', placeholder: 'Ej: 25000' },
  max_height_m:      { label: 'Alto',        unit: 'm',  placeholder: 'Ej: 4.10' },
  max_width_m:       { label: 'Ancho',       unit: 'm',  placeholder: 'Ej: 2.60' },
  max_length_m:      { label: 'Largo',       unit: 'm',  placeholder: 'Ej: 12.50' },
}

export default function MaintenanceScreen() {
  const isDark = useStore(s => s.isDark)
  const setActiveVehicle = useStore(s => s.setActiveVehicle)
  const t = getTheme(isDark)
  const insets = useSafeAreaInsets()
  const bgColor = isDark ? t.bg : '#F7F8FA'

  const [data, setData] = useState<MyMaintenance | null | undefined>(undefined)
  const [specTruck, setSpecTruck] = useState<AssignedTruck | null>(null)
  const [isIndependent, setIsIndependent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState('cargando…')

  // Edición de peso/dimensiones (modal numérico).
  const [editField, setEditField] = useState<null | SpecField>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      // El rol vive en user_metadata (lo escribe el backend en el onboarding).
      supabase.auth.getSession()
        .then(({ data: sess }) => setIsIndependent(sess.session?.user?.user_metadata?.role === 'independent'))
        .catch(() => {})
      const [maint, truck] = await Promise.allSettled([fetchMyMaintenance(), fetchMyAssignedTruck()])
      if (maint.status === 'fulfilled') { setData(maint.value); setError(null) }
      else setError('No pudimos cargar el mantenimiento. Revisá tu conexión.')
      if (truck.status === 'fulfilled') setSpecTruck(truck.value)
      // DEBUG temporal — sacar después.
      setDebugInfo(
        `maint=${maint.status}` +
        ` | truck=${truck.status}` +
        (truck.status === 'fulfilled'
          ? `:${truck.value ? (truck.value.name ?? 'sinNombre') : 'NULL'}`
          : `:${(truck as PromiseRejectedResult).reason?.message ?? 'err'}`)
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const openEdit = (field: SpecField) => {
    setDraft(specTruck ? String(specTruck[field] ?? '') : '')
    setEditField(field)
  }

  async function saveEdit() {
    if (!editField) return
    setSaving(true)
    try {
      const num = Number(draft.trim().replace(',', '.'))
      if (!Number.isFinite(num) || num <= 0) {
        Alert.alert('Valor inválido', 'Ingresá un número mayor a 0.'); setSaving(false); return
      }
      const updated = await updateMyTruckSpecs({ [editField]: num })
      setSpecTruck(updated)
      // El ruteo usa activeVehicle: lo actualizamos con el nuevo peso (el actual
      // si se cargó) y dimensiones, sin tener que reabrir la app.
      setActiveVehicle({
        id: String(updated.id), user_id: '', plate: updated.patente ?? '', name: updated.name,
        weight_kg: effectiveWeightKg(updated), height_m: updated.max_height_m,
        width_m: updated.max_width_m, length_m: updated.max_length_m,
        axles: 0, is_default: true, created_at: '',
      })
      setEditField(null)
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

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

      {/* DEBUG temporal — sacar después */}
      <View style={{ backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: '#F59E0B' }}>
        <Text style={{ fontSize: 12, color: '#92400E', fontWeight: '700' }}>DEBUG</Text>
        <Text style={{ fontSize: 12, color: '#92400E' }}>{debugInfo}</Text>
        <Text style={{ fontSize: 12, color: '#92400E' }}>specTruck: {specTruck ? (specTruck.name ?? 'sí') : 'null'} · indep: {String(isIndependent)}</Text>
      </View>

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
                <DataRow label="Km actual" value={formatKm(truck.km_actual)} isLast t={t} />
              </Card>
            ) : (
              <Card style={{ padding: 14 }} t={t}>
                <Text style={{ fontSize: 13, color: t.textSoft }}>Todavía no tenés un camión configurado.</Text>
              </Card>
            )}
          </View>

          {/* ── Carga y dimensiones (afectan el ruteo) ───────────────── */}
          {specTruck && (
            <View style={{ marginBottom: 22 }}>
              <SectionLabel>Carga y dimensiones</SectionLabel>
              <Card t={t}>
                {/* Peso actual — lo edita cualquier conductor (cambia cada viaje) */}
                <TouchableOpacity activeOpacity={0.7} onPress={() => openEdit('current_weight_kg')}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.border }}>
                  <Text style={{ fontSize: 13.5, color: t.textMuted, flex: 1 }}>Peso actual</Text>
                  <Text style={{ fontSize: 13.5, fontWeight: '600', color: specTruck.current_weight_kg != null ? t.text : t.textSoft }}>
                    {specTruck.current_weight_kg != null ? `${specTruck.current_weight_kg} kg` : 'Sin especificar'}
                  </Text>
                  <Ionicons name="create-outline" size={16} color={t.textSoft} style={{ marginLeft: 8 }} />
                </TouchableOpacity>
                {/* Capacidad máxima — solo el independiente la edita */}
                {(['max_weight_kg', 'max_height_m', 'max_width_m', 'max_length_m'] as SpecField[]).map((key, i, arr) => {
                  const meta = TRUCK_SPEC_META[key]
                  const value = `${specTruck[key] ?? '—'} ${meta.unit}`
                  const row = (
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: t.border }}>
                      <Text style={{ fontSize: 13.5, color: t.textMuted, flex: 1 }}>{meta.label}</Text>
                      <Text style={{ fontSize: 13.5, fontWeight: '600', color: t.text }}>{value}</Text>
                      {isIndependent && <Ionicons name="create-outline" size={16} color={t.textSoft} style={{ marginLeft: 8 }} />}
                    </View>
                  )
                  return isIndependent
                    ? <TouchableOpacity key={key} activeOpacity={0.7} onPress={() => openEdit(key)}>{row}</TouchableOpacity>
                    : <View key={key}>{row}</View>
                })}
              </Card>
              <Text style={{ fontSize: 11.5, color: t.textMuted, marginTop: 8, paddingHorizontal: 2, lineHeight: 16 }}>
                El peso actual es lo que estás transportando ahora; el ruteo lo usa para evitar calles con límite de carga.
              </Text>
            </View>
          )}

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

      <Modal visible={editField !== null} transparent animationType="fade" onRequestClose={() => setEditField(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: t.card, borderRadius: 16, padding: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: t.text, marginBottom: 14 }}>
              {editField ? `${TRUCK_SPEC_META[editField].label} (${TRUCK_SPEC_META[editField].unit})` : ''}
            </Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={editField ? TRUCK_SPEC_META[editField].placeholder : ''}
              placeholderTextColor={t.textSoft}
              keyboardType="decimal-pad"
              autoFocus
              style={{ backgroundColor: bgColor, color: t.text, borderRadius: 10, borderWidth: 1, borderColor: t.border, padding: 14, fontSize: 16, marginBottom: 16 }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity onPress={() => setEditField(null)} disabled={saving} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
                <Text style={{ color: t.textMuted, fontWeight: '600' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveEdit} disabled={saving} style={{ backgroundColor: t.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18 }}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}
