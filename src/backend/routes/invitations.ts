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

// POST / — Admin genera un código de invitación (no requiere driver existente)
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const adminId = req.user!.id
  const { hint_name } = req.body   // nombre opcional solo como referencia

  try {
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const result = await pool.query(
      `INSERT INTO driver_invitations (code, admin_id, hint_name, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [code, adminId, hint_name?.trim() || null, expiresAt]
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
      `SELECT i.*, d.nombre AS driver_nombre
       FROM driver_invitations i
       LEFT JOIN drivers d ON d.id = i.driver_id
       WHERE i.admin_id = $1
       ORDER BY i.created_at DESC LIMIT 50`,
      [adminId]
    )
    res.json(result.rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /redeem — Conductor canjea el código
// Al canjear: si no hay driver vinculado, se crea uno nuevo con sus datos del perfil
router.post('/redeem', authMiddleware, async (req: Request, res: Response) => {
  const driverUserId = req.user!.id
  const driverEmail  = req.user!.email
  const driverName   = (req.user!.user_metadata?.full_name as string) || driverEmail
  const { code } = req.body

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code requerido' })
  }

  try {
    // Verificar que este usuario no esté ya vinculado a otro conductor del mismo admin
    const invRes = await pool.query(
      `SELECT * FROM driver_invitations
       WHERE code = $1 AND redeemed_at IS NULL AND expires_at > NOW()`,
      [code.toUpperCase().trim()]
    )
    if (!invRes.rowCount) {
      return res.status(404).json({ error: 'Código inválido o vencido' })
    }
    const invitation = invRes.rows[0]
    const adminId = invitation.admin_id

    // Verificar que este conductor no esté ya vinculado a esta empresa
    const existingLink = await pool.query(
      'SELECT id FROM drivers WHERE app_user_id = $1 AND user_id = $2',
      [driverUserId, adminId]
    )
    if (existingLink.rowCount) {
      return res.status(409).json({ error: 'Ya estás vinculado a esta empresa' })
    }

    await pool.query('BEGIN')
    try {
      let driverId: number

      if (invitation.driver_id) {
        // Invitación ligada a un conductor existente → solo linkeamos
        await pool.query(
          'UPDATE drivers SET app_user_id = $1, updated_at = NOW() WHERE id = $2',
          [driverUserId, invitation.driver_id]
        )
        driverId = invitation.driver_id
      } else {
        // Invitación abierta → crear nuevo conductor con datos del registro
        const insertRes = await pool.query<{ id: number }>(
          `INSERT INTO drivers (user_id, nombre, estado, app_user_id)
           VALUES ($1, $2, 'Activo', $3)
           RETURNING id`,
          [adminId, driverName, driverUserId]
        )
        driverId = insertRes.rows[0].id

        // Actualizar la invitación con el driver_id recién creado
        await pool.query(
          'UPDATE driver_invitations SET driver_id = $1 WHERE id = $2',
          [driverId, invitation.id]
        )
      }

      // Marcar invitación como canjeada
      await pool.query(
        'UPDATE driver_invitations SET redeemed_at = NOW(), redeemed_by = $1 WHERE id = $2',
        [driverUserId, invitation.id]
      )

      // Backfill viajes pendientes si los hay
      await pool.query(
        `UPDATE assigned_trips SET driver_app_user_id = $1
         WHERE driver_id = $2 AND driver_app_user_id IS NULL
           AND status IN ('pending', 'accepted')`,
        [driverUserId, driverId]
      )

      await pool.query('COMMIT')
      res.json({ success: true, driver_name: driverName })
    } catch (e) {
      await pool.query('ROLLBACK')
      throw e
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /bulk — Admin genera códigos en masa (sin drivers existentes)
router.post('/bulk', authMiddleware, async (req: Request, res: Response) => {
  const adminId = req.user!.id
  const { quantity = 1 } = req.body

  const qty = Math.min(Number(quantity) || 1, 50)

  try {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const results = []

    for (let i = 0; i < qty; i++) {
      const code = generateCode()
      const r = await pool.query(
        `INSERT INTO driver_invitations (code, admin_id, expires_at)
         VALUES ($1, $2, $3) RETURNING code, expires_at`,
        [code, adminId, expiresAt]
      )
      results.push({ code: r.rows[0].code, expires_at: r.rows[0].expires_at })
    }

    res.status(201).json(results)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
