import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login as apiLogin, forgotPassword } from "@/services/authApi";
import safeTruckLogo from "@/assets/logo_safetruck.png";
import { useAuth } from "@/contexts/AuthContext";


const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: typeof errors = {};
    if (!email.trim()) newErrors.email = "El email es requerido";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = "Email inválido";
    if (!password) newErrors.password = "La contraseña es requerida";
    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) {
      try {
        const res = await apiLogin({ email, password });
        login(res.token, res.user);
        if (remember) localStorage.setItem("safetruck_last_email", email);
        else localStorage.removeItem("safetruck_last_email");
        navigate("/dashboard");
      } catch (err) {
        setErrors({ email: err instanceof Error ? err.message : "Error al iniciar sesión." });
      }
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setErrors({ email: "Ingresá tu email" }); return; }
    setForgotLoading(true);
    try {
      await forgotPassword(email);
      setForgotSent(true);
    } catch (err) {
      setErrors({ email: err instanceof Error ? err.message : "Error al enviar el email." });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="auth-page tw-page">
      <Link to="/" className="auth-back-home">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Inicio
      </Link>
      <main className="auth-main">
        <Link to="/" className="auth-logo">
          <img src={safeTruckLogo} alt="Safe Truck" className="auth-logo__img" />
        </Link>

        <div className="auth-card">
          <div className="auth-card__inner">
            {forgotMode ? (
              forgotSent ? (
                <>
                  <h1 className="auth-title">Revisá tu email</h1>
                  <p className="auth-subtitle">
                    Te enviamos un link para restablecer tu contraseña a{" "}
                    <strong>{email}</strong>.
                  </p>
                  <button
                    type="button"
                    className="auth-btn"
                    onClick={() => { setForgotMode(false); setForgotSent(false); }}
                  >
                    Volver al login
                  </button>
                </>
              ) : (
                <>
                  <button className="auth-back" onClick={() => setForgotMode(false)}>
                    ← Volver al login
                  </button>
                  <h1 className="auth-title">Restablecer contraseña</h1>
                  <p className="auth-subtitle">Ingresá tu email y te enviamos un link.</p>
                  <form onSubmit={handleForgot} className="auth-fields" noValidate>
                    <div className="auth-field">
                      <label className="auth-field__label">Email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="empresa@mail.com"
                        maxLength={255}
                        className="auth-input"
                      />
                      {errors.email && <p className="auth-error">{errors.email}</p>}
                    </div>
                    <button type="submit" className="auth-btn" disabled={forgotLoading}>
                      {forgotLoading ? "Enviando…" : "Enviar link"}
                    </button>
                  </form>
                </>
              )
            ) : (
              <>
            <h1 className="auth-title">Iniciá sesión</h1>
            <p className="auth-subtitle">Bienvenido de vuelta.</p>

            <form onSubmit={handleSubmit} className="auth-fields" noValidate>
              <div className="auth-field">
                <label className="auth-field__label">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="empresa@mail.com"
                  maxLength={255}
                  className="auth-input"
                />
                {errors.email && <p className="auth-error">{errors.email}</p>}
              </div>

              <div className="auth-field">
                <label className="auth-field__label">Contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tu contraseña"
                  maxLength={128}
                  className="auth-input"
                />
                {errors.password && <p className="auth-error">{errors.password}</p>}
              </div>

              <div className="auth-field" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <label className="auth-checkbox-label">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="auth-checkbox"
                  />
                  Recordarme
                </label>
                <button type="button" onClick={() => setForgotMode(true)} className="auth-link" style={{ fontSize: "0.875rem", background: "none", border: "none", cursor: "pointer", font: "inherit" }}>¿Olvidaste tu contraseña?</button>
              </div>

              <button type="submit" className="auth-btn" style={{ marginTop: "0.5rem" }}>
                Iniciar sesión
              </button>
            </form>

              </>
            )}
          </div>

          <p className="auth-footer-text" style={{ color: "#ffffff", fontSize: "1rem" }}>
            ¿No tenés cuenta?{" "}
            <Link to="/register" className="auth-link">Registrá tu empresa</Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default Login;
