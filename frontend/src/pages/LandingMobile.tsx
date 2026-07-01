import { useState, type CSSProperties } from "react";
import {
  Map, Smartphone, Bell, BarChart2, Users, Shield,
  FileText, Truck, MapPin, CheckCircle2, Menu, X, type LucideIcon,
} from "lucide-react";
import heroTruck from "@/assets/hero-truck.png";

/**
 * Rediseño mobile-first de la landing (a partir del mockup de diseño).
 * Página de PRUEBA: reproduce fiel el mockup con los CTAs reales
 * (login → /login, registro → /register). Va en una rama para preview.
 */

const ACCENT = "#F0472B";
const INK = "#15212E";

const features: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Map,        title: "Tracking en tiempo real",  desc: "Seguí cada camión en el mapa con actualización constante." },
  { icon: Smartphone, title: "App mobile para choferes", desc: "Tus choferes solo necesitan el celular. Simple, rápida y sin complicaciones." },
  { icon: Bell,       title: "Alertas inteligentes",     desc: "Recibí notificaciones por desvíos, paradas no programadas o exceso de velocidad." },
  { icon: BarChart2,  title: "Reportes exportables",     desc: "Descargá el historial de rutas y generá reportes para tu operación." },
  { icon: Users,      title: "Multi-usuario",            desc: "Agregá administradores y operadores con distintos niveles de acceso." },
  { icon: Shield,     title: "Datos seguros",            desc: "Tu información y la de tu flota protegidas con encriptación de extremo a extremo." },
];

const steps: { n: string; icon: LucideIcon; title: string; desc: string }[] = [
  { n: "01", icon: FileText, title: "Registrá tu empresa",   desc: "Creá tu cuenta, completá los datos de tu empresa y elegí el plan que mejor se adapta a tu flota." },
  { n: "02", icon: Truck,    title: "Sumá tus camiones",     desc: "Cargá tu flota en minutos. Asigná choferes a cada unidad desde tu panel de control web." },
  { n: "03", icon: MapPin,   title: "Trackeá en tiempo real", desc: "Tus choferes usan la app mobile y vos ves todo desde el panel: posición, ruta e historial." },
];

const plans: { name: string; price: string; feats: string[]; cta: string; featured?: boolean }[] = [
  { name: "STARTER", price: "$43.500", cta: "Elegir Starter", feats: [
    "Hasta 5 camiones", "Tracking en tiempo real", "App mobile para choferes", "Historial 7 días", "Soporte por email",
  ] },
  { name: "PRO", price: "$118.500", cta: "Elegir Pro", featured: true, feats: [
    "Hasta 20 camiones", "Todo lo de Starter", "Historial 30 días", "Alertas personalizadas", "Panel multi-usuario (3 admins)", "Soporte prioritario",
  ] },
  { name: "ENTERPRISE", price: "$298.500", cta: "Contactar ventas", feats: [
    "Camiones ilimitados", "Todo lo de Pro", "Historial 1 año", "API de integración", "Reportes avanzados", "Manager de cuenta dedicado", "SLA garantizado",
  ] },
];

const navLinks = [
  { label: "Qué ofrecemos", href: "#que-ofrecemos" },
  { label: "Cómo funciona", href: "#como-funciona" },
  { label: "Planes",        href: "#planes" },
  { label: "Nosotros",      href: "#nosotros" },
];

const btnBase: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  height: 54, borderRadius: 30, fontWeight: 700, fontSize: 16, textDecoration: "none",
};

const card: CSSProperties = { background: "#fff", border: "1px solid #ECEEF1", borderRadius: 16, padding: "24px 22px" };

const cardTitle: CSSProperties = { margin: "16px 0 0", fontSize: 19, fontWeight: 700, color: INK };
const cardDesc: CSSProperties = { margin: "8px 0 0", fontSize: 15, lineHeight: 1.55, color: "#66727E" };
const secTitle: CSSProperties = { margin: 0, textAlign: "center", fontWeight: 800, fontSize: 34, lineHeight: 1.08, letterSpacing: "-0.025em", color: INK };
const secSub: CSSProperties = { margin: "6px 0 0", textAlign: "center", fontSize: 16, color: "#8A949E" };

function PlanFeat({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 15, color: "#3A4550" }}>
      <CheckCircle2 size={20} color={ACCENT} style={{ flexShrink: 0 }} />
      {text}
    </div>
  );
}

