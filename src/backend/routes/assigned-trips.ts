import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/authMiddleware'
import pool from '../db'

const router = Router()
router.use(authMiddleware)

// POST / — Admin crea un viaje asignado y notifica al conductor
router.post('/', async (req: Request, res: Response) => {
  const adminId = req.user!.id
  const {
    driver_id,
    truck_id,
    origin_address,
    destination_address,
    origin_lat,
    origin_lng,
    destination_lat,
    destination_lng,
    route,
    scheduled_at,
  } = req.body

  if (!driver_id) {
    return res.status(400).json({ error: 'driver_id requerido' })
  }

  try {
    const driverRes = await pool.query<{ nombre: string; app_user_id: string | null }>(
      'SELECT nombre, app_user_id FROM drivers WHERE id = $1 AND user_id = $2 AND is_active = true',
      [driver_id, adminId]
    )
    if (!driverRes.rowCount) {
      return res.status(404).json({ error: 'Conductor no encontrado' })
    }
    const driver = driverRes.rows[0]

    // Calcular distance_m y duration_min desde la ruta si vienen
    const distanceM  = (route as any)?.distanceM ?? null
    const durationMin = (route as any)?.estimatedDurationMin ?? null

    const result = await pool.query<{ id: number }>(
      `INSERT INTO assigned_trips (
         empresa_user_id, driver_id, driver_app_user_id, truck_id,
         origin_label, destination_label,
         origin_lat, origin_lon, destination_lat, destination_lon,
         path, distance_m, duration_min, scheduled_at, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending')
       RETURNING id`,
      [
        adminId,
        driver_id,
        driver.app_user_id ?? null,
        truck_id ?? null,
        origin_address ?? null,
        destination_address ?? null,
        origin_lat ?? null,
        origin_lng ?? null,
        destination_lat ?? null,
        destination_lng ?? null,
        route ? JSON.stringify(route) : null,
        distanceM,
        durationMin,
        scheduled_at ?? null,
      ]
    )

    const tripId = result.rows[0].id

    if (driver.app_user_id) {
      sendPushNotification(
        driver.app_user_id,
        '🚛 Nuevo viaje asignado',
        `${origin_address ?? 'Origen'} → ${destination_address ?? 'Destino'}`,
        { trip_id: tripId }
      ).catch((e: Error) => console.error('[push]', e.message))
    }

    const trip = await getTripById(tripId)
    res.status(201).json({ success: true, trip })
  } catch (err: any) {
    console.error('[POST /api/assigned-trips]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET / — Admin lista sus viajes asignados
router.get('/', async (req: Request, res: Response) => {
  const adminId = req.user!.id
  try {
    const result = await pool.query(
      `SELECT at.*,
              d.nombre     AS driver_nombre,
              t.patente    AS truck_patente
       FROM assigned_trips at
       LEFT JOIN drivers d ON d.id = at.driver_id
       LEFT JOIN trucks  t ON t.id = at.truck_id
       WHERE at.empresa_user_id = $1
       ORDER BY at.created_at DESC`,
      [adminId]
    )
    res.json(result.rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /mine — Conductor lista sus propios viajes
router.get('/mine', async (req: Request, res: Response) => {
  const userId = req.user!.id
  try {
    const result = await pool.query(
      `SELECT * FROM assigned_trips
       WHERE driver_app_user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    )
    res.json(result.rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /:id/status — Admin o conductor actualiza el estado
router.patch('/:id/status', async (req: Request, res: Response) => {
  const userId = req.user!.id
  const { status } = req.body
  const VALID = ['accepted', 'in_progress', 'completed', 'cancelled']

  if (!VALID.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' })
  }

  try {
    const existing = await pool.query<{ empresa_user_id: string; driver_app_user_id: string | null }>(
      'SELECT empresa_user_id, driver_app_user_id FROM assigned_trips WHERE id = $1',
      [req.params.id]
    )
    if (!existing.rowCount) return res.status(404).json({ error: 'Viaje no encontrado' })

    const trip = existing.rows[0]
    if (trip.empresa_user_id !== userId && trip.driver_app_user_id !== userId) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    let extra = ''
    if (status === 'accepted')    extra = ', accepted_at = NOW()'
    if (status === 'in_progress') extra = ', started_at = NOW()'
    if (status === 'completed')   extra = ', completed_at = NOW()'

    await pool.query(
      `UPDATE assigned_trips SET status = $1${extra} WHERE id = $2`,
      [status, req.params.id]
    )

    if (status === 'completed' && trip.driver_app_user_id) {
      await pool.query(
        'DELETE FROM driver_locations WHERE driver_app_user_id = $1',
        [trip.driver_app_user_id]
      )
    }

    const updated = await getTripById(Number(req.params.id))
    res.json({ success: true, trip: updated })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

async function getTripById(id: number) {
  const r = await pool.query(
    `SELECT at.*, d.nombre AS driver_nombre, t.patente AS truck_patente
     FROM assigned_trips at
     LEFT JOIN drivers d ON d.id = at.driver_id
     LEFT JOIN trucks  t ON t.id = at.truck_id
     WHERE at.id = $1`,
    [id]
  )
  return r.rows[0] ?? null
}

async function sendPushNotification(
  driverAppUserId: string,
  title: string,
  body: string,
  data: Record<string, unknown>
) {
  const r = await pool.query<{ token: string }>(
    'SELECT token FROM push_tokens WHERE driver_app_user_id = $1',
    [driverAppUserId]
  )
  const token = r.rows[0]?.token
  if (!token) return

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: token, title, body, data }),
  })
}

export default router
