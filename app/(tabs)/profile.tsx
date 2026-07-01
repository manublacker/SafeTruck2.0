import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, Modal,
  ScrollView, ActivityIndicator, RefreshControl,
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
  fetchMyAssignedTruck,
  fetchMyDriverProfile,
  syncMyPhoneToFleet,
  type AssignedTruck,
  type DriverProfile,
} from '../../src/services/assignedTrips'


// ── Sub-components ─────────────────────────────────────────────────────────
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
      borderWidth: 1, borderColor: t.cardBorder,
      overflow: 'hidden',
      shadowColor: '#10203080', shadowOpacity: 0.05, shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 }, elevation: 1,
    }, style]}>
      {children}
    </View>
  )
}

function DataRow({ label, value, isLast = false, onPress, t }: { label: string; value: string | null; isLast?: boolean; onPress?: () => void; t: Theme }) {
  const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: t.border }
  const content = (
    <>
      <Text style={{ fontSize: 13.5, color: t.textMuted, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 13.5, fontWeight: '600', color: t.text }}>{value ?? '—'}</Text>
      {onPress && <Ionicons name="create-outline" size={16} color={t.textSoft} style={{ marginLeft: 8 }} />}
    </>
  )
  if (onPress) {
    return <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={rowStyle}>{content}</TouchableOpacity>
  }
  return <View style={rowStyle}>{content}</View>
}

function NavRow({ label, detail, danger = false, isLast = false, onPress, t }: {
  label: string; detail?: string; danger?: boolean; isLast?: boolean; onPress?: () => void; t: Theme
}) {
  return (
    <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={0.7} style={{
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: isLast ? 0 : 1, borderBottomColor: t.border,
      opacity: onPress || danger ? 1 : 0.55,
    }}>
      <Text style={{ fontSize: 14, fontWeight: '500', color: danger ? t.danger : t.text, flex: 1 }}>{label}</Text>
      {detail && <Text style={{ fontSize: 13, color: t.textSoft, marginRight: 6 }}>{detail}</Text>}
      {!danger && onPress && <Ionicons name="chevron-forward" size={16} color={t.textSoft} />}
    </TouchableOpacity>
  )
}

