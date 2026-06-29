import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/backend/db', () => ({ default: { query: vi.fn() } }))
vi.mock('../../src/backend/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    const raw = req.headers['x-test-user']
    req.user = raw ? JSON.parse(raw) : { id: 'admin-1', email: 'admin@test.com', user_metadata: { full_name: 'Admin Uno' } }
    next()
  },
}))
vi.mock('../../src/backend/middleware/requireActiveSubscription', () => ({
  requireActiveSubscription: (_req: any, _res: any, next: any) => next(),
}))

const { createUserMock, deleteUserMock } = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  deleteUserMock: vi.fn().mockResolvedValue({}),
}))
vi.mock('../../src/backend/supabaseClient', () => ({
  supabase: { auth: { admin: { createUser: createUserMock, deleteUser: deleteUserMock } } },
}))

import invitationsRouter from '../../src/backend/routes/invitations'
import pool from '../../src/backend/db'
import { appWith, request } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
const app = appWith(invitationsRouter)

beforeEach(() => {
  query.mockReset()
  createUserMock.mockReset()
  deleteUserMock.mockClear()
})

describe('POST /api/invitations', () => {
  it('crea una invitación y devuelve 201', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, code: 'ABC123', admin_id: 'admin-1' }], rowCount: 1 })
    const res = await request(app, 'POST', '/', { body: { hint_name: ' Pedro ' } })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.invitation.code).toBe('ABC123')
    // hint_name se trimea.
    expect(query.mock.calls[0][1][2]).toBe('Pedro')
  })

  it('500 si la DB falla', async () => {
    query.mockRejectedValueOnce(new Error('insert error'))
    const res = await request(app, 'POST', '/', { body: {} })
    expect(res.status).toBe(500)
  })
})

describe('GET /api/invitations', () => {
  it('lista las invitaciones del admin', async () => {
    const rows = [{ id: 1, code: 'ABC' }, { id: 2, code: 'DEF' }]
    query.mockResolvedValueOnce({ rows, rowCount: 2 })
    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(query.mock.calls[0][1]).toEqual(['admin-1'])
  })
})

describe('POST /api/invitations/redeem', () => {
  it('rechaza si falta el código', async () => {
    const res = await request(app, 'POST', '/redeem', { body: {} })
    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('404 si el código es inválido o venció', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    const res = await request(app, 'POST', '/redeem', { body: { code: 'nope' } })
    expect(res.status).toBe(404)
    // El código se normaliza a mayúsculas/trim antes de buscar.
    expect(query.mock.calls[0][1]).toEqual(['NOPE'])
  })

  it('409 si el conductor ya está vinculado a esa empresa', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 10, admin_id: 'admin-1', driver_id: null }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 99 }] }) // ya linkeado
    const res = await request(app, 'POST', '/redeem', { body: { code: 'ABC123' } })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/vinculado/)
  })

  it('canjea una invitación abierta creando un conductor nuevo (success)', async () => {
    query.mockImplementation((sql: string) => {
      if (/FROM driver_invitations\s+WHERE code/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 10, admin_id: 'admin-1', driver_id: null }] })
      }
      if (/FROM drivers WHERE app_user_id/.test(sql)) {
        return Promise.resolve({ rowCount: 0, rows: [] })
      }
      if (/INSERT INTO drivers/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 55 }] })
      }
      return Promise.resolve({ rowCount: 1, rows: [] }) // BEGIN / UPDATE / COMMIT
    })

    const res = await request(app, 'POST', '/redeem', {
      body: { code: 'abc123' },
      headers: { 'x-test-user': JSON.stringify({ id: 'driver-x', email: 'dx@t.com', user_metadata: { full_name: 'Diego' } }) },
    })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.driver_name).toBe('Diego')
    const sqls = query.mock.calls.map((c) => c[0] as string)
    expect(sqls).toContain('BEGIN')
    expect(sqls).toContain('COMMIT')
  })

  it('hace ROLLBACK y 500 si algo falla dentro de la transacción', async () => {
    query.mockImplementation((sql: string) => {
      if (/FROM driver_invitations\s+WHERE code/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 10, admin_id: 'admin-1', driver_id: null }] })
      }
      if (/FROM drivers WHERE app_user_id/.test(sql)) {
        return Promise.resolve({ rowCount: 0, rows: [] })
      }
      if (/INSERT INTO drivers/.test(sql)) {
        return Promise.reject(new Error('insert reventó'))
      }
      return Promise.resolve({ rowCount: 1, rows: [] })
    })

    const res = await request(app, 'POST', '/redeem', { body: { code: 'ABC123' } })
    expect(res.status).toBe(500)
    const sqls = query.mock.calls.map((c) => c[0] as string)
    expect(sqls).toContain('ROLLBACK')
  })
})

describe('DELETE /api/invitations/:id', () => {
  it('elimina una invitación pendiente (204)', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] })
    const res = await request(app, 'DELETE', '/7')
    expect(res.status).toBe(204)
  })

  it('404 si no existe o ya fue canjeada', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    const res = await request(app, 'DELETE', '/7')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/invitations/bulk', () => {
  it('genera la cantidad pedida de códigos', async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ code: 'XXXX', expires_at: '2099-01-01' }] })
    const res = await request(app, 'POST', '/bulk', { body: { quantity: 3 } })
    expect(res.status).toBe(201)
    expect(res.body).toHaveLength(3)
    expect(query).toHaveBeenCalledTimes(3)
  })

  it('topea la cantidad en 50', async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ code: 'X', expires_at: '2099-01-01' }] })
    const res = await request(app, 'POST', '/bulk', { body: { quantity: 999 } })
    expect(res.status).toBe(201)
    expect(query).toHaveBeenCalledTimes(50)
  })
})

describe('POST /api/invitations/register', () => {
  it('rechaza si faltan campos', async () => {
    const res = await request(app, 'POST', '/register', { body: { code: 'ABC' } })
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('rechaza contraseñas de menos de 6 caracteres', async () => {
    const res = await request(app, 'POST', '/register', {
      body: { code: 'ABC', email: 'a@b.com', password: '123', full_name: 'Ana' },
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/6 caracteres/)
  })

  it('404 si el código no es válido', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    const res = await request(app, 'POST', '/register', {
      body: { code: 'BAD', email: 'a@b.com', password: '123456', full_name: 'Ana' },
    })
    expect(res.status).toBe(404)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('409 si el email ya está registrado en Supabase', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, admin_id: 'admin-1', driver_id: null }] })
    createUserMock.mockResolvedValueOnce({ data: null, error: { message: 'User already registered' } })
    const res = await request(app, 'POST', '/register', {
      body: { code: 'ABC', email: 'dup@b.com', password: '123456', full_name: 'Ana' },
    })
    expect(res.status).toBe(409)
  })

  it('registra un conductor nuevo (success)', async () => {
    createUserMock.mockResolvedValueOnce({ data: { user: { id: 'new-uid', email: 'new@b.com' } }, error: null })
    query.mockImplementation((sql: string) => {
      if (/FROM driver_invitations\s+WHERE code/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 1, admin_id: 'admin-1', driver_id: null }] })
      }
      if (/INSERT INTO drivers/.test(sql)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 77 }] })
      }
      return Promise.resolve({ rowCount: 1, rows: [] })
    })

    const res = await request(app, 'POST', '/register', {
      body: { code: 'abc', email: 'New@B.com', password: '123456', full_name: ' Ana ' },
    })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.email).toBe('new@b.com')
    expect(createUserMock).toHaveBeenCalledOnce()
  })
})
