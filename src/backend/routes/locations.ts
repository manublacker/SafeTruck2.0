import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/authMiddleware'
import { requireActiveSubscription } from '../middleware/requireActiveSubscription'
import pool from '../db'

const router = Router()
router.use(authMiddleware)
router.use(requireActiveSubscription)

// GET / — Admin obtiene todas las ubicaciones activas (para el live map)
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT driver_app_user_id, driver_name, truck_plate, lat, lng, updated_at
       FROM driver_locations
       WHERE updated_at > NOW() - INTERVAL '5 minutes'`
    )
    res.json(result.rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST / — Conductor actualiza su posición GPS
router.post('/', async (req: Request, res: Response) => {
  const driverUserId = req.user!.id
  const { lat, lng, trip_id, driver_name, truck_plate } = req.body

  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat y lng requeridos' })
  }

  try {
    await pool.query(
      `INSERT INTO driver_locations (driver_app_user_id, trip_id, driver_name, truck_plate, lat, lng, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (driver_app_user_id) DO UPDATE
         SET trip_id = EXCLUDED.trip_id,
             driver_name = EXCLUDED.driver_name,
             truck_plate = EXCLUDED.truck_plate,
             lat = EXCLUDED.lat,
             lng = EXCLUDED.lng,
             updated_at = NOW()`,
      [driverUserId, trip_id ?? null, driver_name ?? null, truck_plate ?? null, lat, lng]
    )
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE / — Conductor se desconecta
router.delete('/', async (req: Request, res: Response) => {
  const driverUserId = req.user!.id
  try {
    await pool.query(
      'DELETE FROM driver_locations WHERE driver_app_user_id = $1',
      [driverUserId]
    )
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
