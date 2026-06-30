import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/authMiddleware'
import { requireActiveSubscription } from '../middleware/requireActiveSubscription'
import pool from '../db'
import { broadcastToCompany } from '../realtime/hub'
import {
  distanceMetersFromRoute,
  durationMinutesFromRoute,
  isAssignableStatus,
  timestampFieldForStatus,
} from '../lib/trips'

const router = Router()
router.use(authMiddleware)
router.use(requireActiveSubscription)

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
    const distanceM   = distanceMetersFromRoute(route as any)
    const durationMin = durationMinutesFromRoute(route as any)

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

    // Tiempo real: si el conductor está usando la app (conectado por WS), le
    // hacemos aparecer el viaje al instante, sin que tenga que refrescar. Va
    // SOLO a su conexión (no a otros choferes de la empresa). El push sigue
    // como respaldo para cuando la app está cerrada.
    if (driver.app_user_id) {
      try {
        broadcastToCompany(adminId, { type: 'trip_assigned', trip }, { only: driver.app_user_id })
      } catch { /* broadcast best-effort */ }
    }
  } catch (err: any) {
    console.error('[POST /api/assigned-trips]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /personal — El conductor crea su PROPIO viaje (no asignado por la empresa):
// lo arma él al elegir un destino y arrancar a navegar/simular. Nace 'in_progress'
// y se finaliza con PATCH /:id/status 'completed'. Así el empresario lo ve en sus
// viajes (en curso ahora, finalizado al terminar). Se marca trip_source='personal'
// para poder filtrarlo de los viajes designados por la empresa.
router.post('/personal', async (req: Request, res: Response) => {
  const userId = req.user!.id // app_user_id del conductor
  const {
    origin_address,
    destination_address,
    origin_lat,
    origin_lng,
    destination_lat,
    destination_lng,
    route,
  } = req.body

  try {
    // ¿A qué empresa pertenece este conductor? (y su id en la tabla drivers)
    const drvRes = await pool.query<{ id: number; user_id: string }>(
      'SELECT id, user_id FROM drivers WHERE app_user_id = $1 AND is_active = true LIMIT 1',
      [userId]
    )
    if (!drvRes.rowCount) {
      return res.status(404).json({ error: 'Tu cuenta no está vinculada a ninguna empresa' })
    }
    const drv = drvRes.rows[0]

    // distancia/duración: el helper acepta el formato del motor (distanceM /
    // estimatedDurationMin) o el de la app móvil (total_distance_km / _min) y
    // SIEMPRE redondea (las columnas son INTEGER; un decimal rompería el INSERT).
    const distanceM   = distanceMetersFromRoute(route as any)
    const durationMin = durationMinutesFromRoute(route as any)

    const result = await pool.query<{ id: number }>(
      `INSERT INTO assigned_trips (
         empresa_user_id, driver_id, driver_app_user_id, truck_id,
         origin_label, destination_label,
         origin_lat, origin_lon, destination_lat, destination_lon,
         path, distance_m, duration_min,
         status, started_at, trip_source
       ) VALUES (
         $1, $2, $3,
         (SELECT truck_id FROM truck_drivers WHERE driver_id = $2 LIMIT 1),
         $4, $5, $6, $7, $8, $9, $10, $11, $12,
         'in_progress', NOW(), 'personal'
       )
       RETURNING id`,
      [
        drv.user_id,
        drv.id,
        userId,
        origin_address ?? null,
        destination_address ?? null,
        origin_lat ?? null,
        origin_lng ?? null,
        destination_lat ?? null,
        destination_lng ?? null,
        route ? JSON.stringify(route) : null,
        distanceM,
        durationMin,
      ]
    )

    const trip = await getTripById(result.rows[0].id)
    res.status(201).json({ success: true, trip })

    // Tiempo real: que el empresario vea aparecer el viaje en curso al instante.
    try {
      broadcastToCompany(drv.user_id, { type: 'trip_update', trip }, { exclude: userId })
    } catch { /* broadcast best-effort */ }
  } catch (err: any) {
    console.error('[POST /api/assigned-trips/personal]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET / — Admin lista sus viajes asignados
router.get('/', async (req: Request, res: Response) => {
  const adminId = req.user!.id
  try {
    // Auto-limpieza: un viaje PERSONAL manda ubicación seguido mientras está
    // activo. Si lleva >2 min sin mandar (el chofer dejó la app en segundo plano
    // o la cerró), quedó abandonado → lo completamos solo, así no aparece colgado
    // "en curso". Los ASIGNADOS no se tocan (pueden retomarse). Best-effort.
    try {
      await pool.query(
        `UPDATE assigned_trips at
           SET status = 'completed', completed_at = NOW()
         WHERE at.empresa_user_id = $1
           AND at.trip_source = 'personal'
           AND at.status = 'in_progress'
           AND NOT EXISTS (
             SELECT 1 FROM driver_locations dl
             WHERE dl.driver_app_user_id = at.driver_app_user_id
               AND dl.updated_at > NOW() - INTERVAL '2 minutes'
           )`,
        [adminId]
      )
    } catch { /* best-effort: si falla, igual devolvemos la lista */ }

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
      `SELECT at.*, t.patente AS truck_patente, t.name AS truck_name
       FROM assigned_trips at
       LEFT JOIN trucks t ON t.id = at.truck_id AND t.is_active = true
       WHERE at.driver_app_user_id = $1
       ORDER BY at.created_at DESC
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

  if (!isAssignableStatus(status)) {
    return res.status(400).json({ error: 'Estado inválido' })
  }

  try {
    const existing = await pool.query<{ empresa_user_id: string; driver_app_user_id: string | null; driver_id: number }>(
      'SELECT empresa_user_id, driver_app_user_id, driver_id FROM assigned_trips WHERE id = $1',
      [req.params.id]
    )
    if (!existing.rowCount) return res.status(404).json({ error: 'Viaje no encontrado' })

    const trip = existing.rows[0]
    if (trip.empresa_user_id !== userId && trip.driver_app_user_id !== userId) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    // Un conductor sólo puede tener UN viaje en curso a la vez: un viaje está
    // "in_progress" únicamente mientras el conductor lo está realizando.
    if (status === 'in_progress') {
      const inProgress = await pool.query<{ id: number }>(
        `SELECT id FROM assigned_trips
         WHERE id <> $1 AND status = 'in_progress' AND driver_id = $2`,
        [req.params.id, trip.driver_id]
      )
      if (inProgress.rowCount) {
        return res.status(409).json({
          error: 'El conductor ya tiene un viaje en curso. Finalizalo antes de iniciar otro.',
        })
      }
    }

    const tsField = timestampFieldForStatus(status)
    const extra = tsField ? `, ${tsField} = NOW()` : ''

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

    // Tiempo real: avisamos al resto de la empresa (admin + chofer) que el viaje
    // cambió de estado, para que la web/móvil se actualicen sin refrescar.
    // Caso típico: el chofer toca "Iniciar viaje" -> el panel del admin lo ve
    // pasar a "En curso" al instante. Excluimos a quien lo originó (ya lo sabe).
    try {
      broadcastToCompany(
        trip.empresa_user_id,
        { type: 'trip_update', trip: updated },
        { exclude: userId },
      )
    } catch { /* broadcast best-effort */ }
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /:id — El admin elimina un viaje de SU empresa (cualquier estado).
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.user!.id
  try {
    // Soltamos la referencia en driver_locations (trip_id) por si hay FK, así el
    // borrado nunca falla por una ubicación que apuntaba a este viaje.
    await pool.query('UPDATE driver_locations SET trip_id = NULL WHERE trip_id = $1', [req.params.id])
      .catch(() => {})

    const result = await pool.query(
      'DELETE FROM assigned_trips WHERE id = $1 AND empresa_user_id = $2',
      [req.params.id, userId],
    )
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Viaje no encontrado' })
    }
    res.status(204).send()
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
