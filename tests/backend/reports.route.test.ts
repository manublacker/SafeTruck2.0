import { describe, it, expect, vi, beforeEach } from 'vitest'

// La DB se mockea ANTES de importar el router (vi.mock se "hoistea" al tope).
// Así el router usa este pool falso y nunca toca Postgres.
vi.mock('../../src/backend/db', () => ({
  default: { query: vi.fn() },
}))

import reportsRouter from '../../src/backend/routes/reports'
import pool from '../../src/backend/db'
import { appWith, request } from './_http'

const query = pool.query as unknown as ReturnType<typeof vi.fn>
const app = appWith(reportsRouter)

beforeEach(() => {
  query.mockReset()
})

describe('POST /api/reports (legacy)', () => {
  describe('validación de entrada', () => {
    it('rechaza si falta report_type', async () => {
      const res = await request(app, 'POST', '/', { body: { arista_id: 1 } })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/report_type/)
      expect(query).not.toHaveBeenCalled()
    })

    it('rechaza un report_type inválido', async () => {
      const res = await request(app, 'POST', '/', {
        body: { report_type: 'cualquier_cosa', arista_id: 1 },
      })
      expect(res.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('acepta los dos report_type válidos', () => {
      // Sanity: el endpoint sólo conoce estos dos tipos.
      for (const t of ['multa', 'sin_problemas']) {
        expect(['multa', 'sin_problemas']).toContain(t)
      }
    })

    it('rechaza si no hay arista_id ni lat/lon', async () => {
      const res = await request(app, 'POST', '/', { body: { report_type: 'multa' } })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/arista_id|lat\/lon/)
      expect(query).not.toHaveBeenCalled()
    })
  })

  describe('camino feliz', () => {
    it('con arista_id directo: inserta y registra el reporte (201)', async () => {
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT street_reports
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // SELECT registrar_reporte

      const res = await request(app, 'POST', '/', {
        body: { report_type: 'multa', arista_id: 42, notes: 'control' },
      })

      expect(res.status).toBe(201)
      expect(res.body.ok).toBe(true)
      expect(res.body.arista_id).toBe(42)
      // No debería snapear porque vino arista_id directo.
      expect(query).toHaveBeenCalledTimes(2)
      expect(query.mock.calls[0][0]).toMatch(/INSERT INTO street_reports/)
      expect(query.mock.calls[1][0]).toMatch(/registrar_reporte/)
    })

    it('con lat/lon: snapea a la arista más cercana y usa ese id', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 }) // snap-to-edge
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })          // INSERT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })          // registrar_reporte

      const res = await request(app, 'POST', '/', {
        body: { report_type: 'sin_problemas', lat: -34.6, lon: -58.4 },
      })

      expect(res.status).toBe(201)
      expect(res.body.arista_id).toBe(7)
      expect(query.mock.calls[0][0]).toMatch(/ORDER BY a\.geom/)
    })
  })

  describe('casos de error', () => {
    it('404 si no encuentra calle cercana al punto', async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // snap sin resultados

      const res = await request(app, 'POST', '/', {
        body: { report_type: 'multa', lat: -34.6, lon: -58.4 },
      })

      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/calle cercana/)
    })

    it('acepta coordenadas en 0 (no las trata como faltantes)', async () => {
      // Fix: la validación usa `== null`, así que lat/lon = 0 son válidas y la
      // ruta llega a snapear (antes cortaba en 400 por `!lat`).
      query
        .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 }) // snap
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })          // INSERT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })          // registrar_reporte

      const res = await request(app, 'POST', '/', {
        body: { report_type: 'multa', lat: 0, lon: 0 },
      })

      expect(res.status).toBe(201)
      expect(res.body.arista_id).toBe(3)
    })

    it('500 si la DB falla', async () => {
      query.mockRejectedValueOnce(new Error('db caída'))

      const res = await request(app, 'POST', '/', {
        body: { report_type: 'multa', arista_id: 1 },
      })

      expect(res.status).toBe(500)
      expect(res.body.error).toMatch(/interno/i)
    })
  })
})
