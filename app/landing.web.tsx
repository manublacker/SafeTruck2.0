import { useState } from 'react'
import { useRouter } from 'expo-router'
import { Map, Smartphone, Bell, BarChart2, Users, Shield, Building2, Truck, MapPin, CheckCircle2, Menu, X } from 'lucide-react'
import '../src/styles/landing.css'

const logoSrc: string = (require('../assets/logo_safetruck.png') as { uri: string }).uri
const heroSrc: string = (require('../assets/hero-truck.png') as { uri: string }).uri

const navLinks = [
  { label: 'Qué ofrecemos', targetId: 'que-ofrecemos' },
  { label: 'Cómo funciona', targetId: 'como-funciona' },
  { label: 'Planes', targetId: 'planes' },
  { label: 'Nosotros', targetId: 'nosotros' },
]

const features = [
  { icon: Map,        title: 'Tracking en tiempo real',  desc: 'Seguí cada camión en el mapa con actualización constante.' },
  { icon: Smartphone, title: 'App mobile para choferes', desc: 'Tus choferes solo necesitan el celular. Simple, rápida y sin complicaciones.' },
  { icon: Bell,       title: 'Alertas inteligentes',     desc: 'Recibí notificaciones por desvíos, paradas no programadas o exceso de velocidad.' },
  { icon: BarChart2,  title: 'Reportes exportables',     desc: 'Descargá el historial de rutas y generá reportes para tu operación.' },
  { icon: Users,      title: 'Multi-usuario',            desc: 'Agregá administradores y operadores con distintos niveles de acceso.' },
  { icon: Shield,     title: 'Datos seguros',            desc: 'Tu información y la de tu flota protegidas con encriptación de extremo a extremo.' },
]

const howItWorksSteps = [
  { icon: Building2, title: 'Registrá tu empresa',    desc: 'Creá tu cuenta, completá los datos de tu empresa y elegí el plan que mejor se adapta a tu flota.' },
  { icon: Truck,     title: 'Sumá tus camiones',      desc: 'Cargá tu flota en minutos. Asigná choferes a cada unidad desde tu panel de control web.' },
  { icon: MapPin,    title: 'Trackeá en tiempo real', desc: 'Tus choferes usan la app mobile y vos ves todo desde el panel: posición, ruta e historial.' },
]

const plans = [
  {
    name: 'Starter', slug: 'starter', price: '$29', highlighted: false,
    features: ['Hasta 5 camiones', 'Tracking en tiempo real', 'App mobile para choferes', 'Historial 7 días', 'Soporte por email'],
  },
  {
    name: 'Pro', slug: 'pro', price: '$79', highlighted: true,
    features: ['Hasta 20 camiones', 'Todo lo de Starter', 'Historial 30 días', 'Alertas personalizadas', 'Panel multi-usuario (3 admins)', 'Soporte prioritario'],
  },
  {
    name: 'Enterprise', slug: 'enterprise', price: '$199', highlighted: false,
    features: ['Camiones ilimitados', 'Todo lo de Pro', 'Historial 1 año', 'API de integración', 'Reportes avanzados', 'Manager de cuenta dedicado', 'SLA garantizado'],
  },
]

const aboutStats = [
  { num: '500+', label: 'Camiones trackeados' },
  { num: '80+',  label: 'Empresas activas' },
  { num: '99.9%', label: 'Uptime garantizado' },
]

const footerCols = [
  { title: 'Producto', links: ['Cómo funciona', 'Planes', 'App mobile', 'API'] },
  { title: 'Empresa',  links: ['Nosotros', 'Blog', 'Prensa', 'Contacto'] },
  { title: 'Legal',    links: ['Términos', 'Privacidad', 'Cookies'] },
]

