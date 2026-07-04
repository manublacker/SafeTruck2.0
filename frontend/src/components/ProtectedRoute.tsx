import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Paywall from "@/components/Paywall";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, authReady, profileFetched, logout } = useAuth();

  if (!authReady) {
    return (
      <div className="font-sans min-h-screen bg-[#1C2B3A] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (user.role === "driver") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: "2.5rem", textAlign: "center", marginBottom: 16 }}>🚛</div>
          <h1 style={styles.title}>Esta plataforma es para empresas</h1>
          <p style={styles.body}>
            Tu cuenta es de conductor. Para ver tus viajes, recibir rutas o
            usar SafeTruck como camionero independiente con tu plan individual,
            usá la app móvil de SafeTruck.
          </p>
          <button onClick={() => void logout()} style={styles.btn}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  // Gate de suscripción: sin plan activo no se entra al panel (paywall).
  // - profileFetched: sólo bloqueamos si el perfil se leyó de verdad del backend
  //   (si falló la carga, plan queda null pero NO bloqueamos, para no dejar afuera
  //   a alguien que sí pagó cuando el backend está caído/lento).
  // - Excepción: si volvés de un checkout exitoso (?billing=success), dejamos
  //   montar el Dashboard para que confirme el pago y refresque el plan.
  const returningFromCheckout =
    new URLSearchParams(window.location.search).get("billing") === "success";
  if (profileFetched && !user.plan && !returningFromCheckout) {
    return <Paywall />;
  }

  return <>{children}</>;
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
    padding: "40px 32px",
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    textAlign: "center",
  },
  title: {
    fontSize: "1.4rem",
    fontWeight: 800,
    color: "#0d0d0d",
    margin: "0 0 12px",
  },
  body: {
    fontSize: "0.95rem",
    color: "#6b7280",
    lineHeight: 1.6,
    margin: "0 0 28px",
  },
  btn: {
    height: 44,
    borderRadius: 10,
    background: "#e53935",
    color: "#fff",
    border: "none",
    fontWeight: 700,
    fontSize: "0.95rem",
    cursor: "pointer",
    padding: "0 24px",
    fontFamily: "inherit",
  },
};
