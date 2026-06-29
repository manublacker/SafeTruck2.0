import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// search.ts crea su PROPIO Pool (no usa ../db), así que mockeamos 'pg' entero.
const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }))
// `new Pool(...)` necesita un constructor, así que mockeamos con una clase.
vi.mock('pg', () => ({ Pool: class { query = poolQuery } }))

import searchRouter from '../../src/backend/routes/search'
import { appWith, request } from './_http'

const app = appWith(searchRouter)

// El helper `request` usa fetch para pegarle al server efímero (localhost), y la
// ruta usa fetch para Nominatim. Compartimos el mismo global, así que el stub
// DEJA PASAR localhost al fetch real y sólo intercepta Nominatim (sin red real).
const realFetch = globalThis.fetch.bind(globalThis)
const nominatimCalls = () =>
  (globalThis.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('nominatim'))

beforeEach(() => {
  poolQuery.mockReset()
  vi.stubGlobal('fetch', vi.fn((url: any, opts: any) => {
    if (String(url).includes('nominatim')) return Promise.resolve({ ok: false })
    return realFetch(url, opts)
  }))
})
afterEach(() => vi.unstubAllGlobals())

function localRow(over: Record<string, unknown> = {}) {
  return { nombre: 'Av. Corrientes', nombre_buscable: 'Av. Corrientes', lat: '-34.6', lon: '-58.4', score: '0.95', ...over }
}

describe('GET /api/search', () => {
  it('devuelve [] si la query es muy corta (<2)', async () => {
    const res = await request(app, 'GET', '/?q=a')
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('devuelve [] si no viene q', async () => {
    const res = await request(app, 'GET', '/')
    expect(res.body.results).toEqual([])
    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('mapea los resultados locales y los marca source=local', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [localRow()], rowCount: 1 })
    const res = await request(app, 'GET', '/?q=corrientes')
    expect(res.status).toBe(200)
    expect(res.body.results[0]).toMatchObject({
      nombre: 'Av. Corrientes',
      lat: -34.6,
      lon: -58.4,
      source: 'local',
    })
    // score se normaliza a 2 decimales.
    expect(res.body.results[0].score).toBe('0.95')
  })

  it('con 10+ resultados locales corta sin llamar a Nominatim', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => localRow({ nombre: `Calle ${i}`, nombre_buscable: `Calle ${i}` }))
    poolQuery.mockResolvedValueOnce({ rows, rowCount: 10 })
    const res = await request(app, 'GET', '/?q=calle')
    expect(res.body.results).toHaveLength(10)
    // No salió a Nominatim (cortó con los 10 locales).
    expect(nominatimCalls()).toHaveLength(0)
  })

  it('si la búsqueda local falla, igual responde (cae a Nominatim, acá vacío)', async () => {
    poolQuery.mockRejectedValueOnce(new Error('aiven caído'))
    const res = await request(app, 'GET', '/?q=corrientes')
    expect(res.status).toBe(200)
    // Nominatim mockeado como {ok:false} → searchNominatim devuelve [].
    expect(res.body.results).toEqual([])
  })
})
