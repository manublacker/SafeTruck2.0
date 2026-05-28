import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getToken } from "@/services/api";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

async function redeemCode(code: string): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("Sin sesión");
  const res = await fetch(`${BASE_URL}/api/invitations/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error ?? `HTTP ${res.status}`);
  }
}

export default function AuthCallback() {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteCode = params.get("invite");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const isRecovery = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";

  useEffect(() => {
    if (isRecovery) {
      navigate("/reset-password", { replace: true });
      return;
    }
    if (!authReady) return;

    if (!inviteCode) {
      // Flujo normal: ir al dashboard
      if (user) navigate("/dashboard", { replace: true });
      else navigate("/login", { replace: true });
      return;
    }

    // Flujo conductor: canjear la invitación
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }

    redeemCode(inviteCode)
      .then(() => setStatus("success"))
      .catch((err) => {
        // Si ya está canjeado, igual mostramos éxito
        const msg = err.message ?? "";
        if (msg.includes("vinculado") || msg.includes("canjeado")) {
          setStatus("success");
        } else {
          setErrorMsg(msg);
          setStatus("error");
        }
      });
  }, [user, authReady, inviteCode, isRecovery, navigate]);

  if (status === "success") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "3rem", textAlign: "center", marginBottom: 16 }}>🎉</div>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0d0d0d", margin: "0 0 12px", textAlign: "center" }}>
            ¡Listo!
          </h2>
          <p style={{ color: "#6b7280", fontSize: "0.95rem", lineHeight: 1.6, textAlign: "center" }}>
            Ya estás vinculado a tu empresa. Descargá la app <strong>SafeTruck</strong> e ingresá con tu email y contraseña para empezar a recibir viajes.
          </p>
          <div style={{
            marginTop: 20, padding: "14px 16px",
            background: "#f0fdf4", border: "1px solid #bbf7d0",
            borderRadius: 10, fontSize: "0.85rem", color: "#16a34a",
            fontWeight: 600, textAlign: "center",
          }}>
            Tu empresa ya puede asignarte viajes desde la plataforma web.
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "3rem", textAlign: "center", marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#0d0d0d", margin: "0 0 12px", textAlign: "center" }}>
            No se pudo completar el registro
          </h2>
          <p style={{ color: "#e53935", fontSize: "0.9rem", textAlign: "center" }}>{errorMsg}</p>
          <p style={{ color: "#6b7280", fontSize: "0.85rem", textAlign: "center", marginTop: 12 }}>
            Pedile a tu empresa un nuevo enlace de invitación.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...pageStyle, background: "#1c2b3a" }}>
      <div style={{ textAlign: "center", color: "#fff" }}>
        <div style={{
          width: 48, height: 48, border: "4px solid rgba(255,255,255,0.2)",
          borderTopColor: "#fff", borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          margin: "0 auto 16px",
        }} />
        <p style={{ fontFamily: "inherit" }}>
          {inviteCode ? "Vinculando tu cuenta…" : "Iniciando sesión…"}
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f5f5f5",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px",
  fontFamily: "'Inter', 'Manrope', system-ui, sans-serif",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 20,
  padding: "36px 32px",
  width: "100%",
  maxWidth: 420,
  boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
};
