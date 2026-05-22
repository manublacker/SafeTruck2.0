import { CheckCircle2 } from "lucide-react";

type Plan = {
  name: string;
  slug: string;
  price: string;
  features: string[];
  highlighted?: boolean;
};

const plans: Plan[] = [
  {
    name: "Starter",
    slug: "starter",
    price: "$29",
    features: [
      "Hasta 5 camiones",
      "Tracking en tiempo real",
      "App mobile para choferes",
      "Historial 7 días",
      "Soporte por email",
    ],
  },
  {
    name: "Pro",
    slug: "pro",
    price: "$79",
    features: [
      "Hasta 20 camiones",
      "Todo lo de Starter",
      "Historial 30 días",
      "Alertas personalizadas",
      "Panel multi-usuario (3 admins)",
      "Soporte prioritario",
    ],
    highlighted: true,
  },
  {
    name: "Enterprise",
    slug: "enterprise",
    price: "$199",
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

const Plans = () => (
  <section id="planes" className="landing-plans">
    <div className="landing-section__inner">
      <header className="landing-section__header">
        <h2 className="landing-section__title">Planes para cada flota</h2>
        <p className="landing-plans__subtitle">Sin contratos anuales. Cancelás cuando quieras.</p>
      </header>
      <div className="landing-plans__grid">
        {plans.map((p) => (
          <a
            key={p.name}
            href={`/register?plan=${p.slug}`}
            aria-label={`Elegir plan ${p.name}`}
            className={`landing-plan-card${p.highlighted ? " landing-plan-card--highlighted" : ""}`}
          >
            {p.highlighted && (
              <span className="landing-plan-card__badge">Más elegido</span>
            )}
            <p className="landing-plan-card__name">{p.name}</p>
            <div className="landing-plan-card__price-row">
              <span className="landing-plan-card__price">{p.price}</span>
              <span className="landing-plan-card__period">USD/mes</span>
            </div>
            <ul className="landing-plan-card__features">
              {p.features.map((f) => (
                <li key={f} className="landing-plan-card__feature">
                  <CheckCircle2 size={20} className="landing-plan-card__check" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </a>
        ))}
      </div>
    </div>
  </section>
);

export default Plans;
