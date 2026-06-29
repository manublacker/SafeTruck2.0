import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/backend/db', () => ({ default: { query: vi.fn() } }))

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../../src/backend/supabaseClient', () => ({ supabase: { from: fromMock } }))

import trucksRouter from '../../src/backend/routes/trucks'
import pool from '../../src/backend/db'
import { appWith, request, fakeAuth } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
// El router de trucks no aplica auth por dentro (server.ts la pone antes),
// así que en el test inyectamos el usuario con fakeAuth.
const app = appWith(trucksRouter, fakeAuth)

/** Cadena de Supabase chainable y "thenable" (sirve para .single() y await). */
function supaChain(data: unknown) {
  const c: any = {
    select: () => c, eq: () => c, update: () => c,
    single: () => Promise.resolve({ data }),
    then: (resolve: (v: any) => void) => resolve({ data }),
  }
  return c
}

/** TruckRow completo (lo que devuelve TRUCK_BASE_SELECT). */
function truckRow(over: Record<string, unknown> = {}) {
  return {
    id: 1, name: 'Iveco', max_weight_kg: 20000, max_height_m: 4, max_width_m: 2.5,
    max_length_m: 12, patente: 'AC123', modelo: 'Stralis', anio: 2020, km_actual: 1000,
    fecha_service: null, proximo_service: null, estado: 'Activo', created_at: '2026-01-01',
    driver_id: null, driver_nombre: null, driver_telefono: null,
    ...over,
  }
}

beforeEach(() => {
  query.mockReset()
  fromMock.mockReset()
  fromMock.mockReturnValue(supaChain({ plan: 'starter' }))
})

describe('GET /api/trucks', () => {
  it('mapea las filas y arma el objeto driver cuando hay conductor', async () => {
    query.mockResolvedValueOnce({
      rows: [
        truckRow({ id: 1, driver_id: 5, driver_nombre: 'Juan', driver_telefono: '111' }),
        truckRow({ id: 2 }), // sin conductor
      ],
      rowCount: 2,
    })

    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(200)
    expect(res.body[0].driver).toEqual({ id: 5, nombre: 'Juan', telefono: '111' })
    expect(res.body[1].driver).toBeNull()
    // No expone las columnas crudas del join.
    expect(res.body[0]).not.toHaveProperty('driver_id')
  })

  it('500 si la DB falla', async () => {
    query.mockRejectedValueOnce(new Error('db'))
    const res = await request(app, 'GET', '/')
    expect(res.status).toBe(500)
  })
})

describe('POST /api/trucks', () => {
  it('400 si falta name', async () => {
    const res = await request(app, 'POST', '/', { body: { max_weight_kg: 1, max_height_m: 1, max_width_m: 1, max_length_m: 1 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name/)
  })

  it('400 si faltan dimensiones', async () => {
    const res = await request(app, 'POST', '/', { body: { name: 'X' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Dimensiones/)
  })

  it('400 si el estado es inválido', async () => {
    const res = await request(app, 'POST', '/', {
      body: { name: 'X', max_weight_kg: 1, max_height_m: 1, max_width_m: 1, max_length_m: 1, estado: 'Volando' },
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Estado inválido/)
  })

  it('crea el camión cuando está dentro del límite del plan (201)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 }) // COUNT actual
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 })     // INSERT RETURNING id
      .mockResolvedValueOnce({ rows: [truckRow({ id: 99 })], rowCount: 1 }) // SELECT creado

    const res = await request(app, 'POST', '/', {
      body: { name: 'Iveco', max_weight_kg: 20000, max_height_m: 4, max_width_m: 2.5, max_length_m: 12 },
    })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(99)
    expect(res.body.driver).toBeNull()
  })

  it('403 si ya alcanzó el límite de camiones del plan', async () => {
    // plan starter = 5; ya tiene 5.
    query.mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1 })
    const res = await request(app, 'POST', '/', {
      body: { name: 'Iveco', max_weight_kg: 20000, max_height_m: 4, max_width_m: 2.5, max_length_m: 12 },
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/plan starter/)
  })
})

describe('PATCH /api/trucks/:id', () => {
  it('400 si el id no es numérico', async () => {
    const res = await request(app, 'PATCH', '/abc', { body: { name: 'X' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/id de camión/)
  })

  it('400 si no hay campos para actualizar', async () => {
    const res = await request(app, 'PATCH', '/1', { body: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Sin campos/)
  })

  it('400 si el estado es inválido', async () => {
    const res = await request(app, 'PATCH', '/1', { body: { estado: 'Volando' } })
    expect(res.status).toBe(400)
  })

  it('404 si el camión no es del usuario', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // owner check vacío
    const res = await request(app, 'PATCH', '/1', { body: { name: 'Nuevo' } })
    expect(res.status).toBe(404)
  })

  it('actualiza y devuelve el camión mapeado', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })          // owner ok
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                   // UPDATE
      .mockResolvedValueOnce({ rows: [truckRow({ name: 'Nuevo' })], rowCount: 1 }) // SELECT

    const res = await request(app, 'PATCH', '/1', { body: { name: 'Nuevo' } })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Nuevo')
  })
})

describe('DELETE /api/trucks/:id', () => {
  it('400 si el id no es numérico', async () => {
    const res = await request(app, 'DELETE', '/xyz')
    expect(res.status).toBe(400)
  })

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

describe('POST /api/trucks/bulk', () => {
  it('400 si el template es inválido', async () => {
    const res = await request(app, 'POST', '/bulk', { body: { template: 'spaceship', quantity: 2, name_prefix: 'C' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/template/)
  })

  it('400 si quantity está fuera de 1..10', async () => {
    const res = await request(app, 'POST', '/bulk', { body: { template: 'standard', quantity: 50, name_prefix: 'C' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/quantity/)
  })

  it('400 si falta name_prefix', async () => {
    const res = await request(app, 'POST', '/bulk', { body: { template: 'standard', quantity: 2 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name_prefix/)
  })

  it('crea N camiones desde la plantilla (201)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 }) // COUNT
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'C 1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 2, name: 'C 2' }], rowCount: 1 })

    const res = await request(app, 'POST', '/bulk', { body: { template: 'standard', quantity: 2, name_prefix: 'C' } })
    expect(res.status).toBe(201)
    expect(res.body).toHaveLength(2)
  })

  it('403 si supera el límite del plan', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '4' }], rowCount: 1 }) // 4 + 5 > 5
    const res = await request(app, 'POST', '/bulk', { body: { template: 'standard', quantity: 5, name_prefix: 'C' } })
    expect(res.status).toBe(403)
  })
})
