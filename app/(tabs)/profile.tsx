import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import { getTheme } from '../../src/theme'
import {
  fetchMyAssignedTruck,
  fetchMyDriverProfile,
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

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[{
      backgroundColor: '#FFFFFF', borderRadius: 12,
      borderWidth: 1, borderColor: '#E6E8EC',
      overflow: 'hidden',
      shadowColor: '#10203080', shadowOpacity: 0.05, shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 }, elevation: 1,
    }, style]}>
      {children}
    </View>
  )
}

function DataRow({ label, value, isLast = false }: { label: string; value: string | null; isLast?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#E6E8EC' }}>
      <Text style={{ fontSize: 13.5, color: '#69727E', flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 13.5, fontWeight: '600', color: '#16202C' }}>{value ?? '—'}</Text>
    </View>
  )
}

function NavRow({ label, detail, danger = false, isLast = false, onPress }: {
  label: string; detail?: string; danger?: boolean; isLast?: boolean; onPress?: () => void
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#E6E8EC',
    }}>
      <Text style={{ fontSize: 14, fontWeight: '500', color: danger ? '#E5342B' : '#16202C', flex: 1 }}>{label}</Text>
      {detail && <Text style={{ fontSize: 13, color: '#9AA3AD', marginRight: 6 }}>{detail}</Text>}
      {!danger && <Text style={{ fontSize: 16, color: '#9AA3AD' }}>›</Text>}
    </TouchableOpacity>
  )
}

export default function ProfileScreen() {
  const profile = useStore(s => s.profile)
  const setProfile = useStore(s => s.setProfile)
  const setActiveVehicle = useStore(s => s.setActiveVehicle)
  const isDark = useStore(s => s.isDark)
  const t = getTheme(isDark)

  const bgColor = isDark ? t.bg : '#F7F8FA'

  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null)
  const [assignedTruck, setAssignedTruck]  = useState<AssignedTruck | null | undefined>(undefined)
  const [profileLoading, setProfileLoading] = useState(true)

  const load = useCallback(async () => {
    setProfileLoading(true)
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
    setProfileLoading(false)
  }, [setActiveVehicle])

  useEffect(() => { void load() }, [load])

  const logout = async () => {
    await supabase.auth.signOut()
    setProfile(null)
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
      contentContainerStyle={{ padding: 18, paddingTop: 60, paddingBottom: 60 }}
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
          <Text style={{ fontSize: 22, fontWeight: '800', color: t.text, letterSpacing: -0.5, lineHeight: 26 }}>{profile?.full_name ?? '—'}</Text>
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
      ) : (
        <>
          {/* ── Camión asignado ──────────────────────────────────────── */}
          <SectionLabel>Camión asignado</SectionLabel>
          <View style={{ marginBottom: 22 }}>
            {assignedTruck ? (
              <Card style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View style={{
                    width: 46, height: 46, borderRadius: 8,
                    backgroundColor: '#FDECEA', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Text style={{ fontSize: 22 }}>🚛</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#16202C', letterSpacing: -0.3 }}>
                      {assignedTruck.name}
                    </Text>
                    {assignedTruck.modelo && (
                      <Text style={{ fontSize: 12.5, color: '#69727E', marginTop: 2 }}>
                        {assignedTruck.modelo}{assignedTruck.anio ? ` · ${assignedTruck.anio}` : ''}
                      </Text>
                    )}
                  </View>
                  {assignedTruck.patente && (
                    <View style={{ backgroundColor: '#F2F4F7', borderRadius: 4, borderWidth: 1, borderColor: '#E6E8EC', paddingHorizontal: 8, paddingVertical: 5 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: '#16202C', fontVariantNumeric: 'tabular-nums' }}>
                        {assignedTruck.patente}
                      </Text>
                    </View>
                  )}
                </View>
              </Card>
            ) : (
              <Card style={{ padding: 14 }}>
                <Text style={{ fontSize: 13, color: '#9AA3AD' }}>Tu empresa aún no te asignó un camión.</Text>
              </Card>
            )}
          </View>

          {/* ── Datos de contacto ────────────────────────────────────── */}
          <SectionLabel>Datos de contacto</SectionLabel>
          <Card style={{ marginBottom: 22 }}>
            <DataRow label="Teléfono" value={driverProfile?.telefono ?? null} />
            <DataRow label="Email" value={profile?.email ?? null} isLast />
          </Card>

          {/* ── Cuenta ──────────────────────────────────────────────── */}
          <SectionLabel>Cuenta</SectionLabel>
          <Card style={{ marginBottom: 18 }}>
            <NavRow label="Notificaciones" detail="Activadas" />
            <NavRow label="Seguridad y datos" />
            <NavRow label="Ayuda y soporte" />
            <NavRow label="Cerrar sesión" danger isLast onPress={logout} />
          </Card>

          <Text style={{ textAlign: 'center', fontSize: 11, color: '#9AA3AD', fontVariantNumeric: 'tabular-nums', letterSpacing: 0.4, paddingBottom: 8 }}>
            SafeTruck · versión 1.0.0
          </Text>
        </>
      )}
    </ScrollView>
  )
}
