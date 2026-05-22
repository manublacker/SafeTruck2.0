import { Building2, Truck, MapPin, type LucideIcon } from "lucide-react";

const steps: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Building2,
    title: "Registrá tu empresa",
    desc: "Creá tu cuenta, completá los datos de tu empresa y elegí el plan que mejor se adapta a tu flota.",
  },
  {
    icon: Truck,
    title: "Sumá tus camiones",
    desc: "Cargá tu flota en minutos. Asigná choferes a cada unidad desde tu panel de control web.",
  },
  {
    icon: MapPin,
    title: "Trackeá en tiempo real",
    desc: "Tus choferes usan la app mobile y vos ves todo desde el panel: posición, ruta e historial.",
  },
];

const HowItWorks = () => (
  <section id="como-funciona" className="landing-section landing-section--light">
    <div className="landing-section__inner landing-how-it-works">
      <header className="landing-section__header">
        <h2 className="landing-section__title">Tres pasos para empezar</h2>
        <p className="landing-section__subtitle">
          Sin complicaciones. En menos de 10 minutos tu flota está online.
        </p>
      </header>

      <div className="landing-how-it-works__grid">
        {steps.map(({ icon: Icon, title, desc }) => (
          <article key={title} className="landing-step-card">
            <Icon size={40} className="landing-step-card__icon" />
            <h3 className="landing-step-card__title">{title}</h3>
            <p className="landing-step-card__description">{desc}</p>
          </article>
        ))}
      </div>
    </div>
  </section>
);

export default HowItWorks;
