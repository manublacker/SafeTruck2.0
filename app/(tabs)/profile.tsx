import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { LogOut } from 'lucide-react'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import type { SubscriptionPlan } from '../../src/types'

const FIELDS_PERSONAL: Array<{ key: string; label: string }> = [
  { key: 'full_name', label: 'Nombre / Razón social' },
  { key: 'email',     label: 'Email' },
]

const FIELDS_COMPANY: Array<{ key: string; label: string }> = [
  { key: 'company_name', label: 'Empresa' },
  { key: 'cuit',         label: 'CUIT' },
  { key: 'industry',     label: 'Rubro' },
  { key: 'fleet_size',   label: 'Tamaño de flota' },
  { key: 'country',      label: 'País' },
  { key: 'province',     label: 'Provincia' },
]

type PlanDef = {
  id: SubscriptionPlan
  name: string
  price: string
  features: string[]
}

const PLANS: PlanDef[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$29',
    features: ['Hasta 5 camiones', 'Tracking en tiempo real', 'Historial 7 días', 'Soporte por email'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$79',
    features: ['Hasta 20 camiones', 'Historial 30 días', 'Alertas personalizadas', 'Panel multi-usuario (3 admins)', 'Soporte prioritario'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$199',
    features: ['Camiones ilimitados', 'Historial 1 año', 'API de integración', 'Reportes avanzados', 'Manager dedicado'],
  },
]

type Prefs = {
  email_notifications: boolean
  push_alerts: boolean
}

const PREFS_STORAGE_KEY = 'safetruck_prefs'

function loadPrefs(): Prefs {
  if (typeof window === 'undefined') return { email_notifications: true, push_alerts: true }
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) return { email_notifications: true, push_alerts: true }
    return JSON.parse(raw)
  } catch {
    return { email_notifications: true, push_alerts: true }
  }
}

export default function ProfileScreen() {
  const profile = useStore(s => s.profile)
  const setProfile = useStore(s => s.setProfile)
  const router = useRouter()

  const [changingPlan, setChangingPlan] = useState<SubscriptionPlan | null>(null)
  const [planMsg, setPlanMsg] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Prefs>({ email_notifications: true, push_alerts: true })
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => { setPrefs(loadPrefs()) }, [])

  if (!profile) return null

  const currentPlan = (profile.plan || null) as SubscriptionPlan | null

  const renderValue = (val: any) =>
    val ? <div className="dash-field__value">{val}</div>
        : <div className="dash-field__value dash-field__value--muted">No especificado</div>

  const changePlan = async (planId: SubscriptionPlan) => {
    if (planId === currentPlan) return
    setChangingPlan(planId)
    setPlanMsg(null)
    const { error } = await supabase.from('st_profiles').update({ plan: planId }).eq('id', profile.id)
    if (error) {
      setPlanMsg(`Error: ${error.message}`)
    } else {
      setProfile({ ...profile, plan: planId })
      setPlanMsg(`Plan actualizado a ${PLANS.find(p => p.id === planId)?.name}.`)
      setTimeout(() => setPlanMsg(null), 4000)
    }
    setChangingPlan(null)
  }

  const togglePref = (key: keyof Prefs) => {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    try { localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next)) } catch {}
  }

  const logout = async () => {
    setLoggingOut(true)
    await supabase.auth.signOut()
    setProfile(null)
    router.replace('/landing')
  }

  return (
    <>
      <div className="dash-card">
        <h2 className="dash-card__title">Datos personales</h2>
        <p className="dash-card__subtitle">Información de tu cuenta.</p>
        <div className="dash-grid-2">
          {FIELDS_PERSONAL.map(f => (
            <div key={f.key} className="dash-field">
              <div className="dash-field__label">{f.label}</div>
              {renderValue((profile as any)[f.key])}
            </div>
          ))}
        </div>
      </div>

      <div className="dash-card">
        <h2 className="dash-card__title">Empresa</h2>
        <p className="dash-card__subtitle">Datos cargados durante el registro.</p>
        <div className="dash-grid-2">
          {FIELDS_COMPANY.map(f => (
            <div key={f.key} className="dash-field">
              <div className="dash-field__label">{f.label}</div>
              {renderValue((profile as any)[f.key])}
            </div>
          ))}
        </div>
      </div>

      <div className="dash-card">
        <h2 className="dash-card__title">Plan</h2>
        <p className="dash-card__subtitle">
          {currentPlan
            ? `Estás suscripto al plan ${PLANS.find(p => p.id === currentPlan)?.name}.`
            : 'Todavía no elegiste un plan.'}
        </p>
        {planMsg && <div className="dash-banner-success">{planMsg}</div>}
        <div className="dash-plans">
          {PLANS.map(plan => {
            const isCurrent = plan.id === currentPlan
            return (
              <div key={plan.id} className={`dash-plan${isCurrent ? ' dash-plan--current' : ''}`}>
                {isCurrent && <span className="dash-plan__current-badge">Plan actual</span>}
                <div className="dash-plan__name">{plan.name}</div>
                <div>
                  <span className="dash-plan__price">{plan.price}</span>
                  <span className="dash-plan__price-suffix">USD/mes</span>
                </div>
                <ul className="dash-plan__features">
                  {plan.features.map(f => (
                    <li key={f} className="dash-plan__feature">{f}</li>
                  ))}
                </ul>
                <button
                  className={`dash-plan__btn ${isCurrent ? 'dash-plan__btn--ghost' : 'dash-plan__btn--primary'}`}
                  onClick={() => changePlan(plan.id)}
                  disabled={isCurrent || changingPlan !== null}
                >
                  {isCurrent
                    ? 'Plan actual'
                    : changingPlan === plan.id
                      ? 'Cambiando…'
                      : `Cambiar a ${plan.name}`}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="dash-card">
        <h2 className="dash-card__title">Preferencias</h2>
        <p className="dash-card__subtitle">Configuración de notificaciones.</p>
        <div className="dash-toggle-row">
          <div className="dash-toggle-row__info">
            <span className="dash-toggle-row__label">Notificaciones por email</span>
            <span className="dash-toggle-row__hint">Recibir resúmenes diarios de incidentes y viajes.</span>
          </div>
          <button
            type="button"
            aria-pressed={prefs.email_notifications}
            className={`dash-toggle${prefs.email_notifications ? ' dash-toggle--on' : ''}`}
            onClick={() => togglePref('email_notifications')}
          />
        </div>
        <div className="dash-toggle-row">
          <div className="dash-toggle-row__info">
            <span className="dash-toggle-row__label">Alertas en tiempo real</span>
            <span className="dash-toggle-row__hint">Mostrar notificaciones cuando se reporten incidentes.</span>
          </div>
          <button
            type="button"
            aria-pressed={prefs.push_alerts}
            className={`dash-toggle${prefs.push_alerts ? ' dash-toggle--on' : ''}`}
            onClick={() => togglePref('push_alerts')}
          />
        </div>
      </div>

      <div className="dash-card">
        <h2 className="dash-card__title">Sesión</h2>
        <p className="dash-card__subtitle">Cerrá sesión en este dispositivo.</p>
        <button className="dash-btn dash-btn--danger" onClick={logout} disabled={loggingOut}>
          <LogOut size={16} />
          {loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
        </button>
      </div>
    </>
  )
}
