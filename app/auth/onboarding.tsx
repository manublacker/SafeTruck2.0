/**
 * Onboarding post-registro: el conductor elige cómo va a usar SafeTruck.
 *
 *  - "Trabajo para una empresa" → canjea el código de invitación que le dio
 *    su administrador (POST /api/invitations/redeem).
 *  - "Soy independiente"        → carga su camión, paga el plan individual con
 *    MercadoPago y queda operativo sin empresa.
 *
 * También se llega desde Perfil cuando la cuenta todavía no está vinculada.
 * El flujo independiente es re-entrante: si el pago quedó hecho pero el camión
 * no se llegó a crear (app cerrada en el medio), volver a entrar retoma donde
 * quedó (el setup es idempotente y el confirm detecta el plan ya activo).
 */
import { useMemo, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'
import { redeemInvitation, fetchMyAssignedTruck } from '../../src/services/assignedTrips'
import {
  setupIndependentAccount, createMyTruck, assignTruckToSelf,
  confirmSubscription, hasActivePlan, INDEPENDENT_PLAN,
} from '../../src/services/independent'
import { startMobileCheckout } from '../../src/services/billing'

type Mode = 'choice' | 'company' | 'truck' | 'payment' | 'done'

interface TruckForm {
  name: string
  patente: string
  max_weight_kg: string
  max_height_m: string
  max_width_m: string
  max_length_m: string
}

const EMPTY_TRUCK: TruckForm = {
  name: '', patente: '', max_weight_kg: '', max_height_m: '', max_width_m: '', max_length_m: '',
}

function parseNum(v: string): number | null {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

export default function OnboardingScreen() {
  const profile = useStore(st => st.profile)
  const setActiveVehicle = useStore(st => st.setActiveVehicle)
  const isDark = useStore(st => st.isDark)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('choice')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // empresa
  const [code, setCode] = useState('')

  // independiente
  const [truck, setTruck] = useState<TruckForm>(EMPTY_TRUCK)
  const [truckErrors, setTruckErrors] = useState<Partial<Record<keyof TruckForm, string>>>({})
  const [driverId, setDriverId] = useState<number | null>(null)
  const [paymentPending, setPaymentPending] = useState(false)

  const goToApp = () => router.replace('/(tabs)/')

  function updateTruck<K extends keyof TruckForm>(key: K, value: string) {
    setTruck(p => ({ ...p, [key]: value }))
    setTruckErrors(p => ({ ...p, [key]: undefined }))
  }

  // ── Empresa: canjear código ────────────────────────────────────────────────
  async function handleRedeem() {
    const clean = code.trim().toUpperCase()
    if (clean.length < 6) { setError('Ingresá el código que te pasó tu empresa.'); return }
    setLoading(true)
    setError('')
    try {
      await redeemInvitation(clean)
      // El camión puede venir ya asignado por la empresa: lo cargamos al toque.
      const at = await fetchMyAssignedTruck().catch(() => null)
      if (at) {
        setActiveVehicle({
          id: String(at.id), user_id: '', plate: at.patente ?? '', name: at.name,
          weight_kg: at.max_weight_kg, height_m: at.max_height_m,
          width_m: at.max_width_m, length_m: at.max_length_m,
          axles: 0, is_default: true, created_at: '',
        })
      }
      setMode('done')
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo canjear el código.')
    } finally {
      setLoading(false)
    }
  }

  // ── Independiente paso 1: validar camión y crear el auto-vínculo ──────────
  function validateTruck(): boolean {
    const next: typeof truckErrors = {}
    if (!truck.name.trim()) next.name = 'Ingresá un nombre para tu camión'
    if (!parseNum(truck.max_weight_kg)) next.max_weight_kg = 'Peso máximo inválido'
    if (!parseNum(truck.max_height_m)) next.max_height_m = 'Alto inválido'
    if (!parseNum(truck.max_width_m)) next.max_width_m = 'Ancho inválido'
    if (!parseNum(truck.max_length_m)) next.max_length_m = 'Largo inválido'
    setTruckErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleTruckNext() {
    if (!validateTruck()) return
    setLoading(true)
    setError('')
    try {
      const setup = await setupIndependentAccount({
        full_name: profile?.full_name,
        telefono: profile?.phone ?? null,
      })
      setDriverId(setup.driver_id)
      setMode('payment')
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo configurar tu cuenta.')
    } finally {
      setLoading(false)
    }
  }

  // Con la suscripción activa, crea el camión y se lo asigna a sí mismo.
  async function finishIndependent(driver: number) {
    const created = await createMyTruck({
      name: truck.name.trim(),
      patente: truck.patente.trim() || null,
      max_weight_kg: parseNum(truck.max_weight_kg)!,
      max_height_m: parseNum(truck.max_height_m)!,
      max_width_m: parseNum(truck.max_width_m)!,
      max_length_m: parseNum(truck.max_length_m)!,
    })
    await assignTruckToSelf(created.id, driver)
    setActiveVehicle({
      id: String(created.id), user_id: '', plate: truck.patente.trim(), name: truck.name.trim(),
      weight_kg: parseNum(truck.max_weight_kg)!, height_m: parseNum(truck.max_height_m)!,
      width_m: parseNum(truck.max_width_m)!, length_m: parseNum(truck.max_length_m)!,
      axles: 0, is_default: true, created_at: '',
    })
    setMode('done')
  }

  // ── Independiente paso 2: pago ─────────────────────────────────────────────
  async function handlePay() {
    if (driverId == null) return
    setLoading(true)
    setError('')
    try {
      // Si ya pagó antes (reintento / app cerrada a mitad del flujo), no lo
      // mandamos a pagar de nuevo.
      let sub = await confirmSubscription(INDEPENDENT_PLAN)
      if (!hasActivePlan(sub)) {
        await startMobileCheckout(INDEPENDENT_PLAN)
        sub = await confirmSubscription(INDEPENDENT_PLAN)
      }
      if (hasActivePlan(sub)) {
        await finishIndependent(driverId)
      } else {
        // Volvió del checkout sin pago acreditado: puede reintentar el pago
        // (botón principal) o verificar más tarde si pagó recién (secundario).
        setPaymentPending(true)
      }
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo completar el pago.')
    } finally {
      setLoading(false)
    }
  }

  // Solo consulta si el pago ya figura acreditado, sin abrir MercadoPago.
  async function handleVerifyPayment() {
    if (driverId == null) return
    setLoading(true)
    setError('')
    try {
      const sub = await confirmSubscription(INDEPENDENT_PLAN)
      if (hasActivePlan(sub)) {
        await finishIndependent(driverId)
      } else {
        setError('Todavía no encontramos tu pago. Si acabás de pagar, esperá un minuto y volvé a verificar.')
      }
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo verificar el pago.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {mode !== 'choice' && mode !== 'done' && (
          <TouchableOpacity
            style={s.backLink}
            onPress={() => { setError(''); setMode(mode === 'payment' ? 'truck' : 'choice') }}
          >
            <Text style={s.backText}>← Volver</Text>
          </TouchableOpacity>
        )}

        {/* ── Elección ──────────────────────────────────────────────────── */}
        {mode === 'choice' && (
          <View>
            <Text style={s.title}>¿Cómo vas a usar SafeTruck?</Text>
            <Text style={s.subtitle}>Podés cambiarlo más adelante desde tu perfil.</Text>

            <TouchableOpacity style={s.optionCard} activeOpacity={0.85} onPress={() => { setError(''); setMode('company') }}>
              <View style={s.optionIcon}><Ionicons name="business" size={22} color={t.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.optionTitle}>Trabajo para una empresa</Text>
                <Text style={s.optionDesc}>Tu empresa te dio un código de invitación. Tu plan lo paga la empresa.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.textSoft} />
            </TouchableOpacity>

            <TouchableOpacity style={s.optionCard} activeOpacity={0.85} onPress={() => { setError(''); setMode('truck') }}>
              <View style={s.optionIcon}><Ionicons name="person" size={22} color={t.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.optionTitle}>Soy independiente</Text>
                <Text style={s.optionDesc}>Manejás tu propio camión. Pagás tu plan individual y usás la app sin empresa.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.textSoft} />
            </TouchableOpacity>

            <TouchableOpacity style={s.link} onPress={goToApp}>
              <Text style={s.linkText}>Lo decido más tarde</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Empresa: código ───────────────────────────────────────────── */}
        {mode === 'company' && (
          <View>
            <Text style={s.title}>Código de invitación</Text>
            <Text style={s.subtitle}>Pedile a tu empresa el código de 8 caracteres y escribilo acá.</Text>

            <TextInput
              style={s.codeInput}
              value={code}
              onChangeText={v => { setCode(v.toUpperCase()); setError('') }}
              placeholder="ABCD1234"
              placeholderTextColor={t.textSoft}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              textAlign="center"
              autoFocus
            />
            {!!error && <Text style={s.error}>{error}</Text>}

            <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleRedeem} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Vincularme</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Independiente: camión ─────────────────────────────────────── */}
        {mode === 'truck' && (
          <View>
            <Text style={s.title}>Tu camión</Text>
            <Text style={s.subtitle}>
              Con las dimensiones y el peso calculamos rutas aptas para tu vehículo:
              sin puentes bajos ni calles no habilitadas.
            </Text>

            <TextInput
              style={s.input} placeholder="Nombre (ej: Mi Scania)" placeholderTextColor={t.textSoft}
              value={truck.name} onChangeText={v => updateTruck('name', v)}
            />
            {truckErrors.name && <Text style={s.error}>{truckErrors.name}</Text>}

            <TextInput
              style={s.input} placeholder="Patente (opcional)" placeholderTextColor={t.textSoft}
              value={truck.patente} onChangeText={v => updateTruck('patente', v.toUpperCase())}
              autoCapitalize="characters" autoCorrect={false}
            />

            <TextInput
              style={s.input} placeholder="Peso máximo (kg)" placeholderTextColor={t.textSoft}
              value={truck.max_weight_kg} onChangeText={v => updateTruck('max_weight_kg', v)}
              keyboardType="numeric"
            />
            {truckErrors.max_weight_kg && <Text style={s.error}>{truckErrors.max_weight_kg}</Text>}

            <View style={s.dimsRow}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={s.input} placeholder="Alto (m)" placeholderTextColor={t.textSoft}
                  value={truck.max_height_m} onChangeText={v => updateTruck('max_height_m', v)}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={s.input} placeholder="Ancho (m)" placeholderTextColor={t.textSoft}
                  value={truck.max_width_m} onChangeText={v => updateTruck('max_width_m', v)}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={s.input} placeholder="Largo (m)" placeholderTextColor={t.textSoft}
                  value={truck.max_length_m} onChangeText={v => updateTruck('max_length_m', v)}
                  keyboardType="numeric"
                />
              </View>
            </View>
            {(truckErrors.max_height_m || truckErrors.max_width_m || truckErrors.max_length_m) && (
              <Text style={s.error}>
                {truckErrors.max_height_m ?? truckErrors.max_width_m ?? truckErrors.max_length_m}
              </Text>
            )}

            {!!error && <Text style={s.error}>{error}</Text>}

            <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleTruckNext} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Siguiente</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Independiente: pago ───────────────────────────────────────── */}
        {mode === 'payment' && (
          <View>
            <Text style={s.title}>Plan Individual</Text>
            <Text style={s.subtitle}>Un solo pago mensual, un camión, todas las funciones.</Text>

            <View style={s.planCard}>
              <Text style={s.planName}>Individual</Text>
              <Text style={s.planDetail}>· Rutas aptas para tu camión{'\n'}· Navegación y viajes personales{'\n'}· Mantenimiento y alertas{'\n'}· 1 camión</Text>
            </View>

            {paymentPending && (
              <Text style={s.pending}>
                Todavía no vimos tu pago acreditado. Podés volver a intentar el pago,
                o si ya pagaste, verificarlo de nuevo.
              </Text>
            )}
            {!!error && <Text style={s.error}>{error}</Text>}

            <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handlePay} disabled={loading}>
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>Pagar con MercadoPago</Text>
              }
            </TouchableOpacity>

            {paymentPending && (
              <TouchableOpacity style={[s.btnSecondary, loading && s.btnDisabled]} onPress={handleVerifyPayment} disabled={loading}>
                <Text style={s.btnSecondaryText}>Ya pagué, verificar</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Listo ─────────────────────────────────────────────────────── */}
        {mode === 'done' && (
          <View style={{ alignItems: 'center' }}>
            <View style={s.doneIcon}><Ionicons name="checkmark" size={34} color="#fff" /></View>
            <Text style={[s.title, { textAlign: 'center' }]}>¡Cuenta lista!</Text>
            <Text style={[s.subtitle, { textAlign: 'center' }]}>
              {driverId != null
                ? 'Tu camión quedó cargado y tu plan está activo. Ya podés calcular rutas y navegar.'
                : 'Quedaste vinculado a tu empresa. Cuando te asignen un camión y viajes, los vas a ver acá.'}
            </Text>
            <TouchableOpacity style={[s.btn, { alignSelf: 'stretch' }]} onPress={goToApp}>
              <Text style={s.btnText}>Empezar</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48 },
    title: { fontSize: 26, fontWeight: '700', color: t.text, marginBottom: 6 },
    subtitle: { fontSize: 14, color: t.textMuted, marginBottom: 24, lineHeight: 20 },

    backLink: { marginBottom: 12 },
    backText: { color: t.accent, fontSize: 14 },

    optionCard: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border,
      padding: 16, marginBottom: 12,
    },
    optionIcon: {
      width: 44, height: 44, borderRadius: 10, backgroundColor: t.accentSoft,
      alignItems: 'center', justifyContent: 'center',
    },
    optionTitle: { fontSize: 15.5, fontWeight: '700', color: t.text, marginBottom: 3 },
    optionDesc: { fontSize: 12.5, color: t.textMuted, lineHeight: 17 },

    input: {
      backgroundColor: t.card, color: t.text, borderRadius: 12,
      padding: 16, marginBottom: 8, fontSize: 16,
      borderWidth: 1, borderColor: t.border,
    },
    codeInput: {
      backgroundColor: t.card, color: t.text, borderRadius: 16,
      borderWidth: 1.5, borderColor: t.accent,
      paddingVertical: 20, fontSize: 26, fontWeight: '800',
      letterSpacing: 8, marginBottom: 12,
    },
    dimsRow: { flexDirection: 'row', gap: 8 },
    error: { color: t.danger, fontSize: 13, marginBottom: 8 },
    pending: { color: t.textMuted, fontSize: 13, marginBottom: 8, lineHeight: 18 },

    planCard: {
      backgroundColor: t.card, borderRadius: 14, borderWidth: 1.5, borderColor: t.accent,
      padding: 18, marginBottom: 16,
    },
    planName: { fontSize: 17, fontWeight: '800', color: t.text, marginBottom: 8 },
    planDetail: { fontSize: 13.5, color: t.textMuted, lineHeight: 22 },

    doneIcon: {
      width: 64, height: 64, borderRadius: 32, backgroundColor: t.success,
      alignItems: 'center', justifyContent: 'center', marginBottom: 18,
    },

    btn: { backgroundColor: t.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
    btnSecondary: {
      backgroundColor: t.card, borderRadius: 12, padding: 16, alignItems: 'center',
      marginTop: 10, borderWidth: 1, borderColor: t.border,
    },
    btnSecondaryText: { color: t.text, fontSize: 15, fontWeight: '600' },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    link: { marginTop: 20, alignItems: 'center' },
    linkText: { color: t.accent, fontSize: 14 },
  })
}