export default function ProfileScreen() {
  const profile = useStore(s => s.profile)
  const setProfile = useStore(s => s.setProfile)
  const setActiveVehicle = useStore(s => s.setActiveVehicle)
  const isDark = useStore(s => s.isDark)
  const t = getTheme(isDark)
  const insets = useSafeAreaInsets()

  const bgColor = isDark ? t.bg : '#F7F8FA'

  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null)
  const [assignedTruck, setAssignedTruck]  = useState<AssignedTruck | null | undefined>(undefined)
  const [profileLoading, setProfileLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editField, setEditField] = useState<null | 'name' | 'phone'>(null)
  const [draft, setDraft]         = useState('')
  const [saving, setSaving]       = useState(false)

  // El teléfono vive en la cuenta (profiles); si falta, caemos al de la ficha de empresa.
  const currentPhone = profile?.phone ?? driverProfile?.telefono ?? null

  const openEdit = (field: 'name' | 'phone') => {
    setDraft(field === 'name' ? (profile?.full_name ?? '') : (currentPhone ?? ''))
    setEditField(field)
  }

  async function saveEdit() {
    if (!profile || !editField) return
    setSaving(true)
    try {
      const value = draft.trim() || null
      if (editField === 'name') {
        if (!value) { Alert.alert('Nombre', 'Ingresá un nombre o alias.'); setSaving(false); return }
        const { error: e } = await supabase.from('profiles').update({ full_name: value }).eq('id', profile.id)
        if (e) throw e
        setProfile({ ...profile, full_name: value })
      } else {
        const { error: e } = await supabase.from('profiles').update({ phone: value }).eq('id', profile.id)
        if (e) throw e
        setProfile({ ...profile, phone: value ?? undefined })
        void syncMyPhoneToFleet(value) // best-effort: refleja en la ficha de empresa
      }
      setEditField(null)
    } catch {
      Alert.alert('Error', 'No se pudo guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  // silent=true: refresco en segundo plano (foco / tiempo real) sin mostrar el
  // spinner de carga; false (default): carga inicial con spinner.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setProfileLoading(true)
    const [dp, at] = await Promise.allSettled([
      fetchMyDriverProfile(),
      fetchMyAssignedTruck(),
    ])
    if (dp.status === 'fulfilled') setDriverProfile(dp.value)
    if (at.status === 'fulfilled') {
      setAssignedTruck(at.value)
      setActiveVehicle(at.value ? {
        id:         String(at.value.id),
        user_id:    '',
        plate:      at.value.patente ?? '',
        name:       at.value.name,
        weight_kg:  at.value.max_weight_kg,
        height_m:   at.value.max_height_m,
        width_m:    at.value.max_width_m,
        length_m:   at.value.max_length_m,
        axles:      0,
        is_default: true,
        created_at: '',
      } : null)
    }
    // Si ambas llamadas fallaron, es un error de red/sesión, no "sin datos".
    setError(dp.status === 'rejected' && at.status === 'rejected'
      ? 'No pudimos cargar tu información. Revisá tu conexión.'
      : null)
    setProfileLoading(false)
  }, [setActiveVehicle])

  useEffect(() => { void load() }, [load])

  // Al volver a la pantalla de Perfil, refrescamos (silencioso): así un cambio
  // de camión hecho en la web se ve sin reiniciar la app.
  useFocusEffect(useCallback(() => { void load({ silent: true }) }, [load]))

  // Tiempo real: si la empresa cambió/quitó el camión, el backend emite
  // 'truck_update' y refrescamos al instante, igual que en el mapa.
  useRealtime(useCallback((e) => {
    if (e.type === 'truck_update') void load({ silent: true })
  }, [load]))

  const comingSoon = (feature: string) =>
    Alert.alert(feature, 'Esta función estará disponible próximamente.')

  const logout = () => {
    Alert.alert('Cerrar sesión', '¿Querés salir de tu cuenta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: async () => {
        await supabase.auth.signOut()
        setActiveVehicle(null)
        setProfile(null)
      }},
    ])
  }

  const initials = profile?.full_name
    ?.split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase() ?? '?'

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: bgColor }}
      contentContainerStyle={{ padding: 18, paddingTop: insets.top + 14, paddingBottom: 60, width: '100%', maxWidth: 640, alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={profileLoading} onRefresh={load} tintColor={t.accent} />}
    >

      {/* Eyebrow */}
      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: t.accent, marginBottom: 16 }}>
        PERFIL
      </Text>

      {/* Avatar + nombre */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 22 }}>
        <View style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: t.navy, alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <TouchableOpacity onPress={() => openEdit('name')} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: t.text, letterSpacing: -0.5, lineHeight: 26 }}>{profile?.full_name ?? '—'}</Text>
            <Ionicons name="create-outline" size={17} color={t.textSoft} />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <Text style={{ fontSize: 12.5, color: t.textMuted }}>Conductor</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.success }} />
              <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: t.success }}>Activo</Text>
            </View>
          </View>
        </View>
      </View>

      {profileLoading ? (
        <ActivityIndicator color={t.accent} style={{ marginVertical: 32 }} />
      ) : error ? (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <Text style={{ fontSize: 32, marginBottom: 12 }}>📡</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 6 }}>No se pudo cargar</Text>
          <Text style={{ fontSize: 13, color: t.textMuted, textAlign: 'center', marginBottom: 18 }}>{error}</Text>
          <TouchableOpacity onPress={load} activeOpacity={0.85} style={{ backgroundColor: t.accent, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 11 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13.5 }}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* ── Camión asignado ──────────────────────────────────────── */}
          <SectionLabel>Camión asignado</SectionLabel>
          <View style={{ marginBottom: 22 }}>
            {assignedTruck ? (
              <Card style={{ padding: 14 }} t={t}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View style={{
                    width: 46, height: 46, borderRadius: 8,
                    backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Ionicons name="bus" size={22} color={t.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: t.text, letterSpacing: -0.3 }}>
                      {assignedTruck.name}
                    </Text>
                    {assignedTruck.modelo && (
                      <Text style={{ fontSize: 12.5, color: t.textMuted, marginTop: 2 }}>
                        {assignedTruck.modelo}{assignedTruck.anio ? ` · ${assignedTruck.anio}` : ''}
                      </Text>
                    )}
                  </View>
                  {assignedTruck.patente && (
                    <View style={{ backgroundColor: t.surface2, borderRadius: 4, borderWidth: 1, borderColor: t.border, paddingHorizontal: 8, paddingVertical: 5 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: t.text, fontVariantNumeric: 'tabular-nums' }}>
                        {assignedTruck.patente}
                      </Text>
                    </View>
                  )}
                </View>
              </Card>
            ) : (
              <Card style={{ padding: 14 }} t={t}>
                <Text style={{ fontSize: 13, color: t.textSoft }}>Tu empresa aún no te asignó un camión.</Text>
              </Card>
            )}
          </View>

          {/* ── Datos de contacto ────────────────────────────────────── */}
          <SectionLabel>Datos de contacto</SectionLabel>
          <Card style={{ marginBottom: 22 }} t={t}>
            <DataRow label="Teléfono" value={currentPhone} onPress={() => openEdit('phone')} t={t} />
            <DataRow label="Email" value={profile?.email ?? null} isLast t={t} />
          </Card>

          {/* ── Cuenta ──────────────────────────────────────────────── */}
          <SectionLabel>Cuenta</SectionLabel>
          <Card style={{ marginBottom: 18 }} t={t}>
            <NavRow label="Notificaciones" detail="Activadas" onPress={() => comingSoon('Notificaciones')} t={t} />
            <NavRow label="Seguridad y datos" onPress={() => comingSoon('Seguridad y datos')} t={t} />
            <NavRow label="Ayuda y soporte" onPress={() => comingSoon('Ayuda y soporte')} t={t} />
            <NavRow label="Cerrar sesión" danger isLast onPress={logout} t={t} />
          </Card>

          <Text style={{ textAlign: 'center', fontSize: 11, color: '#9AA3AD', fontVariantNumeric: 'tabular-nums', letterSpacing: 0.4, paddingBottom: 8 }}>
            SafeTruck · versión 1.0.0
          </Text>
        </>
      )}

      <Modal visible={editField !== null} transparent animationType="fade" onRequestClose={() => setEditField(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: t.card, borderRadius: 16, padding: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: t.text, marginBottom: 14 }}>
              {editField === 'name' ? 'Editar nombre o alias' : 'Editar teléfono'}
            </Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={editField === 'name' ? 'Nombre o alias' : 'Teléfono'}
              placeholderTextColor={t.textSoft}
              keyboardType={editField === 'phone' ? 'phone-pad' : 'default'}
              textContentType={editField === 'phone' ? 'telephoneNumber' : 'name'}
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
