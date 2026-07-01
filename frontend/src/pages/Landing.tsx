import { useSyncExternalStore } from "react";
import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import Features from "@/components/landing/Features";
import Plans from "@/components/landing/Plans";
import About from "@/components/landing/About";
import Footer from "@/components/landing/Footer";
import LandingMobile from "@/pages/LandingMobile";

// En celular y tablets (≤1024px) mostramos el rediseño mobile-first; en desktop,
// el diseño ancho de siempre. Se renderiza solo uno (no ambos) para no duplicar
// ids de sección. 1024 cubre iPad Mini/Air/Pro en vertical (el grid de planes del
// diseño ancho se apretaba y cortaba los precios en ese rango).
function useIsMobile(breakpoint = 1024) {
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
