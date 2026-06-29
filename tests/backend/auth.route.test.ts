import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/backend/db', () => ({ default: { query: vi.fn() } }))
vi.mock('../../src/backend/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}))
vi.mock('../../src/backend/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    const raw = req.headers['x-test-user']
    req.user = raw
      ? JSON.parse(raw)
      : { id: 'u1', email: 'u1@test.com', user_metadata: { full_name: 'Usuario Uno', company: 'ACME' } }
    next()
  },
}))

import authRouter from '../../src/backend/routes/auth'
import { appWith, request } from './_http'

const app = appWith(authRouter)

describe('GET /api/auth/me', () => {
  it('devuelve el perfil del usuario autenticado + el token', async () => {
    const res = await request(app, 'GET', '/me', {
      headers: { authorization: 'Bearer my-token-123' },
    })

    expect(res.status).toBe(200)
    expect(res.body.token).toBe('my-token-123')
    expect(res.body.user).toMatchObject({
      id: 'u1',
      email: 'u1@test.com',
      full_name: 'Usuario Uno',
      company: 'ACME',
    })
    expect(res.body.user.trucks).toEqual([])
  })

  it('devuelve full_name/company en null si no están en el metadata', async () => {
    const res = await request(app, 'GET', '/me', {
      headers: {
        authorization: 'Bearer t',
        'x-test-user': JSON.stringify({ id: 'u2', email: 'u2@test.com', user_metadata: {} }),
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.user.full_name).toBeNull()
    expect(res.body.user.company).toBeNull()
  })
})