function scrollTo(targetId: string) {
  const el = document.getElementById(targetId)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function LandingWeb() {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div id="top" className="tw-page" style={{ fontFamily: '"Manrope", system-ui, sans-serif', background: '#f8f9fa' }}>
      {/* Navbar */}
      <nav className="landing-nav">
        <div className="landing-nav__inner">
          <a href="#top" onClick={e => { e.preventDefault(); scrollTo('top') }} className="landing-nav__brand">
            <img src={logoSrc} alt="Safe Truck" className="landing-nav__logo" />
            Safe Truck
          </a>
          <div className="landing-nav__links">
            {navLinks.map(l => (
              <a key={l.label} href={'#' + l.targetId} onClick={e => { e.preventDefault(); scrollTo(l.targetId) }} className="landing-nav__link">
                {l.label}
              </a>
            ))}
          </div>
          <div className="landing-nav__actions">
            <button className="landing-nav__button landing-nav__button--ghost" onClick={() => router.push('/auth/login')}>
              Iniciar sesión
            </button>
            <button className="landing-nav__button landing-nav__button--primary" onClick={() => router.push('/auth/register')}>
              Registrá tu empresa
            </button>
          </div>
          <button className="landing-nav__menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
            {menuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
        </div>
        {menuOpen && (
          <div className="landing-nav__mobile-panel">
            {navLinks.map(l => (
              <a key={l.label} href={'#' + l.targetId} onClick={e => { e.preventDefault(); scrollTo(l.targetId); setMenuOpen(false) }} className="landing-nav__mobile-link">
                {l.label}
              </a>
            ))}
            <button className="landing-nav__button landing-nav__button--ghost landing-nav__button--full" onClick={() => router.push('/auth/login')}>
              Iniciar sesión
            </button>
            <button className="landing-nav__button landing-nav__button--primary landing-nav__button--full" onClick={() => router.push('/auth/register')}>
              Registrá tu empresa
            </button>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <img src={heroSrc} alt="Camión en ruta" className="landing-hero__image" />
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
              <button onClick={() => scrollTo('planes')} className="landing-button landing-button--light">
                Ver planes
              </button>
              <button onClick={() => router.push('/auth/register')} className="landing-button landing-button--primary">
                Registrá tu empresa
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
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

      {/* How it works */}
      <section id="como-funciona" className="landing-section landing-section--light">
        <div className="landing-section__inner landing-how-it-works">
          <header className="landing-section__header">
            <h2 className="landing-section__title">Tres pasos para empezar</h2>
            <p className="landing-section__subtitle">Sin complicaciones. En menos de 10 minutos tu flota está online.</p>
          </header>
          <div className="landing-how-it-works__grid">
            {howItWorksSteps.map(({ icon: Icon, title, desc }) => (
              <article key={title} className="landing-step-card">
                <Icon size={40} className="landing-step-card__icon" />
                <h3 className="landing-step-card__title">{title}</h3>
                <p className="landing-step-card__description">{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="planes" className="landing-plans">
        <div className="landing-section__inner">
          <header className="landing-section__header">
            <h2 className="landing-section__title">Planes para cada flota</h2>
            <p className="landing-plans__subtitle">Sin contratos anuales. Cancelás cuando quieras.</p>
          </header>
          <div className="landing-plans__grid">
            {plans.map(p => (
              <button
                key={p.name}
                onClick={() => router.push('/auth/register')}
                className={`landing-plan-card${p.highlighted ? ' landing-plan-card--highlighted' : ''}`}
                style={{ textAlign: 'left', font: 'inherit' }}
              >
                {p.highlighted && <span className="landing-plan-card__badge">Más elegido</span>}
                <p className="landing-plan-card__name">{p.name}</p>
                <div className="landing-plan-card__price-row">
                  <span className="landing-plan-card__price">{p.price}</span>
                  <span className="landing-plan-card__period">USD/mes</span>
                </div>
                <ul className="landing-plan-card__features">
                  {p.features.map(f => (
                    <li key={f} className="landing-plan-card__feature">
                      <CheckCircle2 size={20} className="landing-plan-card__check" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <span className={`landing-plan-card__cta ${p.highlighted ? 'landing-plan-card__cta--primary' : 'landing-plan-card__cta--outline'}`}
                  style={{ display: 'block', textAlign: 'center', marginTop: '1.5rem' }}>
                  Elegir {p.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="nosotros" className="landing-about">
        <div className="landing-about__inner">
          <div>
            <p className="landing-about__tag">Nuestra historia</p>
            <h2 className="landing-about__title">Construido por gente del transporte</h2>
            <p className="landing-about__body">
              Safe Truck nació de la necesidad real de las empresas de logística argentinas: saber dónde está cada camión, en todo momento, sin depender de llamadas ni mensajes. Somos un equipo apasionado por la tecnología y el transporte, comprometidos con hacer la gestión de flotas simple y accesible para empresas de todos los tamaños.
            </p>
          </div>
          <div className="landing-about__stats">
            {aboutStats.map(s => (
              <div key={s.label} className="landing-about__stat">
                <div className="landing-about__stat-num">{s.num}</div>
                <div className="landing-about__stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="contacto" className="landing-footer">
        <div className="landing-footer__inner">
          <div className="landing-footer__grid">
            <div>
              <div className="landing-footer__brand">Safe Truck</div>
              <p className="landing-footer__tagline">Gestión de flotas simple y poderosa.</p>
            </div>
            {footerCols.map(c => (
              <div key={c.title}>
                <h4 className="landing-footer__col-title">{c.title}</h4>
                <ul>
                  {c.links.map(l => (
                    <li key={l}><a href="#" className="landing-footer__link">{l}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="landing-footer__bottom">© 2025 Safe Truck. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  )
}
