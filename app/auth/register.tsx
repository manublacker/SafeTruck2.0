import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'
import { supabase } from '../../src/services/supabase'
import { registerForPushNotifications } from '../../src/services/push'
import {
  isValidEmail, isValidPassword, resendSignupOtp,
  signUpWithEmail, verifySignupOtp,
  MIN_PASSWORD_LENGTH, OTP_LENGTH, authErrorMessage,
} from '../../src/services/auth'
import { OTP_RESEND_COOLDOWN_SECONDS } from '../../src/constants/register'

interface FormData {
  fullName: string
  phone: string
  email: string
  password: string
  confirmPassword: string
  acceptedTerms: boolean
}

type FieldErrors = Partial<Record<keyof FormData | 'otp' | 'general', string>>

export default function RegisterScreen() {
  const [step, setStep]       = useState<1 | 2>(1)
  const [form, setForm]       = useState<FormData>({
    fullName: '', phone: '', email: '', password: '', confirmPassword: '', acceptedTerms: false,
  })
  const [errors, setErrors]   = useState<FieldErrors>({})
  const [otpCode, setOtpCode] = useState('')
  const [resendIn, setResendIn]   = useState(0)
  const [loading, setLoading]     = useState(false)

  const setProfile = useStore(st => st.setProfile)
  const isDark = useStore(st => st.isDark)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])
  const router = useRouter()

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn(v => v - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm(p => ({ ...p, [key]: value }))
    setErrors(p => ({ ...p, [key]: undefined }))
  }

  function validateStep1(): boolean {
    const next: FieldErrors = {}
    if (!form.fullName.trim()) next.fullName = 'Ingresá tu nombre o alias'
    if (!form.phone.trim()) next.phone = 'Ingresá tu teléfono'
    if (!isValidEmail(form.email)) next.email = 'Email inválido'
    if (!isValidPassword(form.password)) next.password = `Mínimo ${MIN_PASSWORD_LENGTH} caracteres`
    if (form.password !== form.confirmPassword) next.confirmPassword = 'Las contraseñas no coinciden'
    if (!form.acceptedTerms) next.acceptedTerms = 'Debés aceptar los términos'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleNext() {
    if (step === 1) {
      if (!validateStep1()) return
      setLoading(true)
      try {
        await signUpWithEmail({ email: form.email, password: form.password, fullName: form.fullName })
        setResendIn(OTP_RESEND_COOLDOWN_SECONDS)
        setStep(2)
      } catch (e: any) {
        setErrors({ general: authErrorMessage(e) })
      } finally {
        setLoading(false)
      }
      return
    }

    // Step 2: verify OTP
    if (otpCode.length < OTP_LENGTH) {
      setErrors({ otp: `Ingresá los ${OTP_LENGTH} dígitos` })
      return
    }
    setLoading(true)
    try {
      await verifySignupOtp(form.email, otpCode)

      // Guardar nombre en profiles
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('profiles').upsert({
          id: user.id,
          full_name: form.fullName,
          email: form.email,
          phone: form.phone.trim() || null,
          role: 'driver',
        }, { onConflict: 'id' })

        const { data: profile } = await supabase
          .from('profiles').select('*').eq('id', user.id).single()
        if (profile) setProfile(profile)
      }

      void registerForPushNotifications()
      router.replace('/(tabs)/')
    } catch (e: any) {
      setErrors({ otp: authErrorMessage(e) })
    } finally {
      setLoading(false)
    }
  }

  async function handleResendOtp() {
    if (resendIn > 0) return
    try {
      await resendSignupOtp(form.email)
      setResendIn(OTP_RESEND_COOLDOWN_SECONDS)
    } catch (e: any) {
      setErrors({ otp: authErrorMessage(e) })
    }
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Image
          source={isDark ? require('../../camion_padding.png') : require('../../logo-DARK.png')}
          style={s.logo}
          resizeMode="contain"
        />

        {/* Progress */}
        <View style={s.progressRow}>
          {(['Cuenta', 'Verificación'] as const).map((label, i) => {
            const n = i + 1
            const done = n < step
            const active = n === step
            return (
              <View key={label} style={s.progressItem}>
                <View style={[s.progressCircle, done && s.progressCircleDone, active && s.progressCircleActive]}>
                  <Text style={s.progressCircleText}>{done ? '✓' : n}</Text>
                </View>
                <Text style={[s.progressLabel, active && s.progressLabelActive]}>{label}</Text>
              </View>
            )
          })}
        </View>

        {step === 2 && (
          <TouchableOpacity style={s.backLink} onPress={() => { setErrors({}); setStep(1); }}>
            <Text style={s.backText}>← Volver</Text>
          </TouchableOpacity>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <View>
            <Text style={s.title}>Creá tu cuenta</Text>
            <Text style={s.subtitle}>Para conductores SafeTruck.</Text>

            <TextInput
              style={s.input} placeholder="Tu nombre o alias"
              placeholderTextColor={t.textSoft} value={form.fullName}
              onChangeText={v => update('fullName', v)}
            />
            {errors.fullName && <Text style={s.error}>{errors.fullName}</Text>}

            <TextInput
              style={s.input} placeholder="Teléfono" placeholderTextColor={t.textSoft}
              value={form.phone} onChangeText={v => update('phone', v)}
              keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel"
            />
            {errors.phone && <Text style={s.error}>{errors.phone}</Text>}

            <TextInput
              style={s.input} placeholder="Email" placeholderTextColor={t.textSoft}
              value={form.email} onChangeText={v => update('email', v)}
              autoCapitalize="none" keyboardType="email-address"
              textContentType="emailAddress" autoComplete="email" autoCorrect={false}
            />
            {errors.email && <Text style={s.error}>{errors.email}</Text>}

            <TextInput
              style={s.input} placeholder="Contraseña" placeholderTextColor={t.textSoft}
              value={form.password} onChangeText={v => update('password', v)} secureTextEntry
            />
            {errors.password && <Text style={s.error}>{errors.password}</Text>}

            <TextInput
              style={s.input} placeholder="Repetí tu contraseña" placeholderTextColor={t.textSoft}
              value={form.confirmPassword} onChangeText={v => update('confirmPassword', v)} secureTextEntry
            />
            {errors.confirmPassword && <Text style={s.error}>{errors.confirmPassword}</Text>}

            <TouchableOpacity style={s.checkboxRow} onPress={() => update('acceptedTerms', !form.acceptedTerms)}>
              <View style={[s.checkbox, form.acceptedTerms && s.checkboxChecked]}>
                {form.acceptedTerms && <Text style={s.checkboxMark}>✓</Text>}
              </View>
              <Text style={s.checkboxLabel}>Acepto los términos y la política de privacidad</Text>
            </TouchableOpacity>
            {errors.acceptedTerms && <Text style={s.error}>{errors.acceptedTerms}</Text>}
          </View>
        )}

        {/* Step 2: OTP */}
        {step === 2 && (
          <OtpStep
            email={form.email} code={otpCode} error={errors.otp}
            resendIn={resendIn} onCodeChange={v => { setOtpCode(v.replace(/\D/g, '').slice(0, OTP_LENGTH)); setErrors(p => ({ ...p, otp: undefined })) }}
            onResend={handleResendOtp} s={s} t={t}
          />
        )}

        {errors.general && <Text style={s.error}>{errors.general}</Text>}

        <TouchableOpacity
          style={[s.btn, loading && s.btnDisabled]}
          onPress={handleNext} disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>{step === 2 ? 'Verificar y entrar' : 'Siguiente'}</Text>
          }
        </TouchableOpacity>

        {step === 1 && (
          <TouchableOpacity style={s.link} onPress={() => router.push('/auth/login')}>
            <Text style={s.linkText}>¿Ya tenés cuenta? Ingresá</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function OtpStep({
  email, code, error, resendIn, onCodeChange, onResend, s, t,
}: {
  email: string; code: string; error?: string; resendIn: number
  onCodeChange: (v: string) => void; onResend: () => void; s: any; t: Theme
}) {
  return (
    <View>
      <Text style={s.title}>Verificá tu email</Text>
      <Text style={s.subtitle}>
        Te enviamos un código de {OTP_LENGTH} dígitos a {'\n'}{email}.
      </Text>

      <TextInput
        style={s.otpSingleInput}
        value={code}
        onChangeText={onCodeChange}
        keyboardType="number-pad"
        maxLength={OTP_LENGTH}
        placeholder={'—'.repeat(OTP_LENGTH)}
        placeholderTextColor={t.textSoft}
        textAlign="center"
        autoFocus
      />

      <View style={s.otpDotsRow}>
        {Array.from({ length: OTP_LENGTH }).map((_, i) => (
          <View key={i} style={[s.otpDot, i < code.length && s.otpDotFilled]} />
        ))}
      </View>

      {error && <Text style={[s.error, { textAlign: 'center' }]}>{error}</Text>}

      <TouchableOpacity style={s.resendRow} onPress={onResend} disabled={resendIn > 0}>
        <Text style={[s.linkText, resendIn > 0 && { color: t.textMuted }]}>
          {resendIn > 0 ? `Reenviar en ${resendIn}s` : 'Reenviar código'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48 },
    logo: { width: 180, height: 150, alignSelf: 'center', marginBottom: 8 },
    title: { fontSize: 26, fontWeight: '700', color: t.text, marginBottom: 6 },
    subtitle: { fontSize: 14, color: t.textMuted, marginBottom: 24 },

    progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 40, marginBottom: 28 },
    progressItem: { alignItems: 'center' },
    progressCircle: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: t.card, borderWidth: 1, borderColor: t.border,
      alignItems: 'center', justifyContent: 'center', marginBottom: 6,
    },
    progressCircleActive: { borderColor: t.accent },
    progressCircleDone: { backgroundColor: t.accent, borderColor: t.accent },
    progressCircleText: { color: t.text, fontSize: 13, fontWeight: '600' },
    progressLabel: { color: t.textMuted, fontSize: 11 },
    progressLabelActive: { color: t.text, fontWeight: '600' },

    backLink: { marginBottom: 12 },
    backText: { color: t.accent, fontSize: 14 },

    input: {
      backgroundColor: t.card, color: t.text, borderRadius: 12,
      padding: 16, marginBottom: 8, fontSize: 16,
      borderWidth: 1, borderColor: t.border,
    },
    error: { color: t.danger, fontSize: 13, marginBottom: 8 },

    checkboxRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    checkbox: {
      width: 22, height: 22, borderRadius: 6, borderWidth: 1,
      borderColor: t.border, backgroundColor: t.card,
      alignItems: 'center', justifyContent: 'center', marginRight: 10,
    },
    checkboxChecked: { backgroundColor: t.accent, borderColor: t.accent },
    checkboxMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
    checkboxLabel: { color: t.text, fontSize: 13, flex: 1 },

    otpSingleInput: {
      backgroundColor: t.card, color: t.text, borderRadius: 16,
      borderWidth: 1.5, borderColor: t.accent,
      paddingVertical: 20, fontSize: 32, fontWeight: '800',
      letterSpacing: 12, marginBottom: 16, textAlign: 'center',
    },
    otpDotsRow: {
      flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8,
    },
    otpDot: {
      width: 10, height: 10, borderRadius: 5,
      backgroundColor: t.border,
    },
    otpDotFilled: { backgroundColor: t.accent },
    resendRow: { marginTop: 12, alignItems: 'center' },

    btn: { backgroundColor: t.accent, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    link: { marginTop: 20, alignItems: 'center' },
    linkText: { color: t.accent, fontSize: 14 },
  })
}
