import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/backend/db', () => ({ default: { query: vi.fn() } }))

import usersRouter from '../../src/backend/routes/users'
import pool from '../../src/backend/db'
import { appWith, request, fakeAuth } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
// Sin auth: el router se monta en server.ts sin authMiddleware, así que el
// propio handler chequea req.user. Probamos ambos escenarios.
const appNoAuth = appWith(usersRouter)
const appAuth = appWith(usersRouter, fakeAuth)

beforeEach(() => query.mockReset())

describe('POST /api/users/push-token', () => {
  it('400 si falta push_token (se valida antes que el usuario)', async () => {
    const res = await request(appNoAuth, 'POST', '/push-token', { body: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/push_token/)
    expect(query).not.toHaveBeenCalled()
  })

  it('401 si hay push_token pero no hay usuario autenticado', async () => {
    const res = await request(appNoAuth, 'POST', '/push-token', { body: { push_token: 'tok' } })
    expect(res.status).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('guarda el token del usuario autenticado (200)', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const res = await request(appAuth, 'POST', '/push-token', { body: { push_token: 'tok-123' } })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(query.mock.calls[0][1]).toEqual(['tok-123', 'admin-1'])
  })

  it('500 si la DB falla', async () => {
    query.mockRejectedValueOnce(new Error('db'))
    const res = await request(appAuth, 'POST', '/push-token', { body: { push_token: 'tok' } })
    expect(res.status).toBe(500)
  })
})
