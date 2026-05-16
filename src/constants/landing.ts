export interface LandingFeature {
  title: string
  description: string
}

export const LANDING_FEATURES: LandingFeature[] = [
  { title: 'Tracking en tiempo real', description: 'Seguí cada camión en el mapa con actualización constante.' },
  { title: 'App para choferes', description: 'Tus choferes solo necesitan el celular. Simple y rápida.' },
  { title: 'Alertas inteligentes', description: 'Notificaciones por desvíos, paradas o exceso de velocidad.' },
  { title: 'Reportes exportables', description: 'Descargá el historial de rutas y generá reportes.' },
  { title: 'Multi-usuario', description: 'Administradores y operadores con distintos niveles de acceso.' },
  { title: 'Datos seguros', description: 'Tu información protegida con encriptación de extremo a extremo.' },
]

export interface LandingStep {
  number: number
  title: string
  description: string
}

export const LANDING_STEPS: LandingStep[] = [
  { number: 1, title: 'Registrá tu empresa', description: 'Creá tu cuenta, completá los datos y elegí tu plan.' },
  { number: 2, title: 'Sumá tus camiones', description: 'Cargá tu flota en minutos y asigná choferes a cada unidad.' },
  { number: 3, title: 'Trackeá en tiempo real', description: 'Tus choferes usan la app y vos ves posición, ruta e historial.' },
]

export interface LandingStat {
  value: string
  label: string
}

export const LANDING_STATS: LandingStat[] = [
  { value: '500+', label: 'Camiones trackeados' },
  { value: '80+', label: 'Empresas activas' },
  { value: '99.9%', label: 'Uptime garantizado' },
]
