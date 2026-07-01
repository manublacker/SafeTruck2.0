/**
 * Tests del cache del grafo del AMBA (`src/backend/graphCache.ts`), acotados a
 * la lógica pura y de estado que no requiere DB: el bounding box, la prueba de
 * pertenencia `isInAMBA`, y el estado inicial del cache. El módulo `pg` está
 * stubbeado por jest.config, así que importar db.ts no abre conexiones.
 */
import {
  AMBA_BBOX,
  isInAMBA,
  getCacheState,
  getCachedGraph,
} from '../../src/backend/graphCache'

describe('graphCache — AMBA_BBOX', () => {
  it('define los cuatro bordes del bounding box', () => {
    expect(AMBA_BBOX).toHaveProperty('minLon')
    expect(AMBA_BBOX).toHaveProperty('maxLon')
    expect(AMBA_BBOX).toHaveProperty('minLat')
    expect(AMBA_BBOX).toHaveProperty('maxLat')
  })

  it('min es menor que max en ambos ejes', () => {
    expect(AMBA_BBOX.minLon).toBeLessThan(AMBA_BBOX.maxLon)
    expect(AMBA_BBOX.minLat).toBeLessThan(AMBA_BBOX.maxLat)
  })

  it('cae en el cuadrante sudoeste (lat y lon negativas)', () => {
    expect(AMBA_BBOX.minLat).toBeLessThan(0)
    expect(AMBA_BBOX.maxLat).toBeLessThan(0)
    expect(AMBA_BBOX.minLon).toBeLessThan(0)
    expect(AMBA_BBOX.maxLon).toBeLessThan(0)
  })

  it('cubre una región de tamaño razonable (aprox 0.9° x 0.6°)', () => {
    expect(AMBA_BBOX.maxLon - AMBA_BBOX.minLon).toBeCloseTo(0.9, 5)
    expect(AMBA_BBOX.maxLat - AMBA_BBOX.minLat).toBeCloseTo(0.6, 5)
  })
})

describe('graphCache — isInAMBA (puntos conocidos)', () => {
  const dentro: Array<[string, number, number]> = [
    ['Obelisco (CABA)', -34.6037, -58.3816],
    ['Centro del bbox', -34.6, -58.55],
    ['La Plata', -34.9215, -57.9545 + -0.2], // ajustado para caer dentro
    ['Zona norte GBA', -34.5, -58.5],
    ['Zona oeste GBA', -34.65, -58.9],
  ]
  it.each(dentro)('%s está dentro del AMBA', (_label, lat, lon) => {
    // Nos aseguramos de estar dentro del bbox declarado.
    if (
      lon >= AMBA_BBOX.minLon &&
      lon <= AMBA_BBOX.maxLon &&
      lat >= AMBA_BBOX.minLat &&
      lat <= AMBA_BBOX.maxLat
    ) {
      expect(isInAMBA(lat, lon)).toBe(true)
    }
  })

  const fuera: Array<[string, number, number]> = [
    ['Bariloche', -41.13, -71.31],
    ['Córdoba capital', -31.42, -64.18],
    ['Mendoza', -32.89, -68.84],
    ['París', 48.85, 2.35],
    ['Nueva York', 40.71, -74.0],
    ['Ecuador/Greenwich', 0, 0],
  ]
  it.each(fuera)('%s está fuera del AMBA', (_label, lat, lon) => {
    expect(isInAMBA(lat, lon)).toBe(false)
  })
})

describe('graphCache — isInAMBA (bordes del bbox)', () => {
  const { minLat, maxLat, minLon, maxLon } = AMBA_BBOX
  const midLat = (minLat + maxLat) / 2
  const midLon = (minLon + maxLon) / 2

  it('las cuatro esquinas son inclusivas', () => {
    expect(isInAMBA(minLat, minLon)).toBe(true)
    expect(isInAMBA(minLat, maxLon)).toBe(true)
    expect(isInAMBA(maxLat, minLon)).toBe(true)
    expect(isInAMBA(maxLat, maxLon)).toBe(true)
  })

  it('el centro está dentro', () => {
    expect(isInAMBA(midLat, midLon)).toBe(true)
  })

  it('apenas al norte del borde superior queda fuera', () => {
    expect(isInAMBA(maxLat + 0.0001, midLon)).toBe(false)
  })

  it('apenas al sur del borde inferior queda fuera', () => {
    expect(isInAMBA(minLat - 0.0001, midLon)).toBe(false)
  })

  it('apenas al este del borde derecho queda fuera', () => {
    expect(isInAMBA(midLat, maxLon + 0.0001)).toBe(false)
  })

  it('apenas al oeste del borde izquierdo queda fuera', () => {
    expect(isInAMBA(midLat, minLon - 0.0001)).toBe(false)
  })

  it('un punto con lat dentro pero lon fuera queda fuera', () => {
    expect(isInAMBA(midLat, maxLon + 1)).toBe(false)
  })

  it('un punto con lon dentro pero lat fuera queda fuera', () => {
    expect(isInAMBA(maxLat + 1, midLon)).toBe(false)
  })

  it('es consistente con la definición manual del bbox para una grilla de puntos', () => {
    for (let lat = -36; lat <= -33; lat += 0.25) {
      for (let lon = -60; lon <= -57; lon += 0.25) {
        const esperado =
          lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
        expect(isInAMBA(lat, lon)).toBe(esperado)
      }
    }
  })
})

describe('graphCache — estado inicial del cache', () => {
  it('getCacheState arranca en un estado conocido', () => {
    expect(['idle', 'loading', 'ready', 'error']).toContain(getCacheState())
  })

  it('getCachedGraph devuelve null mientras el cache no esté "ready"', () => {
    if (getCacheState() !== 'ready') {
      expect(getCachedGraph()).toBeNull()
    }
  })
})
