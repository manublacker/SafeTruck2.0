import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/backend/db', () => ({ default: { query: vi.fn() } }))

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../../src/backend/supabaseClient', () => ({ supabase: { from: fromMock } }))

import driversRouter from '../../src/backend/routes/drivers'
import pool from '../../src/backend/db'
import { appWith, request, fakeAuth, asUser } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
const app = appWith(driversRouter, fakeAuth)

/** Supabase chainable + thenable (para el update().eq() de syncPhoneToProfile). */
function supaChain(data: unknown = null) {
  const c: any = {
    select: () => c, eq: () => c, update: () => c,
    single: () => Promise.resolve({ data }),
    then: (resolve: (v: any) => void) => resolve({ data }),
  }
  return c
}

function driverRow(over: Record<string, unknown> = {}) {
  return {
    id: 1, user_id: 'admin-1', app_user_id: null, nombre: 'Juan',
    telefono: '111', estado: 'Activo', is_active: true, created_at: '2026-01-01',
    ...over,
  }
}

beforeEach(() => {
  query.mockReset()
  fromMock.mockReset()
  fromMock.mockReturnValue(supaChain(null))
})

describe('GET /api/drivers', () => {
  it('lista los conductores activos del usuario', async () => {
    query.mockResolvedValueOnce({ rows: [driverRow(), driverRow({ id: 2, nombre: 'Ana' })], rowCount: 2 })
    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(query.mock.calls[0][1]).toEqual(['admin-1'])
  })

  it('500 si la DB falla', async () => {
    query.mockRejectedValueOnce(new Error('db'))
    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(500)
  })
})

describe('POST /api/drivers', () => {
  it('400 si falta nombre', async () => {
    const res = await request(app, 'POST', '/', { body: { telefono: '111' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/nombre/)
  })

  it('400 si el estado es inválido', async () => {
    const res = await request(app, 'POST', '/', { body: { nombre: 'Juan', estado: 'Durmiendo' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Estado inválido/)
  })

  it('crea el conductor (201)', async () => {
    query.mockResolvedValueOnce({ rows: [driverRow()], rowCount: 1 })
    const res = await request(app, 'POST', '/', { body: { nombre: 'Juan', telefono: '111' } })
    expect(res.status).toBe(201)
    expect(res.body.nombre).toBe('Juan')
  })
})

describe('PATCH /api/drivers/:id', () => {
  it('400 si el id no es numérico', async () => {
    const res = await request(app, 'PATCH', '/abc', { body: { nombre: 'X' } })
    expect(res.status).toBe(400)
  })

  it('400 si no hay campos', async () => {
    const res = await request(app, 'PATCH', '/1', { body: {} })
    expect(res.status).toBe(400)
  })

  it('404 si el conductor no es del usuario', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'PATCH', '/1', { body: { nombre: 'X' } })
    expect(res.status).toBe(404)
  })

  it('actualiza y devuelve el conductor', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })                 // owner
      .mockResolvedValueOnce({ rows: [driverRow({ nombre: 'Pedro' })], rowCount: 1 }) // UPDATE RETURNING
    const res = await request(app, 'PATCH', '/1', { body: { nombre: 'Pedro' } })
    expect(res.status).toBe(200)
    expect(res.body.nombre).toBe('Pedro')
  })
})

describe('DELETE /api/drivers/:id', () => {
  it('404 si no existe', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'DELETE', '/1')
    expect(res.status).toBe(404)
  })

  it('204 en soft delete exitoso', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const res = await request(app, 'DELETE', '/1')
    expect(res.status).toBe(204)
  })
})

describe('GET /api/drivers/me', () => {
  it('devuelve el perfil del conductor logueado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Juan', telefono: '111', estado: 'Activo' }], rowCount: 1 })
    const res = await request(app, 'GET', '/me', { headers: asUser({ id: 'driver-1', email: 'd@t.com', user_metadata: {} }) })
    expect(res.status).toBe(200)
    expect(res.body.nombre).toBe('Juan')
    expect(query.mock.calls[0][1]).toEqual(['driver-1'])
  })

  it('devuelve null si no hay conductor vinculado', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'GET', '/me')
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })
})

describe('GET /api/drivers/me/truck', () => {
  it('devuelve el camión asignado al conductor', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7, name: 'Iveco', patente: 'AC123' }], rowCount: 1 })
    const res = await request(app, 'GET', '/me/truck')
    expect(res.status).toBe(200)
    expect(res.body.patente).toBe('AC123')
  })

  it('devuelve null si no tiene camión', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'GET', '/me/truck')
    expect(res.body).toBeNull()
  })
})

describe('PATCH /api/drivers/me', () => {
  // Antes esta ruta estaba "tapada" por PATCH /:id (id="me" → NaN → 400). Se
  // reordenó drivers.ts para declarar las rutas literales /me ANTES que /:id,
  // así que ahora el handler propio del conductor sí se ejecuta.
  it('400 si no manda campos permitidos (estado no se puede editar acá)', async () => {
    const res = await request(app, 'PATCH', '/me', { body: { estado: 'Activo' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Sin campos/)
    expect(query).not.toHaveBeenCalled()
  })

  it('404 si el usuario no está vinculado a un conductor', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app, 'PATCH', '/me', {
      body: { nombre: 'Nuevo' },
      headers: asUser({ id: 'driver-1', email: 'd@t.com', user_metadata: {} }),
    })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/No estás vinculado/)
  })

  it('actualiza nombre/telefono propios (200)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 })                                  // existing
      .mockResolvedValueOnce({ rows: [{ id: 3, nombre: 'Nuevo', telefono: '999', estado: 'Activo' }], rowCount: 1 })
    const res = await request(app, 'PATCH', '/me', {
      body: { nombre: 'Nuevo', telefono: '999' },
      headers: asUser({ id: 'driver-1', email: 'd@t.com', user_metadata: {} }),
    })
    expect(res.status).toBe(200)
    expect(res.body.nombre).toBe('Nuevo')
    // Filtra por el conductor vinculado (app_user_id), no por admin user_id.
    expect(query.mock.calls[0][1]).toEqual(['driver-1'])
  })
})
