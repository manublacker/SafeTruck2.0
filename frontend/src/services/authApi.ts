import { supabase } from "@/lib/supabase";
import type { AuthResponse, RegisterPayload, LoginPayload } from "@/types/auth";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Traduce los mensajes crudos (en inglés) de Supabase Auth a español, para no
 * mostrar texto técnico al usuario.
 */
export function authErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : "";
  const msg = raw.toLowerCase();
  if (msg.includes("invalid login credentials")) return "Email o contraseña incorrectos.";
  if (msg.includes("email not confirmed")) return "Tenés que confirmar tu email antes de ingresar.";
  if (msg.includes("user already registered")) return "Ya existe una cuenta con ese email.";
  if (msg.includes("auth session missing")) return "El enlace expiró o no es válido. Pedí uno nuevo.";
  if (msg.includes("token has expired") || msg.includes("otp_expired")) return "El código expiró. Pedí uno nuevo.";
  if (msg.includes("invalid") && msg.includes("token")) return "El código ingresado no es válido.";
  if (msg.includes("for security purposes") || msg.includes("rate limit") || msg.includes("too many"))
    return "Demasiados intentos. Esperá unos segundos y probá de nuevo.";
  if (msg.includes("failed to fetch") || msg.includes("network")) return "Sin conexión. Revisá tu internet y reintentá.";
  return raw || "Ocurrió un error. Intentá de nuevo.";
}

export async function fetchUserProfile(
  token: string,
  body: Record<string, unknown> = {},
): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/api/auth/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as AuthResponse;
}

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  const { data, error } = await supabase.auth.signUp({
    email: payload.email,
    password: payload.password,
    options: {
      data: { full_name: payload.full_name, company: payload.company ?? null },
    },
  });

  if (error) throw new Error(error.message);

  if (!data.session) {
    throw new VerificationNeededError();
  }

  return fetchUserProfile(data.session.access_token, {
    full_name: payload.full_name,
    company:   payload.company ?? null,
    trucks:    payload.trucks  ?? [],
  });
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email:    payload.email,
    password: payload.password,
  });

  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("Error al iniciar sesión.");

  return fetchUserProfile(data.session.access_token, {});
}

export async function forgotPassword(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: "https://safetruck20.vercel.app/auth/callback",
  });
  if (error) throw new Error(error.message);
}

export interface SignUpStartPayload {
  email: string;
  password: string;
  metadata?: Record<string, unknown>;
  emailRedirectTo?: string;
}

export async function signUpStart(payload: SignUpStartPayload): Promise<{ needsVerification: boolean; accessToken: string | null }> {
  const { data, error } = await supabase.auth.signUp({
    email: payload.email,
    password: payload.password,
    options: {
      data: payload.metadata ?? {},
      emailRedirectTo: payload.emailRedirectTo,
    },
  });

  if (error) {
    // Supabase crea el usuario en auth.users antes de que verifique el mail.
    // Si el usuario cerró la ventana sin verificar y vuelve a intentar
    // registrarse con el mismo email, recibe "User already registered".
    // En vez de bloquearlo, reenviamos el OTP para que pueda completar el flujo.
    if (error.message.toLowerCase().includes("already registered")) {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: payload.email,
        options: payload.emailRedirectTo ? { emailRedirectTo: payload.emailRedirectTo } : undefined,
      });
      if (resendError) throw new Error(resendError.message);
      return { needsVerification: true, accessToken: null };
    }
    throw new Error(error.message);
  }

  return { needsVerification: !data.session, accessToken: data.session?.access_token ?? null };
}

export async function resendSignupConfirmation(email: string, emailRedirectTo?: string): Promise<void> {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });
  if (error) throw new Error(error.message);
}

export async function signInWithGoogle(redirectTo: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw new Error(error.message);
}

export class VerificationNeededError extends Error {
  constructor() {
    super("¡Cuenta creada! Revisá tu email para activar tu cuenta y después iniciá sesión.");
    this.name = "VerificationNeededError";
  }
}
