import { CheckCircle2 } from "lucide-react";

type Plan = {
  name: string;
  slug: string;
  price: string;
  features: string[];
  highlighted?: boolean;
  /** El alta se hace desde la app móvil (camioneros independientes), no desde el registro web. */
  appOnly?: boolean;
};

const plans: Plan[] = [
  {
    name: "Individual",
    slug: "individual",
    price: "$14.900",
    appOnly: true,
    features: [
      "Para camioneros independientes",
      "1 camión propio",
      "Rutas aptas para tu vehículo",
      "Navegación y viajes personales",
      "Mantenimiento y alertas",
    ],
  },
  {
    name: "Starter",
    slug: "starter",
    price: "$43.500",
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
    price: "$118.500",
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
    price: "$298.500",
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
        {plans.map((p) => {
          const card = (
            <>
              {p.highlighted && (
                <span className="landing-plan-card__badge">Más elegido</span>
              )}
              {p.appOnly && (
                <span className="landing-plan-card__badge">Desde la app móvil</span>
              )}
              <p className="landing-plan-card__name">{p.name}</p>
              <div className="landing-plan-card__price-row">
                <span className="landing-plan-card__price">{p.price}</span>
                <span className="landing-plan-card__period">ARS/mes</span>
              </div>
              <ul className="landing-plan-card__features">
                {p.features.map((f) => (
                  <li key={f} className="landing-plan-card__feature">
                    <CheckCircle2 size={20} className="landing-plan-card__check" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </>
          );
          // El plan Individual se contrata desde la app (onboarding del
          // conductor); acá solo se muestra, sin link al registro de empresa.
          return p.appOnly ? (
            <div key={p.name} className="landing-plan-card landing-plan-card--static">{card}</div>
          ) : (
            <a
              key={p.name}
              href={`/register?plan=${p.slug}`}
              aria-label={`Elegir plan ${p.name}`}
              className={`landing-plan-card${p.highlighted ? " landing-plan-card--highlighted" : ""}`}
            >
              {card}
            </a>
          );
        })}
      </div>
    </div>
  </section>
);

export default Plans;
