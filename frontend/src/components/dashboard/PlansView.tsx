import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchSubscription, startCheckout } from "@/services/api";

interface Subscription {
  plan: string;
  status: string;
  current_period_end: string | null;
}

const PLANS = [
  {
    slug: "starter",
    name: "Starter",
    price: "$29",
    period: "USD / mes",
    color: "#6b7280",
    accentBg: "#f3f4f6",
    border: "#e5e7eb",
    features: [
      "Hasta 5 camiones",
      "Tracking GPS en tiempo real",
      "App mobile para conductores",
      "Historial de viajes 7 días",
      "Soporte por email",
    ],
  },
  {
    slug: "pro",
    name: "Pro",
    price: "$79",
    period: "USD / mes",
    color: "#2563eb",
    accentBg: "#eff6ff",
    border: "#bfdbfe",
    badge: "Más popular",
    features: [
      "Hasta 20 camiones",
      "Todo lo de Starter",
      "Historial de viajes 30 días",
      "Alertas personalizadas",
      "Panel multi-usuario (3 admins)",
      "Soporte prioritario",
    ],
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    price: "$199",
    period: "USD / mes",
    color: "#9333ea",
    accentBg: "#fdf4ff",
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
  active:     { label: "Activo",       color: "#16a34a" },
  trialing:   { label: "Trial",        color: "#2563eb" },
  past_due:   { label: "Pago vencido", color: "#dc2626" },
  cancelled:  { label: "Cancelado",    color: "#6b7280" },
  incomplete: { label: "Incompleto",   color: "#f59e0b" },
};

export default function PlansView() {
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
  const status = sub ? (STATUS_LABEL[sub.status] ?? STATUS_LABEL.incomplete) : null;

  return (
    <div style={{ padding: 24, height: "100%", background: "#fff", overflowY: "auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <p className="st-section-eyebrow">Suscripción</p>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0d0d0d", margin: "4px 0 8px" }}>
          {currentPlan ? "Cambiar plan" : "Elegir un plan"}
        </h2>
        <p style={{ margin: 0, fontSize: "0.92rem", color: "#6b7280" }}>
          Elegí el plan que mejor se adapte al tamaño de tu operación.
        </p>
      </div>

      {/* Suscripción activa */}
      {!loading && currentPlan && status && (
        <div
          style={{
            background: "#fafafa",
            border: "1px solid #f0f0f0",
            borderRadius: 12,
            padding: "14px 20px",
            marginBottom: 32,
            display: "flex",
            alignItems: "center",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div>
            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Plan actual
            </span>
            <p style={{ margin: "2px 0 0", fontWeight: 800, fontSize: "0.95rem", color: "#0d0d0d", textTransform: "capitalize" }}>
              {currentPlan}
            </p>
          </div>
          <div style={{ width: 1, height: 32, background: "#e5e7eb" }} />
          <div>
            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Estado
            </span>
            <p style={{ margin: "2px 0 0", fontWeight: 700, color: status.color, fontSize: "0.9rem" }}>
              ● {status.label}
            </p>
          </div>
          {sub?.current_period_end && (
            <>
              <div style={{ width: 1, height: 32, background: "#e5e7eb" }} />
              <div>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Próximo cobro
                </span>
                <p style={{ margin: "2px 0 0", fontWeight: 600, fontSize: "0.9rem", color: "#0d0d0d" }}>
                  {new Date(sub.current_period_end).toLocaleDateString("es-AR", {
                    day: "numeric", month: "long", year: "numeric",
                  })}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.2)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 24,
            color: "#dc2626",
            fontWeight: 600,
            fontSize: "0.88rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Cards de planes */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 20,
          maxWidth: 960,
        }}
      >
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.slug;
          const isLoading = upgrading === plan.slug;

          return (
            <div
              key={plan.slug}
              style={{
                border: `2px solid ${isCurrent ? plan.color : plan.border}`,
                borderRadius: 18,
                background: isCurrent ? plan.accentBg : "#fff",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                position: "relative",
                transition: "box-shadow 0.15s ease",
              }}
            >
              {/* Badge "Plan actual" o "Más popular" */}
              {(isCurrent || plan.badge) && (
                <div
                  style={{
                    background: isCurrent ? plan.color : plan.color,
                    color: "#fff",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    padding: "6px 0",
                    textAlign: "center",
                  }}
                >
                  {isCurrent ? "Plan actual" : plan.badge}
                </div>
              )}

              <div style={{ padding: 28, flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Nombre y precio */}
                <div>
                  <p style={{ margin: "0 0 12px", fontSize: "1rem", fontWeight: 800, color: "#0d0d0d" }}>
                    {plan.name}
                  </p>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: "2.4rem", fontWeight: 900, color: plan.color, lineHeight: 1 }}>
                      {plan.price}
                    </span>
                    <span style={{ fontSize: "0.82rem", color: "#9ca3af", fontWeight: 500 }}>
                      {plan.period}
                    </span>
                  </div>
                </div>

                {/* Separador */}
                <div style={{ borderTop: "1px solid #f0f0f0" }} />

                {/* Features */}
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ color: plan.color, flexShrink: 0, fontWeight: 800, fontSize: "0.9rem", lineHeight: "1.4" }}>✓</span>
                      <span style={{ fontSize: "0.88rem", color: "#374151", lineHeight: 1.4 }}>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* Botón */}
                <button
                  onClick={() => !isCurrent && !isLoading && !upgrading && handleUpgrade(plan.slug)}
                  disabled={isCurrent || !!upgrading}
                  style={{
                    height: 48,
                    borderRadius: 12,
                    border: `2px solid ${plan.color}`,
                    background: isCurrent ? "transparent" : plan.color,
                    color: isCurrent ? plan.color : "#fff",
                    fontWeight: 800,
                    fontSize: "0.92rem",
                    cursor: isCurrent ? "default" : upgrading ? "not-allowed" : "pointer",
                    opacity: upgrading && !isLoading ? 0.5 : 1,
                    transition: "opacity 0.15s, background 0.15s",
                    fontFamily: "inherit",
                  }}
                >
                  {isCurrent
                    ? "Plan actual"
                    : isLoading
                    ? "Redirigiendo…"
                    : "Elegir este plan"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
