import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/backend/db', () => ({ default: { query: vi.fn() } }))

// Middlewares falsos: el authMiddleware/requireActiveSubscription reales tienen
// sus propios tests. Acá sólo nos interesa la lógica del handler.
vi.mock('../../src/backend/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    const raw = req.headers['x-test-user']
    req.user = raw ? JSON.parse(raw) : { id: 'driver-9', email: 'driver@test.com', user_metadata: {} }
    next()
  },
}))
vi.mock('../../src/backend/middleware/requireActiveSubscription', () => ({
  requireActiveSubscription: (_req: any, _res: any, next: any) => next(),
}))

import pushRouter from '../../src/backend/routes/push-tokens'
import pool from '../../src/backend/db'
import { appWith, request } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
const app = appWith(pushRouter)

beforeEach(() => query.mockReset())

describe('POST /api/push-tokens', () => {
  it('rechaza si falta el token', async () => {
    const res = await request(app, 'POST', '/', { body: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/token requerido/)
    expect(query).not.toHaveBeenCalled()
  })

  it('rechaza si el token no es string', async () => {
    const res = await request(app, 'POST', '/', { body: { token: 12345 } })
    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('guarda el token y devuelve success', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const res = await request(app, 'POST', '/', {
      body: { token: 'ExponentPushToken[abc]' },
      headers: { 'x-test-user': JSON.stringify({ id: 'driver-77', email: 'd@t.com', user_metadata: {} }) },
    })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // El upsert se hace con (driverUserId, token).
    expect(query.mock.calls[0][1]).toEqual(['driver-77', 'ExponentPushToken[abc]'])
  })

  it('500 si la DB falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app, 'POST', '/', { body: { token: 'tok' } })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('boom')
  })
})
