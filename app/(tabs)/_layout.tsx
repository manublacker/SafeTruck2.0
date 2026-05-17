import { Slot, useRouter, usePathname, Redirect } from 'expo-router'
import { Map, Bell, Users, ChevronRight, Truck } from 'lucide-react'
import { useStore } from '../../src/store/useStore'
import '../../src/styles/dashboard.css'

const logoSrc: string = (require('../../assets/logo_safetruck.png') as { uri: string }).uri

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  subtitle: string
}

const NAV_ITEMS: NavItem[] = [
  { href: '/(tabs)',           label: 'Mapa',        icon: Map,   subtitle: 'Visualización de la flota en tiempo real' },
  { href: '/(tabs)/drivers',   label: 'Conductores', icon: Users, subtitle: 'Conductores registrados en tu empresa' },
  { href: '/(tabs)/trips',     label: 'Viajes',      icon: Truck, subtitle: 'Viajes programados y completados' },
  { href: '/(tabs)/incidents', label: 'Alertas',     icon: Bell,  subtitle: 'Incidentes activos reportados' },
]

const PROFILE_META = { label: 'Mi cuenta', subtitle: 'Perfil, plan y configuración' }

function getActiveTitle(pathname: string) {
  if (pathname.includes('/profile')) return PROFILE_META
  const match = NAV_ITEMS.slice(1).find(i => pathname.startsWith(i.href.replace('/(tabs)', '')))
  return match || NAV_ITEMS[0]
}

export default function TabLayout() {
  const profile = useStore(s => s.profile)
  const router = useRouter()
  const pathname = usePathname()

  if (!profile) return <Redirect href="/landing" />

  const active = getActiveTitle(pathname)
  const initial = profile.full_name?.[0]?.toUpperCase() || profile.email?.[0]?.toUpperCase() || '?'
  const isProfileActive = pathname.includes('/profile')

  const go = (href: string) => router.push(href as any)

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar">
        <a href="#" onClick={e => { e.preventDefault(); go('/(tabs)') }} className="dash-sidebar__brand">
          <img src={logoSrc} alt="Safe Truck" className="dash-sidebar__brand-logo" />
          <span className="dash-sidebar__brand-name">Safe Truck</span>
        </a>

        <nav className="dash-nav">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            const isActive = !isProfileActive && item.href === (active as NavItem).href
            return (
              <button
                key={item.href}
                onClick={() => go(item.href)}
                className={`dash-nav__item${isActive ? ' dash-nav__item--active' : ''}`}
              >
                <span className="dash-nav__icon"><Icon size={18} /></span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="dash-sidebar__footer">
          <button
            onClick={() => go('/(tabs)/profile')}
            className={`dash-sidebar__user-btn${isProfileActive ? ' dash-sidebar__user-btn--active' : ''}`}
            title="Ir a mi cuenta"
          >
            <div className="dash-sidebar__avatar">{initial}</div>
            <div className="dash-sidebar__user-info">
              <div className="dash-sidebar__user-name">{profile.full_name || profile.email || 'Usuario'}</div>
              <div className="dash-sidebar__user-email">Mi cuenta</div>
            </div>
            <ChevronRight size={16} className="dash-sidebar__user-chevron" />
          </button>
        </div>
      </aside>

      <main className="dash-main">
        <header className="dash-topbar">
          <div>
            <div className="dash-topbar__title">{active.label}</div>
            <div className="dash-topbar__subtitle">{active.subtitle}</div>
          </div>
        </header>
        <div className="dash-content">
          <div className="dash-content__inner">
            <Slot />
          </div>
        </div>
      </main>
    </div>
  )
}