export default function LandingMobile() {
  const [menuOpen, setMenuOpen] = useState(false);
  // Plan seleccionado: al tocar una card se resalta como la elegida (PRO por defecto).
  const [selectedPlan, setSelectedPlan] = useState("PRO");

  return (
    <div style={{ width: "100%", maxWidth: 540, margin: "0 auto", overflowX: "hidden", position: "relative", fontFamily: "'Poppins', system-ui, sans-serif", color: INK, background: "#fff" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
        html { scroll-behavior: smooth; scroll-padding-top: 62px; }
        @keyframes stOverlayIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Header */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", height: 62, padding: "0 18px", background: "rgba(255,255,255,0.94)", backdropFilter: "blur(10px)", borderBottom: "1px solid #EEF0F2" }}>
        <a href="#top" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, background: ACCENT }}>
            <Truck size={22} color="#fff" />
          </span>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", color: INK }}>Safe Truck</span>
        </a>
        <button onClick={() => setMenuOpen(true)} aria-label="Abrir menú" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, border: "none", background: "transparent", cursor: "pointer", padding: 0 }}>
          <Menu size={26} color={INK} />
        </button>
      </header>

      {/* Drawer */}
      {menuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, maxWidth: 540, margin: "0 auto", background: "#fff", display: "flex", flexDirection: "column", padding: 18, animation: "stOverlayIn 0.18s ease" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 44, marginBottom: 18 }}>
            <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em" }}>Safe Truck</span>
            <button onClick={() => setMenuOpen(false)} aria-label="Cerrar menú" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, border: "none", background: "transparent", cursor: "pointer" }}>
              <X size={26} color={INK} />
            </button>
          </div>
          <nav style={{ display: "flex", flexDirection: "column" }}>
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} style={{ padding: "18px 6px", fontSize: 19, fontWeight: 600, borderBottom: "1px solid #F0F1F3", textDecoration: "none", color: INK }}>{l.label}</a>
            ))}
          </nav>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
            <a href="/login" onClick={() => setMenuOpen(false)} style={{ ...btnBase, border: "1.5px solid #D7DBDF", color: INK }}>Iniciar sesión</a>
            <a href="/register" onClick={() => setMenuOpen(false)} style={{ ...btnBase, background: ACCENT, color: "#fff" }}>Registrá tu empresa</a>
          </div>
        </div>
      )}

      {/* Hero */}
      <section id="top" style={{ position: "relative", minHeight: 600, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
        <img src={heroTruck} alt="Camión en ruta" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(180deg, rgba(8,17,26,0.18) 0%, rgba(8,17,26,0.30) 45%, rgba(8,17,26,0.62) 100%)" }} />
        <div style={{ position: "relative", zIndex: 2, padding: "0 22px 44px", width: "100%" }}>
          <h1 style={{ margin: 0, color: "#fff", fontWeight: 800, fontSize: 62, lineHeight: 0.95, letterSpacing: "-0.03em" }}>Seguro.<br />Confiable.</h1>
          <p style={{ margin: "20px 0 0", color: "rgba(255,255,255,0.92)", fontSize: 16, lineHeight: 1.6, maxWidth: 420 }}>
            Registrá tu empresa, sumá tu flota, trackeá cada camión en tiempo real y proveé a tus choferes un GPS inteligente con las rutas habilitadas para camiones.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
            <a href="#planes" style={{ ...btnBase, background: "#fff", color: INK }}>Ver planes</a>
            <a href="/register" style={{ ...btnBase, background: ACCENT, color: "#fff" }}>Registrá tu empresa</a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="que-ofrecemos" style={{ background: "#F6F7F8", padding: "56px 18px" }}>
        <h2 style={{ ...secTitle, marginBottom: 34 }}>Todo lo que necesitás en un solo lugar</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 16 }}>
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} style={card}>
              <Icon size={30} color={ACCENT} />
              <h3 style={cardTitle}>{title}</h3>
              <p style={cardDesc}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section id="como-funciona" style={{ background: "#fff", padding: "56px 18px" }}>
        <h2 style={secTitle}>Tres pasos para empezar</h2>
        <p style={{ ...secSub, marginBottom: 34 }}>Sin complicaciones. En menos de 10 minutos tu flota está online.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 16 }}>
          {steps.map(({ n, icon: Icon, title, desc }) => (
            <div key={n} style={{ ...card, padding: "26px 22px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: ACCENT, letterSpacing: "0.04em" }}>{n}</span>
                <Icon size={28} color={ACCENT} />
              </div>
              <h3 style={{ margin: "16px 0 0", fontSize: 20, fontWeight: 700, color: INK }}>{title}</h3>
              <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.6, color: "#66727E" }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plans */}
      <section id="planes" style={{ background: "#F6F7F8", padding: "56px 18px" }}>
        <h2 style={secTitle}>Planes para cada flota</h2>
        <p style={{ ...secSub, marginBottom: 32 }}>Sin contratos anuales. Cancelás cuando quieras.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {plans.map((p) => (
            <div key={p.name} onClick={() => setSelectedPlan(p.name)} style={{ background: "#fff", border: p.name === selectedPlan ? `2px solid ${ACCENT}` : "1px solid #ECEEF1", borderRadius: 18, padding: "28px 24px", position: "relative", cursor: "pointer", transition: "border-color .18s ease, box-shadow .18s ease", boxShadow: p.name === selectedPlan ? "0 18px 40px -22px rgba(240,71,43,0.55)" : "none" }}>
              {p.featured && (
                <span style={{ position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)", background: ACCENT, color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", padding: "6px 14px", borderRadius: 20 }}>MÁS ELEGIDO</span>
              )}
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", color: "#8A949E" }}>{p.name}</p>
              <p style={{ margin: "10px 0 0", fontWeight: 800, fontSize: 40, letterSpacing: "-0.03em", color: INK }}>{p.price}<span style={{ fontSize: 14, fontWeight: 600, color: "#9AA4AD" }}> ARS/mes</span></p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 22 }}>
                {p.feats.map((f) => <PlanFeat key={f} text={f} />)}
              </div>
              <a href="/register" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 50, marginTop: 24, borderRadius: 28, fontWeight: 700, fontSize: 15, textDecoration: "none", ...(p.name === selectedPlan ? { background: ACCENT, color: "#fff" } : { border: "1.5px solid #D7DBDF", color: INK }) }}>{p.cta}</a>
            </div>
          ))}
        </div>
      </section>

      {/* About */}
      <section id="nosotros" style={{ background: "#0E2233", padding: "56px 22px" }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", color: ACCENT }}>NUESTRA HISTORIA</p>
        <h2 style={{ margin: "14px 0 0", color: "#fff", fontWeight: 800, fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.03em" }}>Construido por gente del transporte</h2>
        <p style={{ margin: "18px 0 0", fontSize: 16, lineHeight: 1.65, color: "#B9C4CE" }}>
          Safe Truck nació de la necesidad real de las empresas de logística argentinas: saber dónde está cada camión, en todo momento, sin depender de llamadas ni mensajes. Somos un equipo apasionado por la tecnología y el transporte, comprometidos con hacer la gestión de flotas simple y accesible para empresas de todos los tamaños.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 30 }}>
          {[["500+", "Camiones trackeados"], ["80+", "Empresas activas"], ["99.9%", "Uptime garantizado"]].map(([n, l]) => (
            <div key={l} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 24 }}>
              <p style={{ margin: 0, fontSize: 42, fontWeight: 800, letterSpacing: "-0.03em", color: ACCENT }}>{n}</p>
              <p style={{ margin: "4px 0 0", fontSize: 15, color: "#AEB9C3" }}>{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: "#0A1620", padding: "48px 22px 36px", color: "#fff" }}>
        <p style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>Safe Truck</p>
        <p style={{ margin: "8px 0 0", fontSize: 15, color: "#8B97A2" }}>Gestión de flotas simple y poderosa.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px 16px", marginTop: 34 }}>
          {[
            { t: "Producto", l: [["Cómo funciona", "#como-funciona"], ["Planes", "#planes"], ["App mobile", "#que-ofrecemos"], ["API", "#top"]] },
            { t: "Empresa", l: [["Nosotros", "#nosotros"], ["Blog", "#top"], ["Prensa", "#top"], ["Contacto", "#top"]] },
            { t: "Legal", l: [["Términos", "#top"], ["Privacidad", "#top"], ["Cookies", "#top"]] },
          ].map((col) => (
            <div key={col.t}>
              <p style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>{col.t}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 14, color: "#8B97A2" }}>
                {col.l.map(([label, href]) => <a key={label} href={href} style={{ color: "#8B97A2", textDecoration: "none" }}>{label}</a>)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "34px 0 22px" }} />
        <p style={{ margin: 0, textAlign: "center", fontSize: 13, color: "#6B7884" }}>© 2025 Safe Truck. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}
