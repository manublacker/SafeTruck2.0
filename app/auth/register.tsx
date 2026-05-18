import { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { supabase } from '../../src/services/supabase'
import {
  formatCuit,
  isValidCuit,
  isValidEmail,
  isValidPassword,
  resendSignupOtp,
  sanitizeOtpDigit,
  signUpWithEmail,
  upsertProfile,
  verifySignupOtp,
  MIN_PASSWORD_LENGTH,
  OTP_LENGTH,
} from '../../src/services/auth'
import {
  FLEET_SIZE_OPTIONS,
  INDUSTRY_OPTIONS,
  OTP_RESEND_COOLDOWN_SECONDS,
  PLAN_OPTIONS,
  REGISTER_STEPS,
  TOTAL_STEPS,
  type PlanOption,
} from '../../src/constants/register'
import type { SubscriptionPlan } from '../../src/types'

interface FormData {
  email: string
  password: string
  confirmPassword: string
  acceptedTerms: boolean
  companyName: string
  cuit: string
  rubro: string
  truckCount: string
}

const INITIAL_FORM: FormData = {
  email: '',
  password: '',
  confirmPassword: '',
  acceptedTerms: false,
  companyName: '',
  cuit: '',
  rubro: '',
  truckCount: '',
}

type FieldErrors = Partial<Record<keyof FormData | 'otp' | 'general', string>>

export default function RegisterScreen() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormData>(INITIAL_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [otpDigits, setOtpDigits] = useState<string[]>(() => Array(OTP_LENGTH).fill(''))
  const [resendIn, setResendIn] = useState(0)
  const [loading, setLoading] = useState(false)
  const setProfile = useStore(s => s.setProfile)
  const router = useRouter()

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn(value => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  const updateField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => ({ ...prev, [key]: undefined }))
  }

  const validateStep1 = (): boolean => {
    const next: FieldErrors = {}
    if (!isValidEmail(form.email)) next.email = 'Email inválido'
    if (!isValidPassword(form.password)) {
      next.password = `Mínimo ${MIN_PASSWORD_LENGTH} caracteres`
    }
    if (form.password !== form.confirmPassword) {
      next.confirmPassword = 'Las contraseñas no coinciden'
    }
    if (!form.acceptedTerms) next.acceptedTerms = 'Debés aceptar los términos'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const validateStep2 = (): boolean => {
    const next: FieldErrors = {}
    if (!form.companyName.trim()) next.companyName = 'Requerido'
    if (!isValidCuit(form.cuit)) next.cuit = 'Formato XX-XXXXXXXX-X'
    if (!form.rubro) next.rubro = 'Requerido'
    if (!form.truckCount) next.truckCount = 'Requerido'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submitSignUp = async (): Promise<boolean> => {
    setLoading(true)
    try {
      await signUpWithEmail({
        email: form.email,
        password: form.password,
        fullName: form.companyName,
      })
      setResendIn(OTP_RESEND_COOLDOWN_SECONDS)
      return true
    } catch (e: any) {
      setErrors({ general: e.message ?? 'Error al crear la cuenta' })
      return false
    } finally {
      setLoading(false)
    }
  }

  const submitOtp = async (): Promise<boolean> => {
    const code = otpDigits.join('')
    if (code.length < OTP_LENGTH) {
      setErrors({ otp: `Ingresá los ${OTP_LENGTH} dígitos` })
      return false
    }
    setLoading(true)
    try {
      await verifySignupOtp(form.email, code)
      return true
    } catch (e: any) {
      setErrors({ otp: e.message ?? 'Código inválido' })
      return false
    } finally {
      setLoading(false)
    }
  }

  const goNext = async () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2) {
      if (!validateStep2()) return
      if (!(await submitSignUp())) return
    }
    if (step === 3 && !(await submitOtp())) return
    setStep(prev => Math.min(prev + 1, TOTAL_STEPS))
  }

  const goBack = () => {
    setErrors({})
    setStep(prev => Math.max(prev - 1, 1))
  }

  const handleResendOtp = async () => {
    if (resendIn > 0) return
    try {
      await resendSignupOtp(form.email)
      setResendIn(OTP_RESEND_COOLDOWN_SECONDS)
    } catch (e: any) {
      setErrors({ otp: e.message ?? 'No se pudo reenviar' })
    }
  }

  const handleChoosePlan = async (plan: SubscriptionPlan) => {
    setLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getUser()
      const userId = sessionData.user?.id
      if (!userId) throw new Error('Sesión no encontrada. Volvé a verificar tu email.')

      await upsertProfile({
        userId,
        fullName: form.companyName,
        companyName: form.companyName,
        cuit: form.cuit,
        plan,
      })

      const { data: profile } = await supabase
        .from('st_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (profile) setProfile(profile)
      router.replace('/(tabs)/')
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'No se pudo guardar el plan')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Image
          source={require('../../camion_padding.png')}
          style={s.logo}
          resizeMode="contain"
        />

        <ProgressBar step={step} />

        {step > 1 && step < TOTAL_STEPS && (
          <TouchableOpacity style={s.backLink} onPress={goBack}>
            <Text style={s.backText}>← Volver</Text>
          </TouchableOpacity>
        )}

        {step === 1 && (
          <StepAccess form={form} errors={errors} onChange={updateField} />
        )}
        {step === 2 && (
          <StepCompany form={form} errors={errors} onChange={updateField} />
        )}
        {step === 3 && (
          <StepVerification
            email={form.email}
            digits={otpDigits}
            error={errors.otp}
            resendIn={resendIn}
            onDigitsChange={setOtpDigits}
            onResend={handleResendOtp}
          />
        )}
        {step === 4 && <StepPlan onChoose={handleChoosePlan} loading={loading} />}

        {errors.general && <Text style={s.error}>{errors.general}</Text>}

        {step < TOTAL_STEPS && (
          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={goNext}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.btnText}>{step === 3 ? 'Verificar código' : 'Siguiente'}</Text>
            )}
          </TouchableOpacity>
        )}

        {step === 1 && (
          <TouchableOpacity style={s.link} onPress={() => router.push('/auth/login')}>
            <Text style={s.linkText}>¿Ya tenés cuenta? Ingresá</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function ProgressBar({ step }: { step: number }) {
  return (
    <View style={s.progressRow}>
      {REGISTER_STEPS.map((label, index) => {
        const stepNumber = index + 1
        const done = stepNumber < step
        const active = stepNumber === step
        return (
          <View key={label} style={s.progressItem}>
            <View
              style={[
                s.progressCircle,
                done && s.progressCircleDone,
                active && s.progressCircleActive,
              ]}
            >
              <Text style={s.progressCircleText}>{done ? '✓' : stepNumber}</Text>
            </View>
            <Text style={[s.progressLabel, active && s.progressLabelActive]}>{label}</Text>
          </View>
        )
      })}
    </View>
  )
}

interface StepFieldProps {
  form: FormData
  errors: FieldErrors
  onChange: <K extends keyof FormData>(key: K, value: FormData[K]) => void
}

function StepAccess({ form, errors, onChange }: StepFieldProps) {
  return (
    <View>
      <Text style={s.title}>Creá tu cuenta</Text>
      <Text style={s.subtitle}>Ingresá los datos para acceder a SafeTruck.</Text>

      <TextInput
        style={s.input}
        placeholder="empresa@mail.com"
        placeholderTextColor="#8E8E93"
        value={form.email}
        onChangeText={value => onChange('email', value)}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {errors.email && <Text style={s.error}>{errors.email}</Text>}

      <TextInput
        style={s.input}
        placeholder="Contraseña"
        placeholderTextColor="#8E8E93"
        value={form.password}
        onChangeText={value => onChange('password', value)}
        secureTextEntry
      />
      {errors.password && <Text style={s.error}>{errors.password}</Text>}

      <TextInput
        style={s.input}
        placeholder="Repetí tu contraseña"
        placeholderTextColor="#8E8E93"
        value={form.confirmPassword}
        onChangeText={value => onChange('confirmPassword', value)}
        secureTextEntry
      />
      {errors.confirmPassword && <Text style={s.error}>{errors.confirmPassword}</Text>}

      <TouchableOpacity
        style={s.checkboxRow}
        onPress={() => onChange('acceptedTerms', !form.acceptedTerms)}
      >
        <View style={[s.checkbox, form.acceptedTerms && s.checkboxChecked]}>
          {form.acceptedTerms && <Text style={s.checkboxMark}>✓</Text>}
        </View>
        <Text style={s.checkboxLabel}>Acepto los términos y la política de privacidad</Text>
      </TouchableOpacity>
      {errors.acceptedTerms && <Text style={s.error}>{errors.acceptedTerms}</Text>}
    </View>
  )
}

function StepCompany({ form, errors, onChange }: StepFieldProps) {
  return (
    <View>
      <Text style={s.title}>Tu empresa</Text>
      <Text style={s.subtitle}>Contanos sobre tu flota.</Text>

      <TextInput
        style={s.input}
        placeholder="Nombre de la empresa"
        placeholderTextColor="#8E8E93"
        value={form.companyName}
        onChangeText={value => onChange('companyName', value)}
      />
      {errors.companyName && <Text style={s.error}>{errors.companyName}</Text>}

      <TextInput
        style={s.input}
        placeholder="CUIT — XX-XXXXXXXX-X"
        placeholderTextColor="#8E8E93"
        value={form.cuit}
        onChangeText={value => onChange('cuit', formatCuit(value))}
        keyboardType="number-pad"
      />
      {errors.cuit && <Text style={s.error}>{errors.cuit}</Text>}

      <Text style={s.fieldLabel}>Rubro / tipo de carga</Text>
      <OptionChips
        options={INDUSTRY_OPTIONS}
        selected={form.rubro}
        onSelect={value => onChange('rubro', value)}
      />
      {errors.rubro && <Text style={s.error}>{errors.rubro}</Text>}

      <Text style={s.fieldLabel}>Cantidad de camiones</Text>
      <OptionChips
        options={FLEET_SIZE_OPTIONS}
        selected={form.truckCount}
        onSelect={value => onChange('truckCount', value)}
      />
      {errors.truckCount && <Text style={s.error}>{errors.truckCount}</Text>}
    </View>
  )
}

function OptionChips({
  options,
  selected,
  onSelect,
}: {
  options: readonly string[]
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <View style={s.chipsRow}>
      {options.map(option => {
        const active = option === selected
        return (
          <TouchableOpacity
            key={option}
            style={[s.chip, active && s.chipActive]}
            onPress={() => onSelect(option)}
          >
            <Text style={[s.chipText, active && s.chipTextActive]}>{option}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

function StepVerification({
  email,
  digits,
  error,
  resendIn,
  onDigitsChange,
  onResend,
}: {
  email: string
  digits: string[]
  error?: string
  resendIn: number
  onDigitsChange: (digits: string[]) => void
  onResend: () => void
}) {
  const inputRefs = useRef<Array<TextInput | null>>([])

  const handleChange = (index: number, raw: string) => {
    const digit = sanitizeOtpDigit(raw)
    const next = [...digits]
    next[index] = digit
    onDigitsChange(next)
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyPress = (index: number, key: string) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  return (
    <View>
      <Text style={s.title}>Verificá tu email</Text>
      <Text style={s.subtitle}>
        Te enviamos un código de {OTP_LENGTH} dígitos a {email || 'tu email'}.
      </Text>

      <View style={s.otpRow}>
        {digits.map((digit, index) => (
          <TextInput
            key={index}
            ref={ref => {
              inputRefs.current[index] = ref
            }}
            style={[s.otpInput, digit && s.otpInputFilled]}
            value={digit}
            onChangeText={raw => handleChange(index, raw)}
            onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={1}
            textAlign="center"
          />
        ))}
      </View>
      {error && <Text style={[s.error, s.errorCentered]}>{error}</Text>}

      <TouchableOpacity
        style={s.resendRow}
        onPress={onResend}
        disabled={resendIn > 0}
      >
        <Text style={[s.linkText, resendIn > 0 && s.resendDisabled]}>
          {resendIn > 0 ? `Reenviar en ${resendIn}s` : 'Reenviar código'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

function StepPlan({
  onChoose,
  loading,
}: {
  onChoose: (plan: SubscriptionPlan) => void
  loading: boolean
}) {
  return (
    <View>
      <Text style={[s.title, s.textCentered]}>Elegí tu plan</Text>
      <Text style={[s.subtitle, s.textCentered]}>Comenzá a trackear tu flota hoy.</Text>

      {PLAN_OPTIONS.map(plan => (
        <PlanCard key={plan.slug} plan={plan} loading={loading} onChoose={onChoose} />
      ))}
    </View>
  )
}

function PlanCard({
  plan,
  loading,
  onChoose,
}: {
  plan: PlanOption
  loading: boolean
  onChoose: (plan: SubscriptionPlan) => void
}) {
  return (
    <View style={[s.planCard, plan.highlighted && s.planCardHighlighted]}>
      {plan.highlighted && (
        <View style={s.planBadge}>
          <Text style={s.planBadgeText}>Más elegido</Text>
        </View>
      )}
      <Text style={s.planName}>{plan.name}</Text>
      <View style={s.planPriceRow}>
        <Text style={s.planPrice}>{plan.price}</Text>
        <Text style={s.planPeriod}>USD/mes</Text>
      </View>
      {plan.features.map(feature => (
        <Text key={feature} style={s.planFeature}>
          ✓ {feature}
        </Text>
      ))}
      <TouchableOpacity
        style={[s.btn, s.planBtn, loading && s.btnDisabled]}
        onPress={() => onChoose(plan.slug)}
        disabled={loading}
      >
        <Text style={s.btnText}>Elegir {plan.name}</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48 },
  logo: { width: 180, height: 150, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#8E8E93', marginBottom: 24 },
  textCentered: { textAlign: 'center' },

  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  progressItem: { flex: 1, alignItems: 'center' },
  progressCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2C2C2E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  progressCircleActive: { borderColor: '#FF6B35' },
  progressCircleDone: { backgroundColor: '#FF6B35', borderColor: '#FF6B35' },
  progressCircleText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  progressLabel: { color: '#8E8E93', fontSize: 11 },
  progressLabelActive: { color: '#fff', fontWeight: '600' },

  backLink: { marginBottom: 12 },
  backText: { color: '#FF6B35', fontSize: 14 },

  input: {
    backgroundColor: '#2C2C2E',
    color: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  fieldLabel: { color: '#8E8E93', fontSize: 13, marginTop: 12, marginBottom: 8 },
  error: { color: '#FF453A', fontSize: 13, marginBottom: 8 },
  errorCentered: { textAlign: 'center' },

  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3A3A3C',
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: { backgroundColor: '#FF6B35', borderColor: '#FF6B35' },
  checkboxMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checkboxLabel: { color: '#fff', fontSize: 13, flex: 1 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#2C2C2E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  chipActive: { backgroundColor: '#FF6B35', borderColor: '#FF6B35' },
  chipText: { color: '#8E8E93', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  otpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  otpInput: {
    width: 48,
    height: 56,
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A3C',
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  otpInputFilled: { borderColor: '#FF6B35' },
  resendRow: { marginTop: 12, alignItems: 'center' },
  resendDisabled: { color: '#8E8E93' },

  planCard: {
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A3A3C',
    padding: 20,
    marginBottom: 16,
  },
  planCardHighlighted: { borderColor: '#FF6B35' },
  planBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FF6B35',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  planBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  planName: { color: '#fff', fontSize: 20, fontWeight: '700' },
  planPriceRow: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 8 },
  planPrice: { color: '#fff', fontSize: 28, fontWeight: '700' },
  planPeriod: { color: '#8E8E93', fontSize: 13, marginLeft: 6, marginBottom: 4 },
  planFeature: { color: '#fff', fontSize: 13, marginBottom: 4 },
  planBtn: { marginTop: 12 },

  btn: { backgroundColor: '#FF6B35', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#FF6B35', fontSize: 14 },
})
