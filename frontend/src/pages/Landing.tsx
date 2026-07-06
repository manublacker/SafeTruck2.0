import { useSyncExternalStore } from "react";
import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import Features from "@/components/landing/Features";
import Plans from "@/components/landing/Plans";
import About from "@/components/landing/About";
import Footer from "@/components/landing/Footer";
import LandingMobile from "@/pages/LandingMobile";

// Sólo en teléfonos reales (≤640px) mostramos el rediseño mobile-first; de ahí
// para arriba (tablets, ventana a media pantalla, desktop) va la landing web, que
// ya reflowea sola vía media queries (nav→hamburguesa en 900px, grids→1 columna
// en 768/640). Antes el corte estaba en 1024px y al achicar la ventana a la mitad
// saltaba al modo celular (hasta cambiaba el logo). Se renderiza solo uno (no
// ambos) para no duplicar ids de sección.
function useIsMobile(breakpoint = 640) {
  const query = `(max-width: ${breakpoint}px)`;
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const DesktopLanding = () => (
  <div id="top" className="tw-page font-sans min-h-screen bg-background">
    <Navbar />
    <Hero />
    <Features />
    <HowItWorks />
    <Plans />
    <About />
    <Footer />
  </div>
);

const Index = () => (useIsMobile() ? <LandingMobile /> : <DesktopLanding />);

export default Index;
