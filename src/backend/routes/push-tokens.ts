import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/authMiddleware'
import pool from '../db'

const router = Router()
router.use(authMiddleware)

// POST / — Conductor registra su Expo push token
router.post('/', async (req: Request, res: Response) => {
  const driverUserId = req.user!.id
  const { token } = req.body

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token requerido' })
  }

  try {
    await pool.query(
      `INSERT INTO push_tokens (driver_app_user_id, token, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (driver_app_user_id) DO UPDATE SET token = EXCLUDED.token, updated_at = NOW()`,
      [driverUserId, token]
    )
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
