import type { MouseEvent } from "react";
import heroTruck from "@/assets/hero-truck.png";

const Hero = () => {
  const scrollToSection = (
    event: MouseEvent<HTMLAnchorElement>,
    targetId: string,
  ) => {
    const target = document.getElementById(targetId);
    if (!target) return;

    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", "#" + targetId);
  };

  return (
    <section className="landing-hero">
      <img
        src={heroTruck}
        alt="Camión negro con contenedor rojo en ruta"
        className="landing-hero__image"
      />
      <div className="landing-hero__overlay" />

      <div className="landing-hero__content">
        <div className="landing-hero__copy">
          <div className="landing-hero__title-group">
            <h1 className="landing-hero__title">Seguro.</h1>
            <h1 className="landing-hero__title landing-hero__title--strong">Confiable.</h1>
          </div>
          <p className="landing-hero__description">
            Registrá tu empresa, sumá tu flota, trackeá cada camión en tiempo real y proveé a tus choferes un GPS inteligente con las rutas habilitadas para camiones.
          </p>
          <div className="landing-hero__actions">
            <a
              href="#planes"
              onClick={(event) => scrollToSection(event, "planes")}
              className="landing-button landing-button--light"
            >
              Ver planes
            </a>
            <a href="/register" className="landing-button landing-button--primary">
              Registrá tu empresa
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
