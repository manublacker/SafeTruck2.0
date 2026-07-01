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
vi.mock('../../src/backend/realtime/hub', () => ({
  broadcastToCompany: vi.fn(),
}))

import tripsRouter from '../../src/backend/routes/assigned-trips'
import pool from '../../src/backend/db'
import { broadcastToCompany } from '../../src/backend/realtime/hub'
import { appWith, request, asUser } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
const broadcast = broadcastToCompany as unknown as ReturnType<typeof vi.fn>
const app = appWith(tripsRouter)

beforeEach(() => {
  query.mockReset()
  broadcast.mockReset()
})

describe('POST /api/assigned-trips', () => {
  it('400 si falta driver_id', async () => {
    const res = await request(app, 'POST', '/', { body: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/driver_id/)
    expect(query).not.toHaveBeenCalled()
  })

  it('404 si el conductor no es del admin', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'POST', '/', { body: { driver_id: 5 } })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Conductor/)
  })

  it('crea el viaje (201) y devuelve el trip', async () => {
    query.mockImplementation((sql: string) => {
      if (/FROM drivers WHERE id = \$1 AND user_id/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ nombre: 'Juan', app_user_id: null }] })
      }
      if (/INSERT INTO assigned_trips/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 50 }] })
      }
      if (/d\.nombre AS driver_nombre/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 50, status: 'pending', origin_label: 'A' }] })
      }
      return Promise.resolve({ rowCount: 0, rows: [] })
    })

    const res = await request(app, 'POST', '/', {
      body: { driver_id: 5, origin_address: 'A', destination_address: 'B' },
    })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.trip.id).toBe(50)
    // Sin app_user_id no hay broadcast al conductor.
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('si el conductor tiene app_user_id, hace broadcast en tiempo real', async () => {
    query.mockImplementation((sql: string) => {
      if (/FROM drivers WHERE id = \$1 AND user_id/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ nombre: 'Juan', app_user_id: 'driver-1' }] })
      }
      if (/INSERT INTO assigned_trips/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 51 }] })
      }
      if (/d\.nombre AS driver_nombre/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 51, status: 'pending' }] })
      }
      return Promise.resolve({ rowCount: 0, rows: [] }) // push_tokens sin token
    })

    const res = await request(app, 'POST', '/', { body: { driver_id: 5 } })
    expect(res.status).toBe(201)
    expect(broadcast).toHaveBeenCalledWith('admin-1', expect.objectContaining({ type: 'trip_assigned' }), { only: 'driver-1' })
  })
})

describe('POST /api/assigned-trips/personal', () => {
  it('404 si el conductor no está vinculado a una empresa', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'POST', '/personal', {
      body: {},
      headers: asUser({ id: 'driver-1', email: 'd@t.com', user_metadata: {} }),
    })
    expect(res.status).toBe(404)
  })

  it('crea un viaje personal in_progress (201)', async () => {
    query.mockImplementation((sql: string) => {
      if (/FROM drivers WHERE app_user_id = \$1 AND is_active/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 9, user_id: 'admin-1' }] })
      }
      if (/INSERT INTO assigned_trips/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 77 }] })
      }
      if (/d\.nombre AS driver_nombre/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 77, status: 'in_progress', trip_source: 'personal' }] })
      }
      return Promise.resolve({ rowCount: 0, rows: [] })
    })

    const res = await request(app, 'POST', '/personal', {
      body: { origin_address: 'A', destination_address: 'B' },
      headers: asUser({ id: 'driver-1', email: 'd@t.com', user_metadata: {} }),
    })
    expect(res.status).toBe(201)
    expect(res.body.trip.trip_source).toBe('personal')
  })
})

describe('GET /api/assigned-trips', () => {
  it('autolimpia personales abandonados y devuelve la lista', async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })                       // UPDATE auto-cleanup
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending' }], rowCount: 1 }) // SELECT lista

    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    // La primera query es el UPDATE de autolimpieza.
    expect(query.mock.calls[0][0]).toMatch(/UPDATE assigned_trips/)
  })

  it('aún devuelve la lista si la autolimpieza falla (best-effort)', async () => {
    query
      .mockRejectedValueOnce(new Error('cleanup falló'))                      // UPDATE revienta
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })              // SELECT igual corre
    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })
})

