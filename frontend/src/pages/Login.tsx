import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login as apiLogin, signInWithGoogle, forgotPassword } from "@/services/authApi";
import safeTruckLogo from "@/assets/logo_safetruck.png";
import { useAuth } from "@/contexts/AuthContext";

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.806.54-1.8368.8595-3.0477.8595-2.344 0-4.3282-1.5832-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853"/>
    <path d="M3.964 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573C.3477 6.1731 0 7.5477 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z" fill="#FBBC05"/>
    <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z" fill="#EA4335"/>
  </svg>
);

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

  const handleGoogle = async () => {
    try {
      await signInWithGoogle(`${window.location.origin}/auth/callback`);
    } catch (err) {
      setErrors({ email: err instanceof Error ? err.message : "Error con Google." });
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

            <div className="auth-divider">o</div>

            <button type="button" onClick={handleGoogle} className="auth-google-btn">
              <GoogleIcon />
              Continuar con Google
            </button>
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
