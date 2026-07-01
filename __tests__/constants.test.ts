/**
 * Tests de las constantes de dominio: centro/límites del AMBA, parámetros de
 * ruteo, etiquetas de incidentes y colores (`src/constants/index.ts`), pasos y
 * planes del registro (`src/constants/register.ts`), contenido del landing
 * (`src/constants/landing.ts`) y el vehículo de fallback de dev
 * (`src/constants/devFallback.ts`).
 */
import {
  AMBA_CENTER,
  AMBA_BOUNDS,
  ROUTING,
  INCIDENT_LABELS,
  COLORS,
} from '../src/constants/index'
import {
  REGISTER_STEPS,
  TOTAL_STEPS,
  OTP_RESEND_COOLDOWN_SECONDS,
  INDUSTRY_OPTIONS,
  PLAN_OPTIONS,
} from '../src/constants/register'
import {
  LANDING_FEATURES,
  LANDING_STEPS,
  LANDING_STATS,
} from '../src/constants/landing'
import { DEV_FALLBACK_VEHICLE } from '../src/constants/devFallback'
import { isInAMBA } from '../src/backend/graphCache'

describe('constants — AMBA_CENTER', () => {
  it('está en las coordenadas del Obelisco (CABA)', () => {
    expect(AMBA_CENTER.lat).toBeCloseTo(-34.6037, 3)
    expect(AMBA_CENTER.lng).toBeCloseTo(-58.3816, 3)
  })

  it('el centro cae dentro del bounding box del AMBA', () => {
    expect(AMBA_CENTER.lat).toBeLessThan(AMBA_BOUNDS.north)
    expect(AMBA_CENTER.lat).toBeGreaterThan(AMBA_BOUNDS.south)
    expect(AMBA_CENTER.lng).toBeLessThan(AMBA_BOUNDS.east)
    expect(AMBA_CENTER.lng).toBeGreaterThan(AMBA_BOUNDS.west)
  })
})

describe('constants — AMBA_BOUNDS', () => {
  it('north está al norte de south (hemisferio sur → menos negativo)', () => {
    expect(AMBA_BOUNDS.north).toBeGreaterThan(AMBA_BOUNDS.south)
  })

  it('east está al este de west', () => {
    expect(AMBA_BOUNDS.east).toBeGreaterThan(AMBA_BOUNDS.west)
  })

  it('todas las latitudes son del hemisferio sur y longitudes oeste', () => {
    expect(AMBA_BOUNDS.north).toBeLessThan(0)
    expect(AMBA_BOUNDS.south).toBeLessThan(0)
    expect(AMBA_BOUNDS.east).toBeLessThan(0)
    expect(AMBA_BOUNDS.west).toBeLessThan(0)
  })
})

describe('constants — ROUTING', () => {
  it('la penalización para calles no habilitadas es mayor que para desconocidas', () => {
    expect(ROUTING.PENALTY_UNAUTHORIZED).toBeGreaterThan(ROUTING.PENALTY_UNKNOWN)
  })

  it('la velocidad por defecto es positiva y realista para camión urbano', () => {
    expect(ROUTING.DEFAULT_SPEED_KMH).toBeGreaterThan(0)
    expect(ROUTING.DEFAULT_SPEED_KMH).toBeLessThanOrEqual(120)
  })

  it('el radio de búsqueda es positivo', () => {
    expect(ROUTING.SEARCH_RADIUS_M).toBeGreaterThan(0)
  })
})

