import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

// Mockeamos sólo el cliente de Supabase: probamos el middleware REAL.
const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))
vi.mock('../../src/backend/supabaseClient', () => ({
  supabase: { auth: { getUser: getUserMock } },
}))

import { authMiddleware } from '../../src/backend/middleware/authMiddleware'

/** Arma un (req, res, next) falso para invocar el middleware sin HTTP. */
function makeCtx(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request
  let statusCode = 0
  let jsonBody: any = null
  const res = {
    status(code: number) { statusCode = code; return this },
    json(body: any) { jsonBody = body; return this },
  } as unknown as Response
  const next = vi.fn()
  return {
    req, res, next,
    get status() { return statusCode },
    get body() { return jsonBody },
  }
}

beforeEach(() => getUserMock.mockReset())

describe('authMiddleware', () => {
  it('401 si no hay header Authorization', async () => {
    const ctx = makeCtx({})
    await authMiddleware(ctx.req, ctx.res, ctx.next)
    expect(ctx.status).toBe(401)
    expect(ctx.body.error).toMatch(/Token requerido/)
    expect(ctx.next).not.toHaveBeenCalled()
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('401 si el header no empieza con "Bearer "', async () => {
    const ctx = makeCtx({ authorization: 'Basic abc' })
    await authMiddleware(ctx.req, ctx.res, ctx.next)
    expect(ctx.status).toBe(401)
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it('401 si Supabase devuelve error', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad token' } })
    const ctx = makeCtx({ authorization: 'Bearer xxx' })
    await authMiddleware(ctx.req, ctx.res, ctx.next)
    expect(ctx.status).toBe(401)
    expect(ctx.body.error).toMatch(/inválido o expirado/)
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it('401 si no hay usuario aunque no haya error', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null })
    const ctx = makeCtx({ authorization: 'Bearer xxx' })
    await authMiddleware(ctx.req, ctx.res, ctx.next)
    expect(ctx.status).toBe(401)
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it('llama a next() y popula req.user con un token válido', async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'u1@test.com', user_metadata: { role: 'admin' } } },
      error: null,
    })
    const ctx = makeCtx({ authorization: 'Bearer good-token' })
    await authMiddleware(ctx.req, ctx.res, ctx.next)

    expect(ctx.next).toHaveBeenCalledOnce()
    expect((ctx.req as any).user).toEqual({
      id: 'u1',
      email: 'u1@test.com',
      user_metadata: { role: 'admin' },
    })
    // Pasa el token (sin el "Bearer ") a Supabase.
    expect(getUserMock).toHaveBeenCalledWith('good-token')
  })

  it('usa {} si el usuario no trae user_metadata', async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: 'u2', email: 'u2@test.com' } },
      error: null,
    })
    const ctx = makeCtx({ authorization: 'Bearer t' })
    await authMiddleware(ctx.req, ctx.res, ctx.next)
    expect((ctx.req as any).user.user_metadata).toEqual({})
  })
})
