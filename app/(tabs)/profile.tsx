import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, ScrollView, AppState,
} from 'react-native'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'
import {
  fetchMobileSubscription,
  startMobileCheckout,
  type MobileSubscription,
} from '../../src/services/billing'
import { PLAN_OPTIONS } from '../../src/constants/register'
import type { SubscriptionPlan } from '../../src/types'
import { redeemInvitation, fetchMyAssignedTruck, type AssignedTruck } from '../../src/services/assignedTrips'

export default function ProfileScreen() {
  const { profile, setProfile, activeVehicle, setActiveVehicle, vehicles, setVehicles } = useStore()
  const isDark = useStore(st => st.isDark)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])

  const [loading, setLoading] = useState(false)
  const [showAddVehicle, setShowAddVehicle] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<any>(null)

  // ── Suscripción ──────────────────────────────────────────────
  const [subscription, setSubscription]     = useState<MobileSubscription | null>(null)
  const [subLoading, setSubLoading]         = useState(true)
  const [upgradingPlan, setUpgradingPlan]   = useState<string | null>(null)
  const [showPlanOptions, setShowPlanOptions] = useState(false)

  const refreshSubscription = useCallback(async () => {
    const sub = await fetchMobileSubscription()
    setSubscription(sub)
    setSubLoading(false)
  }, [])

  useEffect(() => { refreshSubscription() }, [refreshSubscription])

  // Refresh when the app comes to the foreground (user returns from MercadoPago browser)
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshSubscription()
    })
    return () => sub.remove()
  }, [refreshSubscription])

  const handleUpgradePlan = async (plan: SubscriptionPlan) => {
    setUpgradingPlan(plan)
    try {
      await startMobileCheckout(plan)
      // Browser closed — refresh subscription (webhook may have already fired)
      await refreshSubscription()
      setShowPlanOptions(false)
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo iniciar el pago.')
    } finally {
      setUpgradingPlan(null)
    }
  }

  // ── Camión asignado por el admin ─────────────────────────────
  const [assignedTruck, setAssignedTruck] = useState<AssignedTruck | null | undefined>(undefined)

  const loadAssignedTruck = useCallback(async () => {
    try {
      const truck = await fetchMyAssignedTruck()
      setAssignedTruck(truck)
    } catch {
      setAssignedTruck(null)
    }
  }, [])

  useEffect(() => { loadAssignedTruck() }, [loadAssignedTruck])

  // ── Invitación ───────────────────────────────────────────────
  const [inviteCode, setInviteCode]       = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteLinked, setInviteLinked]   = useState(false)

  const handleRedeemCode = async () => {
    const code = inviteCode.trim().toUpperCase()
    if (!code) return Alert.alert('Error', 'Ingresá el código de invitación')
    setInviteLoading(true)
    try {
      const res = await redeemInvitation(code)
      setInviteLinked(true)
      setInviteCode('')
      void loadAssignedTruck()
      Alert.alert('¡Vinculado!', `Quedaste vinculado como conductor. Ahora podés recibir viajes asignados.`)
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Código inválido o vencido')
    } finally {
      setInviteLoading(false)
    }
  }

  const [plate, setPlate]   = useState('')
  const [name, setName]     = useState('')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [width, setWidth]   = useState('')
  const [length, setLength] = useState('')

  useEffect(() => { loadVehicles() }, [])

  const loadVehicles = async () => {
    if (!profile) return
    const { data } = await supabase
      .from('st_vehicles')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
    if (data) {
      setVehicles(data)
      const def = data.find(v => v.is_default) || data[0]
      if (def) setActiveVehicle(def)
    }
  }

  const openEdit = (vehicle: any) => {
    setEditingVehicle(vehicle)
    setPlate(vehicle.plate)
    setName(vehicle.name || '')
    setWeight(String(vehicle.weight_kg))
    setHeight(String(vehicle.height_m))
    setWidth(String(vehicle.width_m))
    setLength(String(vehicle.length_m || ''))
    setShowAddVehicle(false)
  }

  const cancelEdit = () => {
    setEditingVehicle(null)
    setPlate(''); setName(''); setWeight(''); setHeight(''); setWidth(''); setLength('')
  }

  const saveVehicle = async () => {
    if (!plate || !weight || !height || !width)
      return Alert.alert('Error', 'Patente, peso, altura y ancho son obligatorios')
    if (!profile) return
    setLoading(true)
    try {
      if (editingVehicle) {
        const { data, error } = await supabase
          .from('st_vehicles')
          .update({
            plate: plate.toUpperCase(),
            name: name || plate.toUpperCase(),
            weight_kg: parseFloat(weight),
            height_m:  parseFloat(height),
            width_m:   parseFloat(width),
            length_m:  parseFloat(length) || 12,
          })
          .eq('id', editingVehicle.id)
          .select().single()
        if (error) throw error
        setActiveVehicle(data)
        setVehicles(vehicles.map(v => v.id === data.id ? data : v))
        setEditingVehicle(null)
      } else {
        const isFirst = vehicles.length === 0
        const { data, error } = await supabase
          .from('st_vehicles')
          .insert({
            user_id:    profile.id,
            plate:      plate.toUpperCase(),
            name:       name || plate.toUpperCase(),
            weight_kg:  parseFloat(weight),
            height_m:   parseFloat(height),
            width_m:    parseFloat(width),
            length_m:   parseFloat(length) || 12,
            is_default: isFirst,
          })
          .select().single()
        if (error) throw error
        setActiveVehicle(data)
        setVehicles([data, ...vehicles])
        setShowAddVehicle(false)
      }
      setPlate(''); setName(''); setWeight(''); setHeight(''); setWidth(''); setLength('')
      Alert.alert('Vehículo guardado')
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  const setDefault = async (vehicle: any) => {
    if (!profile) return
    await supabase.from('st_vehicles').update({ is_default: false }).eq('user_id', profile.id)
    await supabase.from('st_vehicles').update({ is_default: true }).eq('id', vehicle.id)
    setActiveVehicle(vehicle)
    loadVehicles()
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {/* Perfil */}
      <View style={s.profileCard}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{profile?.full_name?.[0]?.toUpperCase() || '?'}</Text>
        </View>
        <View style={s.profileInfo}>
          <Text style={s.profileName}>{profile?.full_name}</Text>
          <Text style={s.profileSub}>Conductor registrado</Text>
        </View>
        <TouchableOpacity style={s.logoutBtn} onPress={logout}>
          <Text style={s.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* ── Vincular empresa ─────────────────────────────────── */}
      {!inviteLinked && (
        <View style={s.section}>
          <Text style={s.sectionLabel}> VINCULAR CON EMPRESA</Text>
          <View style={s.card}>
            <Text style={[s.cardTitle, { marginBottom: 8 }]}>Código de invitación</Text>
            <Text style={{ color: t.textMuted, fontSize: 13, marginBottom: 14 }}>
              Si tu empresa te envió un código, ingrésalo aquí para poder recibir viajes asignados.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                style={[s.input, { flex: 1, textTransform: 'uppercase', letterSpacing: 2 }]}
                placeholder="Ej: AB3X7YKP"
                placeholderTextColor={t.textSoft}
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="characters"
                maxLength={10}
              />
              <TouchableOpacity
                style={[s.btnPrimary, { paddingHorizontal: 16 }, inviteLoading && s.btnDisabled]}
                onPress={handleRedeemCode}
                disabled={inviteLoading}
              >
                {inviteLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.btnPrimaryText}>Canjear</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {inviteLinked && (
        <View style={s.section}>
          <Text style={s.sectionLabel}> EMPRESA VINCULADA</Text>
          <View style={[s.card, { borderColor: t.success, borderWidth: 1.5 }]}>
            <Text style={{ color: t.success, fontWeight: '700', fontSize: 14 }}>
              ✓ Vinculado correctamente
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 13, marginTop: 4 }}>
              Ya podés recibir viajes asignados en la pestaña Viajes.
            </Text>
          </View>
        </View>
      )}

      {/* ── Camión asignado ─────────────────────────────────── */}
      {assignedTruck !== undefined && (
        <View style={s.section}>
          <Text style={s.sectionLabel}> CAMIÓN ASIGNADO</Text>
          {assignedTruck ? (
            <View style={[s.vehicleCard, { borderColor: t.success }]}>
              <Text style={s.vehicleName}>{assignedTruck.name}</Text>
              {assignedTruck.patente && (
                <Text style={s.vehiclePlate}>{assignedTruck.patente}</Text>
              )}
              {assignedTruck.modelo && (
                <Text style={[s.vehiclePlate, { marginBottom: 12 }]}>
                  {assignedTruck.modelo}{assignedTruck.anio ? ` · ${assignedTruck.anio}` : ''}
                </Text>
              )}
              <View style={s.specsRow}>
                {[
                  { val: `${assignedTruck.max_weight_kg} kg`, lbl: 'PESO MÁX' },
                  { val: `${assignedTruck.max_height_m} m`,   lbl: 'ALTURA MÁX' },
                  { val: `${assignedTruck.max_width_m} m`,    lbl: 'ANCHO MÁX' },
                ].map(spec => (
                  <View key={spec.lbl} style={s.spec}>
                    <Text style={[s.specVal, { color: t.success }]}>{spec.val}</Text>
                    <Text style={s.specLbl}>{spec.lbl}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={s.card}>
              <Text style={{ color: t.textMuted, fontSize: 13 }}>
                Tu empresa aún no te asignó un camión.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── Suscripción ──────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionLabel}> MI SUSCRIPCIÓN</Text>
        <View style={s.card}>
          {subLoading ? (
            <ActivityIndicator color={t.accent} />
          ) : (
            <>
              <View style={s.subRow}>
                <View>
                  <Text style={s.subLabel}>PLAN</Text>
                  <View style={[s.planBadge, { backgroundColor: planColor(subscription?.plan).bg }]}>
                    <Text style={[s.planBadgeText, { color: planColor(subscription?.plan).text }]}>
                      {subscription?.plan ? subscription.plan.toUpperCase() : 'SIN PLAN'}
                    </Text>
                  </View>
                </View>

                {subscription?.status && (
                  <View>
                    <Text style={s.subLabel}>ESTADO</Text>
                    <Text style={[s.subValue, { color: statusColor(subscription.status) }]}>
                      ● {STATUS_LABELS[subscription.status] ?? subscription.status}
                    </Text>
                  </View>
                )}

                {subscription?.current_period_end && (
                  <View>
                    <Text style={s.subLabel}>PRÓX. COBRO</Text>
                    <Text style={s.subValue}>
                      {new Date(subscription.current_period_end).toLocaleDateString('es-AR', {
                        day: 'numeric', month: 'short',
                      })}
                    </Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[s.btnPrimary, s.subBtn]}
                onPress={() => setShowPlanOptions(v => !v)}
              >
                <Text style={s.btnPrimaryText}>
                  {showPlanOptions ? 'Cerrar planes' : subscription?.plan ? 'Cambiar plan' : 'Elegir plan'}
                </Text>
              </TouchableOpacity>

              {showPlanOptions && (
                <View style={{ marginTop: 16, gap: 12 }}>
                  {PLAN_OPTIONS.map(plan => {
                    const isCurrent = subscription?.plan === plan.slug
                    const isLoading = upgradingPlan === plan.slug
                    return (
                      <View
                        key={plan.slug}
                        style={[s.miniPlanCard, isCurrent && s.miniPlanCardActive]}
                      >
                        <View style={s.miniPlanHeader}>
                          <Text style={s.miniPlanName}>{plan.name}</Text>
                          <Text style={[s.miniPlanPrice, { color: planColor(plan.slug).text }]}>
                            {plan.price} <Text style={s.miniPlanPeriod}>USD/mes</Text>
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[
                            s.miniPlanBtn,
                            isCurrent && s.miniPlanBtnCurrent,
                            { borderColor: planColor(plan.slug).text },
                            !isCurrent && { backgroundColor: planColor(plan.slug).text },
                          ]}
                          onPress={() => !isCurrent && handleUpgradePlan(plan.slug)}
                          disabled={isCurrent || !!upgradingPlan}
                        >
                          {isLoading ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text style={[
                              s.miniPlanBtnText,
                              isCurrent && { color: planColor(plan.slug).text },
                            ]}>
                              {isCurrent ? 'Plan actual' : 'Cambiar'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    )
                  })}
                </View>
              )}
            </>
          )}
        </View>
      </View>

      {/* Vehículo activo */}
      {activeVehicle && (
        <View style={s.section}>
          <Text style={s.sectionLabel}> VEHÍCULO ACTIVO</Text>

          {editingVehicle?.id === activeVehicle.id ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Editar vehículo</Text>
              <VehicleForm
                s={s} t={t}
                plate={plate} setPlate={setPlate}
                name={name} setName={setName}
                weight={weight} setWeight={setWeight}
                height={height} setHeight={setHeight}
                width={width} setWidth={setWidth}
                length={length} setLength={setLength}
              />
              <View style={s.formActions}>
                <TouchableOpacity
                  style={[s.btnPrimary, { flex: 1 }, loading && s.btnDisabled]}
                  onPress={saveVehicle} disabled={loading}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Guardar</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnGhost, { flex: 1 }]} onPress={cancelEdit}>
                  <Text style={s.btnGhostText}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={s.vehicleCard}>
              <TouchableOpacity style={s.editBtn} onPress={() => openEdit(activeVehicle)}>
                <Text style={s.editBtnText}>Editar</Text>
              </TouchableOpacity>
              <Text style={s.vehicleName}>{activeVehicle.name || activeVehicle.plate}</Text>
              <Text style={s.vehiclePlate}>{activeVehicle.plate}</Text>
              <View style={s.specsRow}>
                {[
                  { val: `${activeVehicle.weight_kg} kg`, lbl: 'PESO' },
                  { val: `${activeVehicle.height_m} m`,   lbl: 'ALTURA' },
                  { val: `${activeVehicle.width_m} m`,    lbl: 'ANCHO' },
                ].map(spec => (
                  <View key={spec.lbl} style={s.spec}>
                    <Text style={s.specVal}>{spec.val}</Text>
                    <Text style={s.specLbl}>{spec.lbl}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Lista de vehículos */}
      {vehicles.length > 1 && (
        <View style={s.section}>
          <Text style={s.sectionLabel}> MIS VEHÍCULOS</Text>
          {vehicles.map(v => (
            <TouchableOpacity
              key={v.id}
              style={[s.vehicleItem, activeVehicle?.id === v.id && s.vehicleItemActive]}
              onPress={() => setDefault(v)}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.vehicleItemName}>{v.name || v.plate}</Text>
                <Text style={s.vehicleItemSub}>{v.plate} · {v.weight_kg} kg · {v.height_m} m alt</Text>
              </View>
              {activeVehicle?.id === v.id && (
                <View style={s.checkBadge}>
                  <Text style={s.checkBadgeText}>Activo</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Agregar vehículo */}
      <TouchableOpacity style={s.addBtn} onPress={() => setShowAddVehicle(!showAddVehicle)}>
        <Text style={s.addBtnText}>{showAddVehicle ? '✕  Cancelar' : '+  Agregar vehículo'}</Text>
      </TouchableOpacity>

      {showAddVehicle && (
        <View style={[s.card, { marginTop: 8 }]}>
          <Text style={s.cardTitle}>Nuevo vehículo</Text>
          <VehicleForm
            s={s} t={t}
            plate={plate} setPlate={setPlate}
            name={name} setName={setName}
            weight={weight} setWeight={setWeight}
            height={height} setHeight={setHeight}
            width={width} setWidth={setWidth}
            length={length} setLength={setLength}
          />
          <TouchableOpacity
            style={[s.btnPrimary, loading && s.btnDisabled]}
            onPress={saveVehicle} disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Guardar vehículo</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

// ── Billing helpers ────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active:     'Activo',
  trialing:   'Trial',
  past_due:   'Pago vencido',
  cancelled:  'Cancelado',
  incomplete: 'Incompleto',
}

function planColor(plan?: string | null): { bg: string; text: string } {
  switch (plan) {
    case 'pro':        return { bg: '#eff6ff', text: '#2563eb' }
    case 'enterprise': return { bg: '#fdf4ff', text: '#9333ea' }
    default:           return { bg: '#f3f4f6', text: '#6b7280' }
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'active':   return '#16a34a'
    case 'trialing': return '#2563eb'
    case 'past_due': return '#dc2626'
    default:         return '#6b7280'
  }
}

// Sub-componente del formulario para no repetir código
function VehicleForm({ s, t, plate, setPlate, name, setName, weight, setWeight, height, setHeight, width, setWidth, length, setLength }: any) {
  return (
    <>
      <View style={s.field}>
        <Text style={s.fieldLabel}>PATENTE *</Text>
        <TextInput style={s.input} placeholder="ABC 123" placeholderTextColor={t.textSoft}
          value={plate} onChangeText={setPlate} autoCapitalize="characters" />
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>NOMBRE DEL VEHÍCULO</Text>
        <TextInput style={s.input} placeholder="Ej: Mercedes Actros" placeholderTextColor={t.textSoft}
          value={name} onChangeText={setName} />
      </View>
      <View style={s.formRow}>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.fieldLabel}>PESO TOTAL (kg) *</Text>
          <TextInput style={s.input} placeholder="25000" placeholderTextColor={t.textSoft}
            value={weight} onChangeText={setWeight} keyboardType="numeric" />
        </View>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.fieldLabel}>ALTURA (m) *</Text>
          <TextInput style={s.input} placeholder="4.2" placeholderTextColor={t.textSoft}
            value={height} onChangeText={setHeight} keyboardType="numeric" />
        </View>
      </View>
      <View style={s.formRow}>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.fieldLabel}>ANCHO (m) *</Text>
          <TextInput style={s.input} placeholder="2.6" placeholderTextColor={t.textSoft}
            value={width} onChangeText={setWidth} keyboardType="numeric" />
        </View>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.fieldLabel}>LARGO (m)</Text>
          <TextInput style={s.input} placeholder="12" placeholderTextColor={t.textSoft}
            value={length} onChangeText={setLength} keyboardType="numeric" />
        </View>
      </View>
    </>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    content: { padding: 16, paddingTop: 60, paddingBottom: 100 },

    // Header de perfil
    profileCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1, borderColor: t.cardBorder,
      padding: 16, marginBottom: 24,
    },
    avatar: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: t.accent,
      alignItems: 'center', justifyContent: 'center', marginRight: 12,
    },
    avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
    profileInfo: { flex: 1 },
    profileName: { color: t.text, fontSize: 15, fontWeight: '600' },
    profileSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    logoutBtn: { backgroundColor: t.dangerSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    logoutText: { color: t.danger, fontSize: 13, fontWeight: '600' },

    // Secciones
    section: { marginBottom: 20 },
    sectionLabel: {
      fontSize: 11, fontWeight: '700', color: t.textMuted,
      letterSpacing: 0.8, marginBottom: 10,
    },

    // Card genérica (--dash-card style)
    card: {
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1, borderColor: t.cardBorder,
      padding: 20,
    },
    cardTitle: { color: t.text, fontSize: 16, fontWeight: '700', marginBottom: 16 },

    // Vehículo activo (con borde accent como --dash-plan--current)
    vehicleCard: {
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1.5, borderColor: t.accent,
      padding: 20, position: 'relative',
    },
    editBtn: {
      position: 'absolute', top: 12, right: 12,
      backgroundColor: t.surface2, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 5,
    },
    editBtnText: { color: t.accent, fontSize: 13, fontWeight: '600' },
    vehicleName: { color: t.text, fontSize: 18, fontWeight: '700', marginBottom: 2, paddingRight: 60 },
    vehiclePlate: { color: t.textMuted, fontSize: 13, marginBottom: 16 },
    specsRow: { flexDirection: 'row' },
    spec: { flex: 1, alignItems: 'center' },
    specVal: { color: t.accent, fontSize: 17, fontWeight: '700' },
    specLbl: { color: t.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginTop: 2 },

    // Lista de vehículos
    vehicleItem: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: t.card, borderRadius: 12,
      borderWidth: 1, borderColor: t.cardBorder,
      padding: 14, marginBottom: 8,
    },
    vehicleItemActive: { borderColor: t.accent },
    vehicleItemName: { color: t.text, fontSize: 14, fontWeight: '600' },
    vehicleItemSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    checkBadge: {
      backgroundColor: t.accentSoft, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 4,
    },
    checkBadgeText: { color: t.accent, fontSize: 12, fontWeight: '600' },

    // Botón agregar vehículo
    addBtn: {
      backgroundColor: t.card, borderRadius: 12,
      borderWidth: 1, borderColor: t.border, borderStyle: 'dashed',
      padding: 16, alignItems: 'center',
    },
    addBtnText: { color: t.accent, fontSize: 14, fontWeight: '600' },

    // ── Suscripción ──────────────────────────────────────────
    subRow: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginBottom: 16,
    },
    subLabel: {
      fontSize: 10, fontWeight: '700', color: t.textMuted,
      letterSpacing: 0.6, marginBottom: 4,
    },
    subValue: { color: t.text, fontSize: 14, fontWeight: '600' },
    subBtn: { marginTop: 0 },

    planBadge: {
      paddingHorizontal: 12, paddingVertical: 5,
      borderRadius: 999, alignSelf: 'flex-start',
    },
    planBadgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

    // Mini plan cards (in profile)
    miniPlanCard: {
      borderWidth: 1, borderColor: t.border,
      borderRadius: 12, padding: 14,
      backgroundColor: t.card,
    },
    miniPlanCardActive: { borderColor: t.accent },
    miniPlanHeader: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', marginBottom: 10,
    },
    miniPlanName: { color: t.text, fontSize: 15, fontWeight: '700' },
    miniPlanPrice: { fontSize: 16, fontWeight: '800' },
    miniPlanPeriod: { fontSize: 11, fontWeight: '400', color: t.textMuted },
    miniPlanBtn: {
      borderRadius: 8, borderWidth: 1.5,
      paddingVertical: 8, alignItems: 'center',
    },
    miniPlanBtnCurrent: { backgroundColor: 'transparent' },
    miniPlanBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

    // Formulario (--dash-form style)
    field: { marginBottom: 12 },
    fieldLabel: {
      fontSize: 11, fontWeight: '700', color: t.textMuted,
      letterSpacing: 0.8, marginBottom: 5,
    },
    input: {
      backgroundColor: t.surface2, color: t.text,
      borderWidth: 1, borderColor: 'transparent',
      borderRadius: 10, padding: 13, fontSize: 15,
    },
    formRow: { flexDirection: 'row', gap: 10 },
    formActions: { flexDirection: 'row', gap: 10, marginTop: 8 },

    // Botones (--dash-btn style)
    btnPrimary: {
      backgroundColor: t.accent, borderRadius: 10,
      padding: 14, alignItems: 'center',
    },
    btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
    btnDisabled: { opacity: 0.6 },
    btnGhost: {
      backgroundColor: t.surface2, borderRadius: 10,
      padding: 14, alignItems: 'center',
    },
    btnGhostText: { color: t.text, fontSize: 15, fontWeight: '600' },
  })
}
