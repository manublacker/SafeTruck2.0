import { Map, Smartphone, Bell, BarChart2, Users, Shield, type LucideIcon } from "lucide-react";

const features: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Map,        title: "Tracking en tiempo real",  desc: "Seguí cada camión en el mapa con actualización constante." },
  { icon: Smartphone, title: "App mobile para choferes", desc: "Tus choferes solo necesitan el celular. Simple, rápida y sin complicaciones." },
  { icon: Bell,       title: "Alertas inteligentes",     desc: "Recibí notificaciones por desvíos, paradas no programadas o exceso de velocidad." },
  { icon: BarChart2,  title: "Reportes exportables",     desc: "Descargá el historial de rutas y generá reportes para tu operación." },
  { icon: Users,      title: "Multi-usuario",            desc: "Agregá administradores y operadores con distintos niveles de acceso." },
  { icon: Shield,     title: "Datos seguros",            desc: "Tu información y la de tu flota protegidas con encriptación de extremo a extremo." },
];

const Features = () => (
  <section id="que-ofrecemos" className="landing-features">
    <div className="landing-section__inner">
      <header className="landing-section__header">
        <h2 className="landing-section__title">Todo lo que necesitás en un solo lugar</h2>
      </header>
      <div className="landing-features__grid">
        {features.map(({ icon: Icon, title, desc }) => (
          <article key={title} className="landing-feature-card">
            <Icon size={36} className="landing-feature-card__icon" />
            <h3 className="landing-feature-card__title">{title}</h3>
            <p className="landing-feature-card__desc">{desc}</p>
          </article>
        ))}
      </div>
    </div>
  </section>
);

export default Features;
