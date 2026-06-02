import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchSubscription, startCheckout } from "@/services/api";
import { CheckCircle2 } from "lucide-react";

// ── Tipos ──────────────────────────────────────────────────────────────────

interface Subscription {
  plan: string;
  status: string;
  current_period_end: string | null;
  mp_payer_id?: string | null;
}

// ── Constantes de planes ───────────────────────────────────────────────────

const PLANS = [
  {
    slug: "starter",
    name: "Starter",
    price: "$29",
    color: "#6b7280",
    bg: "#f9fafb",
    border: "#e5e7eb",
    features: [
      "Hasta 5 camiones",
      "Tracking en tiempo real",
      "App mobile para choferes",
      "Historial 7 días",
      "Soporte por email",
    ],
  },
  {
    slug: "pro",
    name: "Pro",
    price: "$79",
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
    features: [
      "Hasta 20 camiones",
      "Todo lo de Starter",
      "Historial 30 días",
      "Alertas personalizadas",
      "Panel multi-usuario (3 admins)",
      "Soporte prioritario",
    ],
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    price: "$199",
    color: "#9333ea",
    bg: "#fdf4ff",
    border: "#e9d5ff",
    features: [
      "Camiones ilimitados",
      "Todo lo de Pro",
      "Historial 1 año",
      "API de integración",
      "Reportes avanzados",
      "Manager de cuenta dedicado",
      "SLA garantizado",
    ],
  },
];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active:     { label: "Activo",        color: "#16a34a" },
  trialing:   { label: "Trial",         color: "#2563eb" },
  past_due:   { label: "Pago vencido",  color: "#dc2626" },
  cancelled:  { label: "Cancelado",     color: "#6b7280" },
  incomplete: { label: "Incompleto",    color: "#f59e0b" },
};

// ── Componente principal ───────────────────────────────────────────────────

export default function AccountView() {
  const { user } = useAuth();
  const [sub, setSub]             = useState<Subscription | null>(null);
  const [loading, setLoading]     = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    fetchSubscription()
      .then(setSub)
      .catch(() => setSub(null))
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(plan: string) {
    setError(null);
    setUpgrading(plan);
    try {
      const url = await startCheckout(plan);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar el pago.");
      setUpgrading(null);
    }
  }

  const currentPlan = sub?.plan ?? user?.plan ?? null;
  const status      = sub ? (STATUS_LABEL[sub.status] ?? STATUS_LABEL.incomplete) : null;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div className="st-section-eyebrow">Configuración</div>
        <h2 className="st-section-title">Mi cuenta</h2>
      </div>

      {/* Card: suscripción actual */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #f0f0f0",
          borderRadius: 16,
          padding: 24,
          marginBottom: 32,
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 800 }}>
          Suscripción actual
        </h3>

        {loading ? (
          <p style={{ color: "#9ca3af", fontSize: "0.9rem" }}>Cargando…</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start" }}>

            {/* Plan activo */}
            <div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 600, marginBottom: 6 }}>
                PLAN
              </div>
              {currentPlan ? (
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 14px",
                    borderRadius: 999,
                    fontSize: "0.9rem",
                    fontWeight: 700,
                    background: PLANS.find(p => p.slug === currentPlan)?.bg ?? "#f0f0f0",
                    color:      PLANS.find(p => p.slug === currentPlan)?.color ?? "#6b7280",
                    border:     `1px solid ${PLANS.find(p => p.slug === currentPlan)?.border ?? "#e5e7eb"}`,
                    textTransform: "capitalize",
                  }}
                >
                  {currentPlan}
                </span>
              ) : (
                <span style={{ color: "#9ca3af", fontSize: "0.9rem" }}>Sin plan activo</span>
              )}
            </div>

            {/* Estado */}
            {status && (
              <div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 600, marginBottom: 6 }}>
                  ESTADO
                </div>
                <span style={{ color: status.color, fontWeight: 700, fontSize: "0.9rem" }}>
                  ● {status.label}
                </span>
              </div>
            )}

            {/* Próximo cobro */}
            {sub?.current_period_end && (
              <div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 600, marginBottom: 6 }}>
                  PRÓXIMO COBRO
                </div>
                <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                  {new Date(sub.current_period_end).toLocaleDateString("es-AR", {
                    day: "numeric", month: "long", year: "numeric",
                  })}
                </span>
              </div>
            )}

            {/* Email de cuenta */}
            <div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 600, marginBottom: 6 }}>
                CUENTA
              </div>
              <span style={{ fontSize: "0.9rem", color: "#374151" }}>{user?.email}</span>
            </div>

          </div>
        )}

        {!loading && !currentPlan && (
          <p style={{ margin: "16px 0 0", fontSize: "0.85rem", color: "#6b7280" }}>
            No tenés un plan activo. Elegí uno abajo para comenzar.
          </p>
        )}
      </div>

      {/* Planes */}
      <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 800 }}>
        {currentPlan ? "Cambiar plan" : "Elegir plan"}
      </h3>

      {error && (
        <p style={{ color: "#dc2626", fontSize: "0.85rem", marginBottom: 16, fontWeight: 600 }}>
          {error}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        {PLANS.map((plan) => {
          const isCurrent  = currentPlan === plan.slug;
          const isLoading  = upgrading === plan.slug;
          const isUpgrade  = !isCurrent;

          return (
            <div
              key={plan.slug}
              style={{
                border: `2px solid ${isCurrent ? plan.color : plan.border}`,
                borderRadius: 16,
                padding: 20,
                background: isCurrent ? plan.bg : "#fff",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                position: "relative",
              }}
            >
              {isCurrent && (
                <span
                  style={{
                    position: "absolute",
                    top: -12,
                    left: 16,
                    background: plan.color,
                    color: "#fff",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    padding: "2px 10px",
                    borderRadius: 999,
                  }}
                >
                  Plan actual
                </span>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: "1rem", color: "#0d0d0d" }}>
                    {plan.name}
                  </p>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                    <span style={{ fontSize: "1.5rem", fontWeight: 800, color: plan.color }}>
                      {plan.price}
                    </span>
                    <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>USD/mes</span>
                  </div>
                </div>
              </div>

              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {plan.features.map((f) => (
                  <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "0.82rem", color: "#374151" }}>
                    <CheckCircle2 size={14} style={{ color: plan.color, flexShrink: 0, marginTop: 2 }} />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => isUpgrade && !isLoading ? handleUpgrade(plan.slug) : undefined}
                disabled={isCurrent || !!upgrading}
                style={{
                  marginTop: "auto",
                  padding: "10px 0",
                  borderRadius: 8,
                  border: `1.5px solid ${isCurrent ? plan.color : plan.color}`,
                  background: isCurrent ? "transparent" : plan.color,
                  color: isCurrent ? plan.color : "#fff",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  cursor: isCurrent ? "default" : upgrading ? "not-allowed" : "pointer",
                  opacity: upgrading && !isLoading ? 0.5 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                {isCurrent
                  ? "Plan actual"
                  : isLoading
                  ? "Redirigiendo…"
                  : "Cambiar a este plan"}
              </button>
            </div>
          );
        })}
      </div>

    </div>
  );
}