describe('GET /api/assigned-trips/mine', () => {
  it('devuelve los viajes del conductor', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })
    const res = await request(app, 'GET', '/mine', {
      headers: asUser({ id: 'driver-1', email: 'd@t.com', user_metadata: {} }),
    })
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(query.mock.calls[0][1]).toEqual(['driver-1'])
  })
})

describe('PATCH /api/assigned-trips/:id/status', () => {
  it('400 si el estado no es asignable (ej. pending)', async () => {
    const res = await request(app, 'PATCH', '/10/status', { body: { status: 'pending' } })
    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('400 si el estado es desconocido', async () => {
    const res = await request(app, 'PATCH', '/10/status', { body: { status: 'banana' } })
    expect(res.status).toBe(400)
  })

  it('404 si el viaje no existe', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'PATCH', '/10/status', { body: { status: 'accepted' } })
    expect(res.status).toBe(404)
  })

  it('403 si el usuario no es ni la empresa ni el conductor del viaje', async () => {
    query.mockResolvedValueOnce({
      rows: [{ empresa_user_id: 'otra-empresa', driver_app_user_id: 'otro-driver', driver_id: 1 }],
      rowCount: 1,
    })
    const res = await request(app, 'PATCH', '/10/status', { body: { status: 'accepted' } })
    expect(res.status).toBe(403)
  })

  it('409 si el conductor ya tiene otro viaje en curso', async () => {
    query.mockImplementation((sql: string) => {
      if (/SELECT empresa_user_id/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ empresa_user_id: 'admin-1', driver_app_user_id: null, driver_id: 7 }] })
      }
      if (/status = 'in_progress' AND driver_id/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 99 }] }) // ya hay uno en curso
      }
      return Promise.resolve({ rowCount: 0, rows: [] })
    })
    const res = await request(app, 'PATCH', '/10/status', { body: { status: 'in_progress' } })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/ya tiene un viaje en curso/)
  })

  it('completa el viaje y limpia la ubicación del conductor (200)', async () => {
    const calls: string[] = []
    query.mockImplementation((sql: string) => {
      calls.push(sql)
      if (/SELECT empresa_user_id/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ empresa_user_id: 'admin-1', driver_app_user_id: 'driver-1', driver_id: 7 }] })
      }
      if (/d\.nombre AS driver_nombre/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 10, status: 'completed' }] })
      }
      return Promise.resolve({ rowCount: 1, rows: [] })
    })

    const res = await request(app, 'PATCH', '/10/status', { body: { status: 'completed' } })
    expect(res.status).toBe(200)
    expect(res.body.trip.status).toBe('completed')
    // Al completar, borra la ubicación viva del conductor.
    expect(calls.some((s) => /DELETE FROM driver_locations/.test(s))).toBe(true)
    expect(broadcast).toHaveBeenCalled()
  })
})

describe('DELETE /api/assigned-trips/:id', () => {
  it('elimina un viaje de la empresa (204)', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 }) // null driver_locations + DELETE
    const res = await request(app, 'DELETE', '/10')
    expect(res.status).toBe(204)
    // El DELETE filtra por empresa (no se puede borrar ajeno).
    const del = query.mock.calls.find((c) => /DELETE FROM assigned_trips/.test(c[0] as string))
    expect(del?.[1]).toEqual(['10', 'admin-1'])
  })

  it('404 si el viaje no es de la empresa', async () => {
    query.mockImplementation((sql: string) =>
      /DELETE FROM assigned_trips/.test(sql)
        ? Promise.resolve({ rows: [], rowCount: 0 })
        : Promise.resolve({ rows: [], rowCount: 1 })
    )
    const res = await request(app, 'DELETE', '/10')
    expect(res.status).toBe(404)
  })
})
