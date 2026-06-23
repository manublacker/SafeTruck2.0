import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { confirmCheckout } from "@/services/api";
import type { AdminPage } from "./AdminSidebar";

interface Props {
  onNavigate: (page: AdminPage) => void;
  billingSuccess?: boolean;
}

// Descripción del plan activo (mismos límites que FleetView.PLAN_TRUCK_LIMITS).
const PLAN_DESC: Record<string, string> = {
  starter: "Tu suscripción está activa · hasta 5 camiones.",
  pro: "Tu suscripción está activa · hasta 20 camiones.",
  enterprise: "Tu suscripción está activa · camiones y conductores ilimitados.",
};

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
    <div style={{ padding: 24, height: "100%", background: "var(--c-bg)", overflowY: "auto" }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

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
          {(() => {
            const active = !!user?.plan;
            const planName = active ? `Plan ${user!.plan!.charAt(0).toUpperCase() + user!.plan!.slice(1)}` : "Sin plan activo";
            const planDesc = active ? (PLAN_DESC[user!.plan!] ?? "Tu suscripción está activa.") : "Elegí un plan para desbloquear todas las funciones.";
            return (
              <div
                style={{
                  background: active ? "var(--c-navy)" : "var(--c-bg)",
                  border: active ? "1px solid var(--c-navy)" : "1px solid var(--c-border)",
                  borderRadius: "var(--r-lg)",
                  padding: "20px 22px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 6px" }}>
                    <p style={{ margin: 0, fontWeight: 700, color: active ? "#fff" : "var(--c-ink)", fontSize: "1.05rem" }}>
                      {planName}
                    </p>
                    {active ? (
                      <span
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          fontSize: "0.75rem", fontWeight: 700, color: "#4ade80",
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
                        Activo
                      </span>
                    ) : (
                      <span className="st-badge st-badge-inactivo">Sin plan</span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: active ? "rgba(255,255,255,0.72)" : "var(--c-ink-2)" }}>
                    {planDesc}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {!active && (
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
                    {active ? "Cambiar plan" : "Ver planes"}
                  </button>
                </div>
              </div>
            );
          })()}
          {verifyMsg && (
            <p style={{ margin: "10px 2px 0", fontSize: "0.82rem", color: "var(--c-danger)", fontWeight: 600 }}>
              {verifyMsg}
            </p>
          )}
        </section>

      </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="st-section-label" style={{ display: "block", margin: "0 0 10px" }}>
      {children}
    </h3>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--c-bg)", border: "1px solid var(--c-border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
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
      borderBottom: last ? "none" : "1px solid var(--c-border)",
    }}>
      <span style={{ fontSize: "0.87rem", fontWeight: 600, color: "var(--c-ink-2)" }}>{label}</span>
      <span style={{ fontSize: "0.9rem", color: "var(--c-ink)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
