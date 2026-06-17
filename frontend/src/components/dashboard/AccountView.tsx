import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { confirmCheckout } from "@/services/api";
import type { AdminPage } from "./AdminSidebar";

interface Subscription {
  plan: string;
  status: string;
  current_period_end: string | null;
  mp_payer_id?: string | null;
}

interface Props {
  onNavigate: (page: AdminPage) => void;
  billingSuccess?: boolean;
}

interface UserMeta {
  full_name?: string;
  company?: string;
  cuit?: string;
  industry?: string;
  fleet_size?: string;
  country?: string;
  province?: string;
  email?: string;
}

export default function AccountView({ onNavigate, billingSuccess }: Props) {
  const { user, refreshPlan } = useAuth();
  const [meta, setMeta] = useState<UserMeta>({});
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  // Re-verifica el pago en MercadoPago y activa la suscripción si la encuentra.
  // Sirve para quienes pagaron pero el plan no quedó registrado (webhook perdido).
  async function handleVerifyPayment() {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const { confirmed } = await confirmCheckout(null);
      await refreshPlan();
      if (!confirmed) {
        setVerifyMsg("No encontramos un pago aprobado asociado a tu cuenta.");
      }
    } catch {
      setVerifyMsg("No se pudo verificar el pago. Intentá de nuevo en unos minutos.");
    } finally {
      setVerifying(false);
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.user_metadata) {
        setMeta(data.user.user_metadata as UserMeta);
      }
    });
  }, []);

  useEffect(() => {
    if (!billingSuccess) return;
    const timer = setTimeout(() => refreshPlan(), 3000);
    return () => clearTimeout(timer);
  }, [billingSuccess, refreshPlan]);

  return (
    <div style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>
      <div style={{ marginBottom: 24 }}>
        <p className="st-section-eyebrow">Configuración</p>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0d0d0d", margin: "4px 0 0" }}>
          Mi cuenta
        </h2>
      </div>

      <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Perfil */}
        <section>
          <SectionLabel>Perfil</SectionLabel>
          <Card>
            <Row label="Nombre completo" value={meta.full_name ?? user?.full_name ?? "—"} />
            <Row label="Email"           value={meta.email ?? user?.email ?? "—"} last />
          </Card>
        </section>

        {/* Empresa */}
        <section>
          <SectionLabel>Empresa</SectionLabel>
          <Card>
            <Row label="Razón social" value={meta.company ?? user?.company ?? "—"} />
            <Row label="CUIT"         value={meta.cuit      ?? "—"} />
            <Row label="Rubro"        value={meta.industry  ?? "—"} />
            <Row label="Tamaño flota" value={meta.fleet_size ?? "—"} />
            <Row label="País"         value={meta.country   ?? "—"} />
            <Row label="Provincia"    value={meta.province  ?? "—"} last />
          </Card>
        </section>

        {/* Suscripción */}
        <section>
          <SectionLabel>Suscripción</SectionLabel>
          <div
            style={{
              background: "#fafafa",
              border: "1px solid #f0f0f0",
              borderRadius: 14,
              padding: "18px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div>
              <p style={{ margin: "0 0 3px", fontWeight: 700, color: "#0d0d0d", fontSize: "0.95rem" }}>
                {user?.plan
                  ? `Plan ${user.plan.charAt(0).toUpperCase() + user.plan.slice(1)}`
                  : "Sin plan activo"}
              </p>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "#6b7280" }}>
                {user?.plan
                  ? "Tu suscripción está activa."
                  : "Elegí un plan para desbloquear todas las funciones."}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {!user?.plan && (
                <button
                  className="st-btn-secondary"
                  style={{ padding: "10px 20px", whiteSpace: "nowrap" }}
                  onClick={handleVerifyPayment}
                  disabled={verifying}
                >
                  {verifying ? "Verificando…" : "Ya pagué — verificar"}
                </button>
              )}
              <button
                className="st-btn-primary"
                style={{ padding: "10px 20px", whiteSpace: "nowrap" }}
                onClick={() => onNavigate("plans")}
              >
                {user?.plan ? "Cambiar plan" : "Ver planes"}
              </button>
            </div>
          </div>
          {verifyMsg && (
            <p style={{ margin: "10px 2px 0", fontSize: "0.82rem", color: "#dc2626", fontWeight: 600 }}>
              {verifyMsg}
            </p>
          )}
        </section>

      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: "0.72rem", fontWeight: 700, color: "#6b7280",
      letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px",
    }}>
      {children}
    </h3>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 14, overflow: "hidden" }}>
      {children}
    </div>
  );
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "14px 20px",
      borderBottom: last ? "none" : "1px solid #f0f0f0",
    }}>
      <span style={{ fontSize: "0.87rem", fontWeight: 600, color: "#6b7280" }}>{label}</span>
      <span style={{ fontSize: "0.9rem", color: "#0d0d0d", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