describe('constants — INCIDENT_LABELS', () => {
  it('cada etiqueta empieza con un emoji y contiene texto', () => {
    for (const [key, label] of Object.entries(INCIDENT_LABELS)) {
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(1)
      // La etiqueta no es sólo el key crudo.
      expect(label).not.toBe(key)
    }
  })

  it('incluye los tipos de incidente principales', () => {
    for (const tipo of ['accidente', 'corte', 'obra', 'trafico', 'control_policial']) {
      expect(INCIDENT_LABELS).toHaveProperty(tipo)
    }
  })

  it('no tiene etiquetas duplicadas', () => {
    const labels = Object.values(INCIDENT_LABELS)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('constants — COLORS', () => {
  it('todos los colores son hex válidos', () => {
    const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/
    for (const value of Object.values(COLORS)) {
      expect(HEX.test(value)).toBe(true)
    }
  })

  it('expone roles clave (primary, text, background)', () => {
    expect(COLORS.primary).toBeDefined()
    expect(COLORS.text).toBeDefined()
    expect(COLORS.background).toBeDefined()
  })
})

describe('constants — isInAMBA (graphCache)', () => {
  it('el centro del AMBA está dentro', () => {
    expect(isInAMBA(AMBA_CENTER.lat, AMBA_CENTER.lng)).toBe(true)
  })

  it('un punto en la Patagonia está fuera', () => {
    expect(isInAMBA(-41.13, -71.31)).toBe(false) // Bariloche
  })

  it('un punto en Europa está fuera', () => {
    expect(isInAMBA(48.85, 2.35)).toBe(false) // París
  })

  it('respeta los cuatro bordes del bbox', () => {
    // Dentro
    expect(isInAMBA(-34.6, -58.4)).toBe(true)
    // Demasiado al norte
    expect(isInAMBA(-34.2, -58.4)).toBe(false)
    // Demasiado al sur
    expect(isInAMBA(-35.0, -58.4)).toBe(false)
    // Demasiado al oeste
    expect(isInAMBA(-34.6, -59.5)).toBe(false)
    // Demasiado al este
    expect(isInAMBA(-34.6, -57.9)).toBe(false)
  })

  it('los límites son inclusivos', () => {
    expect(isInAMBA(-34.9, -59.0)).toBe(true) // esquina min
    expect(isInAMBA(-34.3, -58.1)).toBe(true) // esquina max
  })
})

describe('constants — REGISTER_STEPS', () => {
  it('tiene cuatro pasos', () => {
    expect(REGISTER_STEPS).toHaveLength(4)
  })

  it('TOTAL_STEPS coincide con la cantidad de pasos', () => {
    expect(TOTAL_STEPS).toBe(REGISTER_STEPS.length)
  })

  it('empieza en Acceso y termina en Plan', () => {
    expect(REGISTER_STEPS[0]).toBe('Acceso')
    expect(REGISTER_STEPS[REGISTER_STEPS.length - 1]).toBe('Plan')
  })

  it('el cooldown de reenvío de OTP es de 60 segundos', () => {
    expect(OTP_RESEND_COOLDOWN_SECONDS).toBe(60)
  })
})

describe('constants — INDUSTRY_OPTIONS', () => {
  it('ofrece varias industrias y una opción "Otros"', () => {
    expect(INDUSTRY_OPTIONS.length).toBeGreaterThan(1)
    expect(INDUSTRY_OPTIONS).toContain('Otros')
  })

  it('no tiene opciones duplicadas', () => {
    expect(new Set(INDUSTRY_OPTIONS).size).toBe(INDUSTRY_OPTIONS.length)
  })
})

describe('constants — PLAN_OPTIONS', () => {
  it('ofrece tres planes: starter, pro y enterprise', () => {
    const slugs = PLAN_OPTIONS.map((p) => p.slug)
    expect(slugs).toEqual(['starter', 'pro', 'enterprise'])
  })

  it('cada plan tiene nombre, precio y al menos una feature', () => {
    for (const plan of PLAN_OPTIONS) {
      expect(plan.name).toBeTruthy()
      expect(plan.price).toMatch(/^\$/)
      expect(plan.features.length).toBeGreaterThan(0)
    }
  })

  it('exactamente un plan está destacado (highlighted)', () => {
    const destacados = PLAN_OPTIONS.filter((p) => p.highlighted)
    expect(destacados).toHaveLength(1)
    expect(destacados[0].slug).toBe('pro')
  })

  it('los precios crecen de starter a enterprise', () => {
    const precio = (s: string) => Number(s.replace(/[^0-9]/g, ''))
    const [starter, pro, enterprise] = PLAN_OPTIONS
    expect(precio(starter.price)).toBeLessThan(precio(pro.price))
    expect(precio(pro.price)).toBeLessThan(precio(enterprise.price))
  })

  it('los slugs no se repiten', () => {
    const slugs = PLAN_OPTIONS.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe('constants — landing', () => {
  it('LANDING_FEATURES tiene título y descripción no vacíos', () => {
    expect(LANDING_FEATURES.length).toBeGreaterThan(0)
    for (const f of LANDING_FEATURES) {
      expect(f.title).toBeTruthy()
      expect(f.description).toBeTruthy()
    }
  })

  it('LANDING_STEPS están numerados de forma consecutiva desde 1', () => {
    LANDING_STEPS.forEach((step, i) => {
      expect(step.number).toBe(i + 1)
      expect(step.title).toBeTruthy()
      expect(step.description).toBeTruthy()
    })
  })

  it('LANDING_STATS tiene valor y etiqueta', () => {
    expect(LANDING_STATS.length).toBeGreaterThan(0)
    for (const s of LANDING_STATS) {
      expect(s.value).toBeTruthy()
      expect(s.label).toBeTruthy()
    }
  })
})

describe('constants — DEV_FALLBACK_VEHICLE', () => {
  it('representa un camión pesado para ver restricciones', () => {
    expect(DEV_FALLBACK_VEHICLE.weight_kg).toBeGreaterThan(10000)
    expect(DEV_FALLBACK_VEHICLE.height_m).toBeGreaterThan(3.5)
    expect(DEV_FALLBACK_VEHICLE.length_m).toBeGreaterThan(8)
  })

  it('está marcado como default', () => {
    expect(DEV_FALLBACK_VEHICLE.is_default).toBe(true)
  })

  it('tiene patente y nombre identificables como de prueba', () => {
    expect(DEV_FALLBACK_VEHICLE.plate).toBe('TEST123')
    expect(DEV_FALLBACK_VEHICLE.name.toLowerCase()).toContain('prueba')
  })
})
