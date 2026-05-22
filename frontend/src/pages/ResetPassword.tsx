import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import safeTruckLogo from "@/assets/logo_safetruck.png";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const e2: typeof errors = {};
    if (password.length < 8) e2.password = "Mínimo 8 caracteres";
    if (password !== confirm) e2.confirm = "Las contraseñas no coinciden";
    setErrors(e2);
    if (Object.keys(e2).length > 0) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 3000);
    } catch (err) {
      setErrors({ password: err instanceof Error ? err.message : "Error al actualizar la contraseña." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page tw-page">
      <main className="auth-main">
        <a href="/" className="auth-logo">
          <img src={safeTruckLogo} alt="Safe Truck" className="auth-logo__img" />
        </a>

        <div className="auth-card">
          <div className="auth-card__inner">
            {done ? (
              <>
                <h1 className="auth-title">¡Contraseña actualizada!</h1>
                <p className="auth-subtitle">Te redirigimos al login en unos segundos…</p>
              </>
            ) : (
              <>
                <h1 className="auth-title">Nueva contraseña</h1>
                <p className="auth-subtitle">Elegí una contraseña segura para tu cuenta.</p>

                <form onSubmit={handleSubmit} className="auth-fields" noValidate>
                  <div className="auth-field">
                    <label className="auth-field__label">Nueva contraseña</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      maxLength={128}
                      className="auth-input"
                    />
                    {errors.password && <p className="auth-error">{errors.password}</p>}
                  </div>
                  <div className="auth-field">
                    <label className="auth-field__label">Repetí la contraseña</label>
                    <input
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Repetí tu contraseña"
                      maxLength={128}
                      className="auth-input"
                    />
                    {errors.confirm && <p className="auth-error">{errors.confirm}</p>}
                  </div>
                  <button type="submit" className="auth-btn" disabled={loading}>
                    {loading ? "Guardando…" : "Guardar contraseña"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
