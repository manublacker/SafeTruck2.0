import { useAuth } from "@/contexts/AuthContext";
import PlansView from "@/components/dashboard/PlansView";
import safeTruckLogo from "@/assets/logo_safetruck.png";

/**
 * Pantalla bloqueante para usuarios logueados SIN plan activo. Sólo les permite
 * elegir un plan (checkout de MercadoPago) o cerrar sesión — no pueden entrar al
 * mapa, la flota ni los viajes. Se muestra desde ProtectedRoute cuando el perfil
 * cargó de verdad y el plan es null (no por un fallo de red).
 */
export default function Paywall() {
  const { user, logout } = useAuth();

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg)", display: "flex", flexDirection: "column" }}>
      {/* Barra superior: logo + salir */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        <img src={safeTruckLogo} alt="SafeTruck" style={{ height: 32 }} />
        <button className="st-btn-secondary" onClick={() => void logout()}>
          Cerrar sesión
        </button>
      </header>

      {/* Encabezado */}
      <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%", padding: "32px 24px 0" }}>
        <div
          style={{
            background: "var(--c-surface-2)",
            border: "1px solid var(--c-border)",
            borderRadius: 14,
            padding: "20px 24px",
            marginBottom: 8,
          }}
        >
          <h1 style={{ margin: "0 0 6px", fontSize: "1.35rem", fontWeight: 800, color: "var(--c-ink)", letterSpacing: "-0.02em" }}>
            Activá un plan para empezar
          </h1>
          <p style={{ margin: 0, fontSize: "0.92rem", color: "var(--c-ink-2)", lineHeight: 1.5 }}>
            {user?.full_name ? `Hola ${user.full_name}. ` : ""}
            Tu cuenta no tiene un plan activo. Elegí uno para acceder al panel, cargar tu flota y empezar a operar.
          </p>
        </div>
      </div>

      {/* Planes (reusa la vista de precios + checkout) */}
      <div style={{ flex: 1 }}>
        <PlansView />
      </div>
    </div>
  );
}
