import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/authMiddleware'
import pool from '../db'

const router = Router()

function generateCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < length; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

// POST / — Admin genera código de invitación para un conductor
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const adminId = req.user!.id
  const { driver_id } = req.body

  if (!driver_id) {
    return res.status(400).json({ error: 'driver_id requerido' })
  }

  try {
    const driverRes = await pool.query<{ nombre: string }>(
      'SELECT nombre FROM drivers WHERE id = $1 AND user_id = $2 AND is_active = true',
      [driver_id, adminId]
    )
    if (!driverRes.rowCount) {
      return res.status(404).json({ error: 'Conductor no encontrado' })
    }

    // Invalidar códigos anteriores del mismo conductor
    await pool.query(
      `UPDATE driver_invitations SET redeemed_at = NOW()
       WHERE admin_id = $1 AND driver_id = $2 AND redeemed_at IS NULL`,
      [adminId, driver_id]
    )

    const code = generateCode()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const result = await pool.query(
      `INSERT INTO driver_invitations (code, admin_id, driver_id, driver_name, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [code, adminId, driver_id, driverRes.rows[0].nombre, expiresAt]
    )

    res.status(201).json({ success: true, invitation: result.rows[0] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET / — Admin lista sus invitaciones
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  const adminId = req.user!.id
  try {
    const result = await pool.query(
      `SELECT * FROM driver_invitations WHERE admin_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [adminId]
    )
    res.json(result.rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /redeem — Conductor canjea un código (envía su Supabase JWT)
router.post('/redeem', authMiddleware, async (req: Request, res: Response) => {
  const driverUserId = req.user!.id
  const { code } = req.body

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code requerido' })
  }

  try {
    const invRes = await pool.query(
      `SELECT * FROM driver_invitations
       WHERE code = $1 AND redeemed_at IS NULL AND expires_at > NOW()`,
      [code.toUpperCase().trim()]
    )
    if (!invRes.rowCount) {
      return res.status(404).json({ error: 'Código inválido o vencido' })
    }
    const invitation = invRes.rows[0]

    // Verificar si ya está vinculado
    const existingRes = await pool.query<{ app_user_id: string | null }>(
      'SELECT app_user_id FROM drivers WHERE id = $1',
      [invitation.driver_id]
    )
    if (existingRes.rows[0]?.app_user_id) {
      return res.status(409).json({ error: 'Este conductor ya está vinculado a la app' })
    }

    await pool.query('BEGIN')
    try {
      await pool.query(
        `UPDATE driver_invitations SET redeemed_at = NOW(), redeemed_by = $1 WHERE id = $2`,
        [driverUserId, invitation.id]
      )
      await pool.query(
        'UPDATE drivers SET app_user_id = $1, updated_at = NOW() WHERE id = $2',
        [driverUserId, invitation.driver_id]
      )
      // Backfill viajes pendientes
      await pool.query(
        `UPDATE assigned_trips SET driver_app_user_id = $1
         WHERE driver_id = $2 AND driver_app_user_id IS NULL
           AND status IN ('pending', 'accepted')`,
        [driverUserId, invitation.driver_id]
      )
      await pool.query('COMMIT')
    } catch (e) {
      await pool.query('ROLLBACK')
      throw e
    }

    res.json({ success: true, driver_name: invitation.driver_name })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /bulk — Admin genera códigos para múltiples conductores a la vez
router.post('/bulk', authMiddleware, async (req: Request, res: Response) => {
  const adminId = req.user!.id
  const { driver_ids } = req.body

  if (!Array.isArray(driver_ids) || driver_ids.length === 0) {
    return res.status(400).json({ error: 'driver_ids requerido (array)' })
  }
  if (driver_ids.length > 50) {
    return res.status(400).json({ error: 'Máximo 50 conductores por vez' })
  }

  try {
    const driversRes = await pool.query<{ id: number; nombre: string }>(
      `SELECT id, nombre FROM drivers WHERE id = ANY($1) AND user_id = $2 AND is_active = true`,
      [driver_ids, adminId]
    )
    if (!driversRes.rowCount) {
      return res.status(404).json({ error: 'No se encontraron conductores válidos' })
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const results: { driver_id: number; driver_name: string; code: string; expires_at: string }[] = []

    for (const driver of driversRes.rows) {
      // Invalida códigos anteriores
      await pool.query(
        `UPDATE driver_invitations SET redeemed_at = NOW()
         WHERE admin_id = $1 AND driver_id = $2 AND redeemed_at IS NULL`,
        [adminId, driver.id]
      )
      const code = generateCode()
      await pool.query(
        `INSERT INTO driver_invitations (code, admin_id, driver_id, driver_name, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [code, adminId, driver.id, driver.nombre, expiresAt]
      )
      results.push({ driver_id: driver.id, driver_name: driver.nombre, code, expires_at: expiresAt.toISOString() })
    }

    res.status(201).json(results)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
