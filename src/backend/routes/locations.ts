import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/authMiddleware'
import { requireActiveSubscription } from '../middleware/requireActiveSubscription'
import pool from '../db'
import { broadcastToCompany, resolveCompany } from '../realtime/hub'

const router = Router()
router.use(authMiddleware)
router.use(requireActiveSubscription)

// GET / — Admin obtiene las ubicaciones activas de SU empresa (para el live map)
router.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.id
  try {
    // Filtramos por los conductores que pertenecen a esta cuenta (drivers.user_id
    // = admin dueño). Sin este filtro, el polling devolvía las ubicaciones de
    // TODAS las empresas y se colaban camiones ajenos en el mapa. El broadcast
    // por WebSocket (POST/DELETE) ya estaba aislado por empresa; esto alinea el GET.
    const result = await pool.query(
      `SELECT driver_app_user_id, driver_name, truck_plate, lat, lng, updated_at
       FROM driver_locations
       WHERE driver_app_user_id IN (
         SELECT app_user_id FROM drivers WHERE user_id = $1 AND is_active = true
       )
       AND updated_at > NOW() - INTERVAL '5 minutes'`,
      [userId]
    )
    res.json(result.rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST / — Conductor actualiza su posición GPS
router.post('/', async (req: Request, res: Response) => {
  const driverUserId = req.user!.id
  const { lat, lng, trip_id, driver_name, truck_plate, route } = req.body

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

    // Tiempo real: empujamos la ubicación a los admins de la empresa conectados
    // por WebSocket, para que el mapa web se mueva sin esperar al polling.
    // Best-effort y DESPUÉS de responder: si el broadcast falla, el guardado y
    // la respuesta ya quedaron OK (el polling sigue como respaldo).
    try {
      const { companyId } = await resolveCompany(driverUserId)
      broadcastToCompany(companyId, {
        type: 'driver_location',
        location: {
          driver_app_user_id: driverUserId,
          driver_name: driver_name ?? null,
          truck_plate: truck_plate ?? null,
          lat,
          lng,
          updated_at: new Date().toISOString(),
          // Recorrido del chofer (sólo se reenvía por WS; la web lo dibuja en el
          // mapa). No se persiste en driver_locations: es efímero del viaje en curso.
          ...(route ? { route } : {}),
        },
      }, { role: 'admin' })
    } catch { /* broadcast best-effort */ }
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

    // Avisamos a los admins que este chofer se desconectó, para que la web
    // saque su marcador del mapa al instante (sin esperar a que expire por el
    // filtro de 5 minutos del GET).
    try {
      const { companyId } = await resolveCompany(driverUserId)
      broadcastToCompany(companyId, {
        type: 'driver_location_removed',
        driver_app_user_id: driverUserId,
      }, { role: 'admin' })
    } catch { /* broadcast best-effort */ }
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
