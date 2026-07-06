import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { authErrorMessage } from "@/services/authApi";
import safeTruckLogo from "@/assets/logo_safetruck.png";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const BRAND_RED = "#f24437";

type Step = "form" | "code" | "done";

export default function Join() {
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";

  const [step, setStep]         = useState<Step>("form");
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp]           = useState<string[]>(["", "", "", "", "", "", "", ""]);
  const [loading, setLoading]   = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [error, setError]       = useState("");
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // ── Paso 1: validar código + datos, y disparar el OTP de Supabase ──────────
  async function handleStartRegistration(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) {
      setError("Completá todos los campos (email válido y contraseña de mínimo 6 caracteres).");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // 1) Chequeamos el código ANTES de crear la cuenta, así no dejamos un
      //    usuario de auth colgado si la invitación es inválida/vencida.
      const check = await fetch(`${API_URL}/api/invitations/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!check.ok) {
        const d = await check.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Código de invitación inválido o vencido.");
      }

      // 2) signUp de Supabase: crea el usuario (sin confirmar) y le manda el
      //    código de verificación por email. Mismo mecanismo que el registro
      //    del empresario.
      const { data, error: signErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: name.trim(), role: "driver" } },
      });

      if (signErr) {
        // Si ya había empezado el registro y no verificó, reenviamos el código
        // en vez de bloquearlo.
        if (signErr.message.toLowerCase().includes("already registered")) {
          const { error: resendErr } = await supabase.auth.resend({ type: "signup", email: email.trim().toLowerCase() });
          if (resendErr) throw new Error(resendErr.message);
        } else {
          throw new Error(signErr.message);
        }
      }
      // Si el proyecto no requiere confirmación, signUp ya devuelve sesión; pero
      // con confirmación activada (nuestro caso) vamos siempre al paso del código.
      if (data?.session) {
        await finishRegistration(data.session.access_token);
        return;
      }

      setStep("code");
      setResendIn(60);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Paso 2: verificar el código y completar la vinculación en el backend ───
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    const token = otp.join("");
    if (token.length !== 8) {
      setError("Ingresá los 8 dígitos del código.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data, error: otpErr } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: "signup",
      });
      if (otpErr) throw new Error(otpErr.message);
      if (!data.session) throw new Error("No se pudo verificar el código.");

      await finishRegistration(data.session.access_token);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Con la sesión ya verificada, el backend crea/enlaza el driver y canjea la
  // invitación (mismo token que usa el registro del empresario para el perfil).
  async function finishRegistration(accessToken: string) {
    const res = await fetch(`${API_URL}/api/invitations/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ code, full_name: name.trim() }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error((d as { error?: string }).error ?? "No se pudo completar el registro.");
    }
    setRegisteredEmail(email.trim().toLowerCase());
    setStep("done");
  }

  async function handleResend() {
    setError("");
    try {
      const { error: resendErr } = await supabase.auth.resend({ type: "signup", email: email.trim().toLowerCase() });
      if (resendErr) throw new Error(resendErr.message);
      setResendIn(60);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  function handleOtpChange(i: number, v: string) {
    const digit = v.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[i] = digit;
    setOtp(next);
    setError("");
    if (digit && i < 7) {
      (document.getElementById(`join-code-${i + 1}`) as HTMLInputElement | null)?.focus();
    }
  }

  function handleOtpKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      (document.getElementById(`join-code-${i - 1}`) as HTMLInputElement | null)?.focus();
    }
  }

  const primaryBtn: React.CSSProperties = {
    background: loading ? "#9ca3af" : BRAND_RED,
    color: "#fff",
    border: "none",
    cursor: loading ? "not-allowed" : "pointer",
  };

  return (
    <div className="auth-page tw-page">
      <main className="auth-main">
        <div className="auth-logo">
          <img src={safeTruckLogo} alt="SafeTruck" className="auth-logo__img" />
        </div>

        <div className="auth-card">
          <div className="auth-card__inner">
            {!code ? (
              // ── Link sin código ──────────────────────────────────────────
              <>
                <h1 className="auth-title">Link inválido</h1>
                <p className="auth-subtitle">
                  Este enlace de invitación no es válido o está incompleto. Pedile a tu
                  empresa un enlace nuevo.
                </p>
              </>
            ) : step === "done" ? (
              // ── Registro exitoso ─────────────────────────────────────────
              <>
                <div style={{ fontSize: "2.75rem", marginBottom: "0.75rem" }}>🎉</div>
                <h1 className="auth-title">¡Ya estás dentro!</h1>
                <p className="auth-subtitle">
                  Verificamos tu email, tu cuenta fue creada y quedaste vinculado a tu empresa.
                </p>

                <div style={{ padding: "1rem", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.75rem" }}>
                  <p style={{ margin: "0 0 0.625rem", fontSize: "0.72rem", fontWeight: 700, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Tus credenciales para la app
                  </p>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.375rem" }}>
                    <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>Email</span>
                    <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1c2b3a" }}>{registeredEmail}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>Contraseña</span>
                    <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1c2b3a" }}>La que acabás de crear</span>
                  </div>
                </div>

                <div style={{ marginTop: "1rem", padding: "0.875rem 1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.625rem", fontSize: "0.88rem", color: "#b91c1c", fontWeight: 600, textAlign: "center", lineHeight: 1.5 }}>
                  Descargá la app SafeTruck e ingresá con este email y tu contraseña para empezar a recibir viajes.
                </div>
              </>
            ) : step === "code" ? (
              // ── Verificación por código ──────────────────────────────────
              <>
                <h1 className="auth-title">Verificá tu email</h1>
                <p className="auth-subtitle">
                  Te enviamos un código de 8 dígitos a <strong>{email}</strong>.
                </p>

                <div className="auth-mail-icon">📧</div>

                <form onSubmit={handleVerifyCode} noValidate>
                  <div className="auth-code-inputs">
                    {otp.map((c, i) => (
                      <input
                        key={i}
                        id={`join-code-${i}`}
                        inputMode="numeric"
                        maxLength={1}
                        value={c}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKey(i, e)}
                        className={[
                          "auth-code-input",
                          otp.every((d) => d) ? "auth-code-input--complete" : c ? "auth-code-input--filled" : "",
                        ].filter(Boolean).join(" ")}
                      />
                    ))}
                  </div>

                  {error && <p className="auth-error" style={{ textAlign: "center" }}>{error}</p>}

                  <button type="submit" className="auth-btn" style={primaryBtn} disabled={loading}>
                    {loading ? "Verificando…" : "Verificar código"}
                  </button>
                </form>

                <p className="auth-footer-text">
                  ¿No recibiste el código?{" "}
                  {resendIn > 0 ? (
                    <span>Reenviar en {resendIn}s</span>
                  ) : (
                    <button onClick={handleResend} className="auth-link" style={{ background: "none", border: "none", cursor: "pointer", font: "inherit" }}>
                      Reenviar
                    </button>
                  )}
                </p>
              </>
            ) : (
              // ── Formulario de registro ───────────────────────────────────
              <>
                <h1 className="auth-title">Registrate como conductor</h1>
                <p className="auth-subtitle">Completá tus datos para unirte a tu empresa.</p>

                <form onSubmit={handleStartRegistration} className="auth-fields" noValidate>
                  <div className="auth-field">
                    <label className="auth-field__label">Nombre completo</label>
                    <input
                      className="auth-input"
                      placeholder="Juan García"
                      value={name}
                      onChange={(e) => { setName(e.target.value); setError(""); }}
                      autoFocus
                      required
                    />
                  </div>
                  <div className="auth-field">
                    <label className="auth-field__label">Email</label>
                    <input
                      className="auth-input"
                      type="email"
                      placeholder="juan@email.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(""); }}
                      required
                    />
                  </div>
                  <div className="auth-field">
                    <label className="auth-field__label">Contraseña</label>
                    <input
                      className="auth-input"
                      type="password"
                      placeholder="Mínimo 6 caracteres"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      required
                    />
                  </div>

                  {error && <p className="auth-error">{error}</p>}

                  <button type="submit" className="auth-btn" style={primaryBtn} disabled={loading}>
                    {loading ? "Enviando código…" : "Crear cuenta"}
                  </button>
                </form>

                <p className="auth-footer-text">
                  Al registrarte aceptás los términos y condiciones de SafeTruck.
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
