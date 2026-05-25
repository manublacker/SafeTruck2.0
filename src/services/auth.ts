import * as Linking from 'expo-linking'
import { supabase } from './supabase'
import type { SubscriptionPlan } from '../types'

/** Mínimo de caracteres exigido por Supabase Auth para una contraseña. */
export const MIN_PASSWORD_LENGTH = 8

/** Cantidad de dígitos del código OTP de verificación de email. */
export const OTP_LENGTH = 8

/** Path al que Supabase redirige tras un flujo de recuperación de contraseña. */
const RESET_PASSWORD_PATH = 'auth/reset-password'

/** Path al que Supabase redirige tras completar el OAuth de Google. */
const OAUTH_REDIRECT_PATH = 'auth/callback'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Cantidad de dígitos numéricos que componen un CUIT argentino. */
const CUIT_DIGIT_COUNT = 11

const CUIT_REGEX = /^\d{2}-\d{8}-\d{1}$/

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim())
}

export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
}

export function isValidCuit(cuit: string): boolean {
  return CUIT_REGEX.test(cuit)
}

/**
 * Aplica la máscara XX-XXXXXXXX-X a medida que el usuario tipea.
 * Descarta cualquier carácter no numérico y trunca al largo válido de CUIT.
 */
export function formatCuit(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, CUIT_DIGIT_COUNT)
  if (digits.length <= 2) return digits
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2)}`
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
}

/** Deja solo el último dígito numérico tipeado, para inputs OTP de un carácter. */
export function sanitizeOtpDigit(raw: string): string {
  return raw.replace(/\D/g, '').slice(-1)
}

export interface SignUpParams {
  email: string
  password: string
  fullName: string
}

/**
 * Inicia el registro. Supabase envía un código OTP de 6 dígitos al email
 * cuando la confirmación está habilitada en el proyecto.
 */
export async function signUpWithEmail(params: SignUpParams): Promise<void> {
  const { error } = await supabase.auth.signUp({
    email: params.email.trim(),
    password: params.password,
    options: { data: { full_name: params.fullName } },
  })
  if (error) throw new Error(error.message)
}

/**
 * Verifica el código OTP de registro. Devuelve el id del usuario autenticado,
 * necesario para crear su fila en `st_profiles`.
 */
export async function verifySignupOtp(email: string, code: string): Promise<string> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code,
    type: 'signup',
  })
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('No se pudo verificar el código.')
  return data.user.id
}

/** Reenvía el código OTP de confirmación de registro. */
export async function resendSignupOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
  if (error) throw new Error(error.message)
}

/** Envía el email con el link de recuperación de contraseña. */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: Linking.createURL(RESET_PASSWORD_PATH),
  })
  if (error) throw new Error(error.message)
}

/** Actualiza la contraseña del usuario con sesión activa (post-recovery). */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}

/**
 * Lanza el OAuth de Google. Sin `expo-web-browser` en el proyecto, se abre el
 * navegador del sistema con `skipBrowserRedirect`; la sesión vuelve a la app
 * vía deep link (scheme `safetruck`). Ver deuda técnica.
 */
export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: Linking.createURL(OAUTH_REDIRECT_PATH),
      skipBrowserRedirect: true,
    },
  })
  if (error) throw new Error(error.message)
  if (!data.url) throw new Error('No se pudo iniciar el flujo de Google.')
  await Linking.openURL(data.url)
}

export interface CreateProfileParams {
  userId: string
  fullName: string
  companyName: string
  cuit: string
  plan: SubscriptionPlan
  fleetSize: string
}

/** Crea (o reemplaza) la fila del usuario en `st_profiles` al cerrar el registro. */
export async function upsertProfile(params: CreateProfileParams): Promise<void> {
  const { error } = await supabase.from('st_profiles').upsert({
    id: params.userId,
    full_name: params.fullName,
    company_name: params.companyName,
    cuit: params.cuit,
    plan: params.plan,
    fleet_size: params.fleetSize,
  })
  if (error) throw new Error(error.message)
}
