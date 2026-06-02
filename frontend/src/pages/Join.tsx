import { useState } from "react";
import { useSearchParams } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL ?? "";

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setRegisteredEmail(data.email ?? email.trim());
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? "No se pudo crear la cuenta.");
    } finally {
      setLoading(false);
    }
  }

  if (!code) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: "#e53935", fontWeight: 700 }}>
            Link de invitación inválido.
          </p>
          <p style={{ color: "#6b7280", fontSize: "0.9rem", marginTop: 8 }}>
            Pedile a tu empresa un nuevo enlace.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: "2.5rem", marginBottom: 16, textAlign: "center" }}>🎉</div>
          <h2 style={styles.title}>¡Ya estás dentro!</h2>
          <p style={{ color: "#6b7280", fontSize: "0.95rem", lineHeight: 1.6 }}>
            Tu cuenta fue creada y ya estás vinculado a tu empresa.
          </p>

          <div style={{
            marginTop: 20, padding: "16px",
            background: "#f8fafc", border: "1px solid #e2e8f0",
            borderRadius: 12,
          }}>
            <p style={{ margin: "0 0 10px", fontSize: "0.78rem", fontWeight: 700, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Tus credenciales para la app
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>Email</span>
                <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#0d0d0d" }}>{registeredEmail}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>Contraseña</span>
                <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#0d0d0d" }}>La que acabás de crear</span>
              </div>
            </div>
          </div>

          <div style={{
            marginTop: 16, padding: "14px 16px",
            background: "#f0fdf4", border: "1px solid #bbf7d0",
            borderRadius: 10, fontSize: "0.88rem", color: "#16a34a", fontWeight: 600,
            textAlign: "center",
          }}>
            Descargá la app SafeTruck e ingresá con este email y tu contraseña para empezar a recibir viajes.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#e53935", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            SafeTruck
          </div>
          <h1 style={styles.title}>Registrate como conductor</h1>
          <p style={{ color: "#6b7280", fontSize: "0.9rem", marginTop: 4 }}>
            Completá tus datos para unirte a tu empresa.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={styles.label}>Nombre completo</label>
            <input
              style={styles.input}
              placeholder="Juan García"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label style={styles.label}>Email</label>
            <input
              style={styles.input}
              type="email"
              placeholder="juan@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={styles.label}>Contraseña</label>
            <input
              style={styles.input}
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p style={{ color: "#e53935", fontSize: "0.85rem", margin: 0 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              height: 48, borderRadius: 12, background: loading ? "#9ca3af" : "#e53935",
              color: "#fff", border: "none", fontWeight: 800, fontSize: "1rem",
              cursor: loading ? "not-allowed" : "pointer", marginTop: 4,
              fontFamily: "inherit", transition: "background 0.15s",
            }}
          >
            {loading ? "Creando cuenta…" : "Crear cuenta"}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: "0.8rem", color: "#9ca3af", textAlign: "center" }}>
          Al registrarte aceptás los términos y condiciones de SafeTruck.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    fontFamily: "'Inter', 'Manrope', system-ui, sans-serif",
  },
  card: {
    background: "#fff",
    borderRadius: 20,
    padding: "36px 32px",
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 800,
    color: "#0d0d0d",
    margin: "6px 0 0",
  },
  label: {
    display: "block",
    fontSize: "0.78rem",
    fontWeight: 700,
    color: "#0d0d0d",
    marginBottom: 6,
    letterSpacing: "0.01em",
  },
  input: {
    width: "100%",
    height: 44,
    border: "1.5px solid #e0e0e0",
    borderRadius: 10,
    background: "#fff",
    color: "#0d0d0d",
    fontSize: "0.95rem",
    padding: "0 14px",
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
};
