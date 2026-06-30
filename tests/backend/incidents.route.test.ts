import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/backend/db', () => ({ default: { query: vi.fn() } }))
vi.mock('../../src/backend/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    const raw = req.headers['x-test-user']
    req.user = raw ? JSON.parse(raw) : { id: 'driver-1', email: 'd@test.com', user_metadata: {} }
    next()
  },
}))

import incidentsRouter from '../../src/backend/routes/incidents'
import pool from '../../src/backend/db'
import { appWith, request, asUser } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
const app = appWith(incidentsRouter)

beforeEach(() => query.mockReset())

describe('POST /api/incidents', () => {
  it('400 si el incident_type es inválido', async () => {
    const res = await request(app, 'POST', '/', { body: { incident_type: 'meteorito', lat: -34.6, lon: -58.4 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/incident_type/)
    expect(query).not.toHaveBeenCalled()
  })

  it('400 si faltan coordenadas', async () => {
    const res = await request(app, 'POST', '/', { body: { incident_type: 'accidente' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/lat\/lon/)
  })

  it('acepta coordenadas en 0 (consistente con el resto del backend)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // snap
      .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 }) // reportar_incidente
    const res = await request(app, 'POST', '/', { body: { incident_type: 'obra', lat: 0, lon: 0 } })
    expect(res.status).toBe(201)
  })

  it('404 si no hay calle cercana al punto', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'POST', '/', { body: { incident_type: 'obra', lat: -34.6, lon: -58.4 } })
    expect(res.status).toBe(404)
  })

  it('crea el incidente y devuelve los ids (201)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 12 }], rowCount: 1 })   // snap-to-edge
      .mockResolvedValueOnce({ rows: [{ id: 555 }], rowCount: 1 })  // reportar_incidente
    const res = await request(app, 'POST', '/', {
      body: { incident_type: 'control_policial', lat: -34.6, lon: -58.4, notes: 'en la rotonda' },
    })
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.incident_id).toBe(555)
    expect(res.body.arista_id).toBe(12)
  })

  it('acepta todos los tipos válidos conocidos', async () => {
    // Cada tipo válido pasa la validación (llega a snapear).
    const tipos = ['multa', 'accidente', 'control_policial', 'obra', 'puente_bajo', 'corte', 'control_peso', 'otro', 'trafico', 'objeto_en_via']
    for (const t of tipos) {
      query.mockReset()
      query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 })
      const res = await request(app, 'POST', '/', { body: { incident_type: t, lat: -34.6, lon: -58.4 } })
      expect(res.status).toBe(201)
    }
  })

  it('500 si la DB falla', async () => {
    query.mockRejectedValueOnce(new Error('db'))
    const res = await request(app, 'POST', '/', { body: { incident_type: 'obra', lat: -34.6, lon: -58.4 } })
    expect(res.status).toBe(500)
  })
})

describe('GET /api/incidents', () => {
  it('devuelve los incidentes activos', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, incident_type: 'obra' }], rowCount: 1 })
    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(200)
    expect(res.body.incidents).toHaveLength(1)
  })

  it('500 si la DB falla', async () => {
    query.mockRejectedValueOnce(new Error('db'))
    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/incidents/:id/confirm', () => {
  it('confirma un incidente ajeno y renueva la expiración', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, confirmed_count: 3, expires_at: '2099' }], rowCount: 1 })
    const res = await request(app, 'PATCH', '/1/confirm', {})
    expect(res.status).toBe(200)
    expect(res.body.confirmed_count).toBe(3)
  })

  it('404 si no se puede confirmar (propio, vencido o inactivo)', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'PATCH', '/1/confirm', {})
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/incidents/:id/deactivate', () => {
  it('desactiva el incidente propio', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
    const res = await request(app, 'PATCH', '/1/deactivate', {
      headers: asUser({ id: 'owner-1', email: 'o@t.com', user_metadata: {} }),
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('404 si no es el dueño o ya está inactivo', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'PATCH', '/1/deactivate', {})
    expect(res.status).toBe(404)
  })
})
