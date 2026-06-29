import { describe, it, expect, vi, beforeEach } from 'vitest'

// El router usa pool.query (ownership) y pool.connect() (transacción).
vi.mock('../../src/backend/db', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}))

import truckDriversRouter from '../../src/backend/routes/truck-drivers'
import pool from '../../src/backend/db'
import { appWith, request, fakeAuth } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
const connect = pool.connect as unknown as ReturnType<typeof vi.fn>
const app = appWith(truckDriversRouter, fakeAuth)

/** Client de transacción falso (BEGIN/DELETE/INSERT/COMMIT + release). */
function makeClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }), release: vi.fn() }
}

beforeEach(() => {
  query.mockReset()
  connect.mockReset()
})

describe('POST /api/truck-drivers', () => {
  it('400 si truck_id o driver_id no son numéricos', async () => {
    const res = await request(app, 'POST', '/', { body: { truck_id: 'x', driver_id: 2 } })
    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('404 si el camión no es del usuario', async () => {
    query.mockImplementation((sql: string) =>
      /FROM trucks WHERE id/.test(sql)
        ? Promise.resolve({ rows: [], rowCount: 0 })   // no es dueño del camión
        : Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 })
    )
    const res = await request(app, 'POST', '/', { body: { truck_id: 1, driver_id: 2 } })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Camión/)
  })

  it('404 si el conductor no es del usuario', async () => {
    query.mockImplementation((sql: string) =>
      /FROM trucks WHERE id/.test(sql)
        ? Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 })   // no es dueño del conductor
    )
    const res = await request(app, 'POST', '/', { body: { truck_id: 1, driver_id: 2 } })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Conductor/)
  })

  it('asigna el conductor al camión dentro de una transacción (201)', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 }) // ambos ownership ok
    const client = makeClient()
    connect.mockResolvedValueOnce(client)

    const res = await request(app, 'POST', '/', { body: { truck_id: 1, driver_id: 2 } })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ truck_id: 1, driver_id: 2 })

    const txSqls = client.query.mock.calls.map((c) => c[0] as string)
    expect(txSqls).toContain('BEGIN')
    expect(txSqls).toContain('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })

  it('hace ROLLBACK y 500 si falla dentro de la transacción', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 })
    const client = makeClient()
    client.query.mockImplementation((sql: string) =>
      /INSERT INTO truck_drivers/.test(sql)
        ? Promise.reject(new Error('insert falló'))
        : Promise.resolve({ rows: [], rowCount: 1 })
    )
    connect.mockResolvedValueOnce(client)

    const res = await request(app, 'POST', '/', { body: { truck_id: 1, driver_id: 2 } })
    expect(res.status).toBe(500)
    const txSqls = client.query.mock.calls.map((c) => c[0] as string)
    expect(txSqls).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })
})

describe('DELETE /api/truck-drivers/:truck_id', () => {
  it('400 si el id no es numérico', async () => {
    const res = await request(app, 'DELETE', '/abc')
    expect(res.status).toBe(400)
  })

  it('404 si el camión no es del usuario', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ownership falla
    const res = await request(app, 'DELETE', '/1')
    expect(res.status).toBe(404)
  })

  it('204 al quitar la asignación', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // ownership ok
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })          // DELETE
    const res = await request(app, 'DELETE', '/1')
    expect(res.status).toBe(204)
  })
})
