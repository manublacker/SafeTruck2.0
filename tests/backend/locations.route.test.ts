import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/backend/db', () => ({ default: { query: vi.fn() } }))
vi.mock('../../src/backend/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    const raw = req.headers['x-test-user']
    req.user = raw ? JSON.parse(raw) : { id: 'admin-1', email: 'admin@test.com', user_metadata: {} }
    next()
  },
}))
vi.mock('../../src/backend/middleware/requireActiveSubscription', () => ({
  requireActiveSubscription: (_req: any, _res: any, next: any) => next(),
}))
// El hub de tiempo real es best-effort: lo neutralizamos para no abrir WebSockets.
vi.mock('../../src/backend/realtime/hub', () => ({
  broadcastToCompany: vi.fn(),
  resolveCompany: vi.fn().mockResolvedValue({ companyId: 'company-1' }),
}))

import locationsRouter from '../../src/backend/routes/locations'
import pool from '../../src/backend/db'
import { broadcastToCompany } from '../../src/backend/realtime/hub'
import { appWith, request } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
const broadcast = broadcastToCompany as unknown as ReturnType<typeof vi.fn>
const app = appWith(locationsRouter)

beforeEach(() => {
  query.mockReset()
  broadcast.mockReset()
})

describe('GET /api/locations', () => {
  it('devuelve las ubicaciones de la empresa', async () => {
    const rows = [{ driver_app_user_id: 'd1', lat: -34.6, lng: -58.4 }]
    query.mockResolvedValueOnce({ rows, rowCount: 1 })

    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(rows)
    // Filtra por el admin logueado.
    expect(query.mock.calls[0][1]).toEqual(['admin-1'])
  })

  it('500 si la DB falla', async () => {
    query.mockRejectedValueOnce(new Error('db error'))
    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(500)
  })
})

describe('POST /api/locations', () => {
  it('rechaza si falta lat o lng', async () => {
    const res = await request(app, 'POST', '/', { body: { lat: -34.6 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/lat y lng/)
    expect(query).not.toHaveBeenCalled()
  })

  it('acepta lat/lng = 0 (no los confunde con faltantes)', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const res = await request(app, 'POST', '/', { body: { lat: 0, lng: 0 } })
    // Usa `== null`, así que el 0 es válido.
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('guarda la posición y responde success', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const res = await request(app, 'POST', '/', {
      body: { lat: -34.6, lng: -58.4, driver_name: 'Juan', truck_plate: 'AC123' },
      headers: { 'x-test-user': JSON.stringify({ id: 'driver-3', email: 'j@t.com', user_metadata: {} }) },
    })
    expect(res.status).toBe(200)
    expect(query.mock.calls[0][1][0]).toBe('driver-3')
  })

  it('500 si la DB falla en el upsert', async () => {
    query.mockRejectedValueOnce(new Error('insert falló'))
    const res = await request(app, 'POST', '/', { body: { lat: 1, lng: 1 } })
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/locations', () => {
  it('borra la ubicación del conductor', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const res = await request(app, 'DELETE', '/', {
      headers: { 'x-test-user': JSON.stringify({ id: 'driver-5', email: 'x@t.com', user_metadata: {} }) },
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(query.mock.calls[0][1]).toEqual(['driver-5'])
  })

  it('500 si la DB falla al borrar', async () => {
    query.mockRejectedValueOnce(new Error('delete falló'))
    const res = await request(app, 'DELETE', '/')
    expect(res.status).toBe(500)
  })
})
