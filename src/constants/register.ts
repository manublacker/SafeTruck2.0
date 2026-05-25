import type { SubscriptionPlan } from '../types'

export const REGISTER_STEPS = ['Acceso', 'Tu empresa', 'Verificación', 'Plan'] as const

export const TOTAL_STEPS = REGISTER_STEPS.length

/** Segundos de espera antes de permitir reenviar el código OTP. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60

export const INDUSTRY_OPTIONS = [
  'Carga general',
  'Granos / Agro',
  'Materiales de construcción',
  'Refrigerados',
  'Combustibles',
  'Otros',
] as const


export interface PlanOption {
  slug: SubscriptionPlan
  name: string
  price: string
  features: string[]
  highlighted?: boolean
}

export const PLAN_OPTIONS: PlanOption[] = [
  {
    slug: 'starter',
    name: 'Starter',
    price: '$29',
    features: [
      'Hasta 5 camiones',
      'Tracking en tiempo real',
      'App mobile para choferes',
      'Historial 7 días',
      'Soporte por email',
    ],
  },
  {
    slug: 'pro',
    name: 'Pro',
    price: '$79',
    highlighted: true,
    features: [
      'Hasta 20 camiones',
      'Todo lo de Starter',
      'Historial 30 días',
      'Alertas personalizadas',
      'Panel multi-usuario (3 admins)',
      'Soporte prioritario',
    ],
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    price: '$199',
    features: [
      'Camiones ilimitados',
      'Todo lo de Pro',
      'Historial 1 año',
      'API de integración',
      'Reportes avanzados',
      'Manager dedicado',
      'SLA garantizado',
    ],
  },
]
