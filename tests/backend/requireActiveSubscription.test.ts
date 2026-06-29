import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Request, Response } from 'express'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../../src/backend/supabaseClient', () => ({ supabase: { from: fromMock } }))
vi.mock('../../src/backend/db', () => ({ default: { query: vi.fn() } }))

import { requireActiveSubscription } from '../../src/backend/middleware/requireActiveSubscription'
import pool from '../../src/backend/db'

const query = pool.query as unknown as ReturnType<typeof vi.fn>

/** Cadena chainable de Supabase que termina en maybeSingle resolviendo {data}. */
function chain(data: unknown) {
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c
  c.maybeSingle = () => Promise.resolve({ data })
  return c
}
function rejectingChain() {
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c
  c.maybeSingle = () => Promise.reject(new Error('supabase caído'))
  return c
}

function makeCtx(method: string, userId = 'user-1') {
  const req = { method, user: { id: userId } } as unknown as Request
  let statusCode = 0
  let jsonBody: any = null
  const res = {
    status(code: number) { statusCode = code; return this },
    json(body: any) { jsonBody = body; return this },
  } as unknown as Response
  const next = vi.fn()
  return { req, res, next, get status() { return statusCode }, get body() { return jsonBody } }
}

beforeEach(() => {
  fromMock.mockReset()
  query.mockReset()
})
afterEach(() => {
  delete process.env.BYPASS_SUBSCRIPTION
})

describe('requireActiveSubscription', () => {
  it('deja pasar cualquier GET sin tocar la DB (lecturas nunca se bloquean)', async () => {
    const ctx = makeCtx('GET')
    await requireActiveSubscription(ctx.req, ctx.res, ctx.next)
    expect(ctx.next).toHaveBeenCalledOnce()
    expect(fromMock).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('deja pasar si BYPASS_SUBSCRIPTION=true (dev local)', async () => {
    process.env.BYPASS_SUBSCRIPTION = 'true'
    const ctx = makeCtx('POST')
    await requireActiveSubscription(ctx.req, ctx.res, ctx.next)
    expect(ctx.next).toHaveBeenCalledOnce()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('deja pasar si el propio usuario tiene suscripción activa', async () => {
    fromMock.mockReturnValueOnce(chain({ status: 'active' }))
    const ctx = makeCtx('POST')
    await requireActiveSubscription(ctx.req, ctx.res, ctx.next)
    expect(ctx.next).toHaveBeenCalledOnce()
  })

  it('deja pasar a un conductor si el admin que lo invitó tiene suscripción', async () => {
    fromMock
      .mockReturnValueOnce(chain(null))             // el conductor no tiene sub propia
      .mockReturnValueOnce(chain({ status: 'active' })) // pero su admin sí
    query.mockResolvedValueOnce({ rows: [{ user_id: 'admin-x' }], rowCount: 1 }) // adminOf

    const ctx = makeCtx('POST', 'driver-1')
    await requireActiveSubscription(ctx.req, ctx.res, ctx.next)
    expect(ctx.next).toHaveBeenCalledOnce()
  })

  it('402 si ni el usuario ni su admin tienen suscripción', async () => {
    fromMock.mockReturnValueOnce(chain(null))
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // sin admin

    const ctx = makeCtx('POST', 'driver-2')
    await requireActiveSubscription(ctx.req, ctx.res, ctx.next)
    expect(ctx.next).not.toHaveBeenCalled()
    expect(ctx.status).toBe(402)
    expect(ctx.body.error).toBe('subscription_required')
  })

  it('402 si el usuario tiene admin pero el admin tampoco paga', async () => {
    fromMock
      .mockReturnValueOnce(chain(null)) // conductor
      .mockReturnValueOnce(chain(null)) // admin tampoco
    query.mockResolvedValueOnce({ rows: [{ user_id: 'admin-y' }], rowCount: 1 })

    const ctx = makeCtx('POST', 'driver-3')
    await requireActiveSubscription(ctx.req, ctx.res, ctx.next)
    expect(ctx.status).toBe(402)
  })

  it('500 si Supabase falla', async () => {
    fromMock.mockReturnValueOnce(rejectingChain())
    const ctx = makeCtx('POST')
    await requireActiveSubscription(ctx.req, ctx.res, ctx.next)
    expect(ctx.status).toBe(500)
    expect(ctx.next).not.toHaveBeenCalled()
  })
})
