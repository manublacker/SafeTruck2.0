import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import safeTruckLogo from "@/assets/logo_safetruck.png";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const BRAND_RED = "#f24437";

export default function Join() {
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";

  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [done, setDone]         = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [error, setError]       = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 6) {
      setError("Completá todos los campos (contraseña mínimo 6 caracteres).");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/invitations/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, email: email.trim(), password, full_name: name.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json().catch(() => ({} as { email?: string }));
      setRegisteredEmail(data.email ?? email.trim());
      setDone(true);
    } catch {
      // Un único mensaje simple para cualquier fallo (servidor o red).
      setError("Error al crear la cuenta. Intentá de nuevo.");
    } finally {
      setLoading(false);
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
            ) : done ? (
              // ── Registro exitoso ─────────────────────────────────────────
              <>
                <div style={{ fontSize: "2.75rem", marginBottom: "0.75rem" }}>🎉</div>
                <h1 className="auth-title">¡Ya estás dentro!</h1>
                <p className="auth-subtitle">
                  Tu cuenta fue creada y quedaste vinculado a tu empresa.
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
            ) : (
              // ── Formulario de registro ───────────────────────────────────
              <>
                <h1 className="auth-title">Registrate como conductor</h1>
                <p className="auth-subtitle">Completá tus datos para unirte a tu empresa.</p>

                <form onSubmit={handleSubmit} className="auth-fields" noValidate>
                  <div className="auth-field">
                    <label className="auth-field__label">Nombre completo</label>
                    <input
                      className="auth-input"
                      placeholder="Juan García"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
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
                      onChange={(e) => setEmail(e.target.value)}
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
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>

                  {error && <p className="auth-error">{error}</p>}

                  <button type="submit" className="auth-btn" style={primaryBtn} disabled={loading}>
                    {loading ? "Creando cuenta…" : "Crear cuenta"}
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
