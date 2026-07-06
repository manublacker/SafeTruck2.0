import { Router, Request, Response } from 'express'
import { randomInt } from 'crypto'
import { authMiddleware } from '../middleware/authMiddleware'
import { requireActiveSubscription } from '../middleware/requireActiveSubscription'
import pool, { withTransaction } from '../db'
import { broadcastToCompany } from '../realtime/hub'

const router = Router()

// Código de invitación con `crypto.randomInt` (no `Math.random`, que es
// predecible). El alfabeto excluye caracteres ambiguos (0/O, 1/I).
function generateCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < length; i++) code += chars[randomInt(chars.length)]
  return code
}

// POST / — Admin genera un código de invitación (no requiere driver existente)
router.post('/', authMiddleware, requireActiveSubscription, async (req: Request, res: Response) => {
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
router.get('/', authMiddleware, requireActiveSubscription, async (req: Request, res: Response) => {
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

    await withTransaction(async (client) => {
      let driverId: number

      // Si era independiente ("empresa de uno", drivers con user_id = app_user_id),
      // desactivamos ese auto-vínculo: desde acá su acceso y sus viajes pasan a
      // la empresa que lo invitó. Sus camiones y su historial quedan intactos.
      await client.query(
        `UPDATE drivers SET is_active = false, updated_at = NOW()
         WHERE user_id::text = $1 AND app_user_id::text = $1 AND is_active = true`,
        [driverUserId]
      )

      if (invitation.driver_id) {
        // Invitación ligada a un conductor existente → solo linkeamos
        await client.query(
          'UPDATE drivers SET app_user_id = $1, updated_at = NOW() WHERE id = $2',
          [driverUserId, invitation.driver_id]
        )
        driverId = invitation.driver_id
      } else {
        // Invitación abierta → crear nuevo conductor con datos del registro
        const insertRes = await client.query<{ id: number }>(
          `INSERT INTO drivers (user_id, nombre, estado, is_active, app_user_id)
           VALUES ($1, $2, 'Activo', true, $3)
           RETURNING id`,
          [adminId, driverName, driverUserId]
        )
        driverId = insertRes.rows[0].id

        // Actualizar la invitación con el driver_id recién creado
        await client.query(
          'UPDATE driver_invitations SET driver_id = $1 WHERE id = $2',
          [driverId, invitation.id]
        )
      }

      // Marcar invitación como canjeada
      await client.query(
        'UPDATE driver_invitations SET redeemed_at = NOW(), redeemed_by = $1 WHERE id = $2',
        [driverUserId, invitation.id]
      )

      // Backfill viajes pendientes si los hay
      await client.query(
        `UPDATE assigned_trips SET driver_app_user_id = $1
         WHERE driver_id = $2 AND driver_app_user_id IS NULL
           AND status IN ('pending', 'accepted')`,
        [driverUserId, driverId]
      )
    })
    res.json({ success: true, driver_name: driverName })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /validate — Chequeo liviano ANTES de mandar el OTP, para (a) no crear una
// cuenta de auth contra una invitación inválida/vencida y (b) avisar si el email
// ya tiene cuenta (Supabase, por seguridad, NO manda el código si el mail ya
// está confirmado y devuelve un "éxito" falso: sin este chequeo el conductor
// terminaba en la pantalla de código esperando un mail que nunca llega).
// Público: lo llama la web /unirse en el paso 1, antes del signUp de Supabase.
router.post('/validate', async (req: Request, res: Response) => {
  const rawCode = String(req.body?.code ?? '').toUpperCase().trim()
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  if (!rawCode) return res.status(400).json({ error: 'Falta el código de invitación.' })
  try {
    const r = await pool.query(
      `SELECT hint_name FROM driver_invitations
       WHERE code = $1 AND redeemed_at IS NULL AND expires_at > NOW()`,
      [rawCode]
    )
    if (!r.rowCount) return res.status(404).json({ error: 'Código de invitación inválido o vencido.' })

    if (email) {
      // pool apunta a la base de Supabase (DATABASE_URL), así que podemos mirar
      // auth.users directo. Solo bloqueamos si el mail YA está confirmado; si
      // existe sin confirmar, dejamos seguir (el signUp reenvía el código).
      const u = await pool.query(
        `SELECT email_confirmed_at FROM auth.users WHERE lower(email) = $1 LIMIT 1`,
        [email]
      )
      if (u.rowCount && u.rows[0].email_confirmed_at) {
        return res.status(409).json({ error: 'Ese email ya tiene una cuenta. Ingresá directamente desde la app SafeTruck.' })
      }
    }

    return res.json({ valid: true, hint_name: r.rows[0].hint_name ?? null })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
})

// POST /complete — El conductor YA verificó su email por OTP (mismo flujo que el
// registro del empresario en la web: signUp + verifyOtp), así que llega con su
// sesión de Supabase en el header. Acá lo vinculamos a la empresa: creamos o
// enlazamos su ficha de driver, canjeamos la invitación y le pasamos los viajes
// que le habían asignado antes de que se registrara.
router.post('/complete', authMiddleware, async (req: Request, res: Response) => {
  const driverUserId = req.user!.id
  const email = req.user!.email
  const metaName = (req.user!.user_metadata as { full_name?: string })?.full_name
  const fullName = String(req.body?.full_name ?? metaName ?? '').trim() || email
  const rawCode = String(req.body?.code ?? '').toUpperCase().trim()
  if (!rawCode) return res.status(400).json({ error: 'Falta el código de invitación.' })

  try {
    const invRes = await pool.query(
      `SELECT * FROM driver_invitations WHERE code = $1`,
      [rawCode]
    )
    if (!invRes.rowCount) return res.status(404).json({ error: 'Código de invitación inválido.' })
    const invitation = invRes.rows[0]

    // Idempotencia: si /complete se reintenta (red cortada, doble submit) y la
    // invitación ya la canjeó ESTE usuario, devolvemos OK en vez de error.
    if (invitation.redeemed_at) {
      if (invitation.redeemed_by === driverUserId) return res.json({ success: true, email })
      return res.status(409).json({ error: 'Esta invitación ya fue utilizada.' })
    }
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ error: 'La invitación venció.' })
    }
    const adminId = invitation.admin_id

    // Sincronizar el nuevo conductor en la tabla users de Aiven.
    // Necesario antes del BEGIN porque drivers.user_id tiene FK a users(id).
    await pool.query(
      `INSERT INTO users (id, email, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [driverUserId, email.toLowerCase(), fullName]
    )

    let driverId: number = 0
    await withTransaction(async (client) => {
      if (invitation.driver_id) {
        await client.query(
          'UPDATE drivers SET app_user_id = $1, updated_at = NOW() WHERE id = $2',
          [driverUserId, invitation.driver_id]
        )
        driverId = invitation.driver_id
      } else {
        const insertRes = await client.query<{ id: number }>(
          `INSERT INTO drivers (user_id, nombre, estado, is_active, app_user_id)
           VALUES ($1, $2, 'Activo', true, $3)
           RETURNING id`,
          [adminId, fullName, driverUserId]
        )
        driverId = insertRes.rows[0].id
        await client.query(
          'UPDATE driver_invitations SET driver_id = $1 WHERE id = $2',
          [driverId, invitation.id]
        )
      }

      await client.query(
        'UPDATE driver_invitations SET redeemed_at = NOW(), redeemed_by = $1 WHERE id = $2',
        [driverUserId, invitation.id]
      )

      await client.query(
        `UPDATE assigned_trips SET driver_app_user_id = $1
         WHERE driver_id = $2 AND driver_app_user_id IS NULL
           AND status IN ('pending', 'accepted')`,
        [driverUserId, driverId]
      )
    })

    // El admin no tiene por qué estar mirando la pestaña en ese instante, pero
    // si está conectado, la tarjeta de "invitación pendiente" pasa a ser el
    // conductor nuevo sin que tenga que recargar la página.
    try {
      broadcastToCompany(adminId, { type: 'driver_registered', driver_id: driverId }, { role: 'admin' })
    } catch { /* broadcast best-effort */ }

    res.json({ success: true, email })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /:id — Admin elimina una invitación pendiente
router.delete('/:id', authMiddleware, requireActiveSubscription, async (req: Request, res: Response) => {
  const adminId = req.user!.id
  try {
    const result = await pool.query(
      `DELETE FROM driver_invitations WHERE id = $1 AND admin_id = $2 AND redeemed_at IS NULL`,
      [req.params.id, adminId]
    )
    if (!result.rowCount) return res.status(404).json({ error: 'Invitación no encontrada o ya canjeada' })
    res.status(204).send()
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /bulk — Admin genera códigos en masa (sin drivers existentes)
router.post('/bulk', authMiddleware, requireActiveSubscription, async (req: Request, res: Response) => {
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
