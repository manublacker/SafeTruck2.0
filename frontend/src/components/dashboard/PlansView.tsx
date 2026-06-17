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
    price: "$43.500",
    period: "ARS / mes",
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
    price: "$118.500",
    period: "ARS / mes",
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
    price: "$298.500",
    period: "ARS / mes",
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

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  active:     { label: "Activo",       cls: "st-badge-activo" },
  trialing:   { label: "Trial",        cls: "st-badge-activo" },
  past_due:   { label: "Pago vencido", cls: "st-badge-cancelado" },
  cancelled:  { label: "Cancelado",    cls: "st-badge-cancelado" },
  incomplete: { label: "Incompleto",   cls: "st-badge-pendiente" },
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
    <div style={{ padding: 24, height: "100%", background: "var(--c-bg)", overflowY: "auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <p className="st-section-eyebrow">Suscripción</p>
        <h2 className="st-section-title">
          {currentPlan ? "Cambiar plan" : "Elegir un plan"}
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: "0.9rem", color: "var(--c-ink-2)" }}>
          Elegí el plan que mejor se adapte al tamaño de tu operación.
        </p>
      </div>

      {/* Suscripción activa */}
      {!loading && currentPlan && status && (
        <div
          style={{
            background: "var(--c-surface)",
            border: "1px solid var(--c-border)",
            borderRadius: 14,
            padding: "14px 20px",
            marginBottom: 28,
            display: "flex",
            alignItems: "center",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <span className="st-section-label">Plan actual</span>
            <p style={{ margin: "3px 0 0", fontWeight: 600, fontSize: "0.95rem", color: "var(--c-ink)", textTransform: "capitalize" }}>
              {currentPlan}
            </p>
          </div>
          <div style={{ width: 1, height: 30, background: "var(--c-border)" }} />
          <div>
            <span className="st-section-label">Estado</span>
            <div style={{ marginTop: 5 }}>
              <span className={`st-badge ${status.cls}`}>{status.label}</span>
            </div>
          </div>
          {sub?.current_period_end && (
            <>
              <div style={{ width: 1, height: 30, background: "var(--c-border)" }} />
              <div>
                <span className="st-section-label">Próximo cobro</span>
                <p style={{ margin: "3px 0 0", fontWeight: 600, fontSize: "0.9rem", color: "var(--c-ink)" }}>
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
            background: "var(--c-danger-soft)",
            border: "1px solid var(--c-danger)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 24,
            color: "var(--c-accent-hover)",
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
          gap: 16,
          maxWidth: 960,
        }}
      >
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.slug;
          const isLoading = upgrading === plan.slug;
          const highlighted = isCurrent || !!plan.badge;

          return (
            <div
              key={plan.slug}
              style={{
                border: `1px solid ${highlighted ? "var(--c-accent)" : "var(--c-border)"}`,
                borderRadius: 14,
                background: "var(--c-bg)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {/* Badge "Plan actual" o "Más popular" */}
              {(isCurrent || plan.badge) && (
                <div
                  style={{
                    background: isCurrent ? "var(--c-accent)" : "var(--c-accent-soft)",
                    color: isCurrent ? "#fff" : "var(--c-accent)",
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    padding: "6px 0",
                    textAlign: "center",
                  }}
                >
                  {isCurrent ? "Plan actual" : plan.badge}
                </div>
              )}

              <div style={{ padding: 24, flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Nombre y precio */}
                <div>
                  <p style={{ margin: "0 0 10px", fontSize: "0.95rem", fontWeight: 600, color: "var(--c-ink)" }}>
                    {plan.name}
                  </p>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--c-ink)", lineHeight: 1, letterSpacing: "-0.02em" }}>
                      {plan.price}
                    </span>
                    <span style={{ fontSize: "0.8rem", color: "var(--c-ink-3)", fontWeight: 500 }}>
                      {plan.period}
                    </span>
                  </div>
                </div>

                {/* Separador */}
                <div style={{ borderTop: "1px solid var(--c-border)" }} />

                {/* Features */}
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ color: "var(--c-accent)", flexShrink: 0, fontWeight: 700, fontSize: "0.85rem", lineHeight: "1.5" }}>✓</span>
                      <span style={{ fontSize: "0.875rem", color: "var(--c-ink-2)", lineHeight: 1.45 }}>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* Botón */}
                <button
                  className={isCurrent ? "st-btn-secondary" : "st-btn-primary"}
                  onClick={() => !isCurrent && !isLoading && !upgrading && handleUpgrade(plan.slug)}
                  disabled={isCurrent || !!upgrading}
                  style={{ width: "100%", justifyContent: "center" }}
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
