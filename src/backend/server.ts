import 'dotenv/config'
import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { calculateRoute } from './router'
import { supabase } from './supabaseClient'
import authRouter from './routes/auth'
import trucksRouter from './routes/trucks'
import driversRouter from './routes/drivers'
import truckDriversRouter from './routes/truck-drivers'
import searchRouter from './routes/search'
import routeRouter from './routes/route'
import incidentsRouter from './routes/incidents'
import reportsRouter from './routes/reports'
import usersRouter from './routes/users'
import billingRouter from './routes/billing'
import { authMiddleware } from './middleware/authMiddleware'

const app = express()
app.use(cors({ maxAge: 86400 }))

// El webhook de Stripe necesita el body crudo (sin parsear) para verificar la firma.
// IMPORTANTE: esta ruta debe ir ANTES del middleware express.json() global.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }))

app.use(express.json({ limit: '50mb' }))

app.use('/api/auth', authRouter)
app.use('/api/billing', billingRouter)
app.use('/api/routes', routeRouter)
app.use('/api/search', searchRouter)
app.use('/api/incidents', incidentsRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/users', usersRouter)
app.use('/api/trucks', authMiddleware, trucksRouter)
app.use('/api/drivers', authMiddleware, driversRouter)
app.use('/api/truck-drivers', authMiddleware, truckDriversRouter)
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'SafeTruck API' }))

// ────────────────────────────────────────────────────────────────────────────
// Routing (existente)
// ────────────────────────────────────────────────────────────────────────────

app.post('/route', async (req, res) => {
  res.setTimeout(60000)
  try {
    const { origin, destination, vehicle } = req.body
    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng)
      return res.status(400).json({ error: 'origin y destination requeridos' })
    if (!vehicle?.weight_kg || !vehicle?.height_m)
      return res.status(400).json({ error: 'vehicle requerido' })
    const route = await calculateRoute(origin, destination, vehicle)
    res.json({ success: true, route })
  } catch (err: any) {
    console.error('[/route]', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/trips', async (req, res) => {
  try {
    const { user_id, vehicle_id, origin, destination, origin_address, destination_address, route } = req.body
    const { data, error } = await supabase
      .from('st_trips')
      .insert({
        user_id,
        vehicle_id,
        origin: `SRID=4326;POINT(${origin.lng} ${origin.lat})`,
        destination: `SRID=4326;POINT(${destination.lng} ${destination.lat})`,
        origin_address: origin_address || `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`,
        destination_address: destination_address || `${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)}`,
        distance_km: route.total_distance_km,
        duration_min: route.total_duration_min,
        status: 'completed',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, trip: data })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/health', (_, res) => res.json({ status: 'ok' }))

// ────────────────────────────────────────────────────────────────────────────
// Admin endpoints: crear/eliminar conductores con credenciales auto-generadas
// (requieren service_role key — solo backend)
// ────────────────────────────────────────────────────────────────────────────

interface AuthedRequest extends Request {
  adminId?: string
}

function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function randomLocalEmail(): string {
  const slug = Math.random().toString(36).slice(2, 10)
  return `driver-${slug}@safetruck.local`
}

async function authAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Falta token de autenticación' })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'Token inválido' })
  req.adminId = data.user.id
  next()
}

// NOTA: las credenciales se generan y se guardan en st_drivers.password como texto
// plano. NO crean un usuario de Supabase Auth — sirven como "credenciales pendientes"
// que se van a activar cuando la app mobile esté lista y migre estos rows a auth.users.

app.post('/admin/drivers', authAdmin, async (req: AuthedRequest, res) => {
  const adminId = req.adminId!
  try {
    const { full_name, email, phone, license_number } = req.body
    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({ error: 'El nombre es obligatorio.' })
    }

    const driverEmail = (email && String(email).trim())
      ? String(email).trim().toLowerCase()
      : randomLocalEmail()
    const password = generatePassword()

    const { data: driver, error: drvErr } = await supabase
      .from('st_drivers')
      .insert({
        admin_id: adminId,
        full_name: String(full_name).trim(),
        email: driverEmail,
        password,
        phone: phone || null,
        license_number: license_number || null,
      })
      .select()
      .single()
    if (drvErr) {
      console.error('[/admin/drivers] insert driver:', drvErr.message)
      return res.status(500).json({ error: drvErr.message })
    }

    res.json({
      success: true,
      driver,
      credentials: { email: driverEmail, password },
    })
  } catch (err: any) {
    console.error('[/admin/drivers]', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/admin/drivers/:id/reset-password', authAdmin, async (req: AuthedRequest, res) => {
  const adminId = req.adminId!
  try {
    const { data: driver, error: drvErr } = await supabase
      .from('st_drivers')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (drvErr || !driver) return res.status(404).json({ error: 'Conductor no encontrado' })
    if (driver.admin_id !== adminId) return res.status(403).json({ error: 'No tenés permiso para este conductor' })

    const password = generatePassword()
    const { error: updErr } = await supabase
      .from('st_drivers')
      .update({ password })
      .eq('id', driver.id)
    if (updErr) return res.status(500).json({ error: updErr.message })

    res.json({ success: true, credentials: { email: driver.email, password } })
  } catch (err: any) {
    console.error('[/admin/drivers/:id/reset-password]', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/admin/drivers/:id', authAdmin, async (req: AuthedRequest, res) => {
  const adminId = req.adminId!
  try {
    const { data: driver, error: drvErr } = await supabase
      .from('st_drivers')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (drvErr || !driver) return res.status(404).json({ error: 'Conductor no encontrado' })
    if (driver.admin_id !== adminId) return res.status(403).json({ error: 'No tenés permiso para este conductor' })

    if (driver.user_id) {
      await supabase.auth.admin.deleteUser(driver.user_id).catch(e => {
        console.error('[/admin/drivers/:id] deleteAuthUser:', e?.message)
      })
    }
    const { error: delErr } = await supabase.from('st_drivers').delete().eq('id', req.params.id)
    if (delErr) return res.status(500).json({ error: delErr.message })

    res.json({ success: true })
  } catch (err: any) {
    console.error('[/admin/drivers/:id]', err)
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`SafeTruck backend en puerto ${PORT}`))

// ────────────────────────────────────────────────────────────────────────────
// Asignación de viajes desde la web
// ────────────────────────────────────────────────────────────────────────────

app.post('/trips/assign', async (req, res) => {
  try {
    const {
      user_id, vehicle_id,
      origin_lat, origin_lng, origin_address,
      dest_lat, dest_lng, dest_address,
      notes
    } = req.body

    if (!user_id || !dest_lat || !dest_lng)
      return res.status(400).json({ error: 'user_id y destino son requeridos' })

    const { data, error } = await supabase
      .from('st_trips')
      .insert({
        user_id,
        vehicle_id: vehicle_id || null,
        origin: `SRID=4326;POINT(${origin_lng || 0} ${origin_lat || 0})`,
        destination: `SRID=4326;POINT(${dest_lng} ${dest_lat})`,
        origin_address: origin_address || '',
        destination_address: dest_address || '',
        notes: notes || null,
        status: 'pending',
      })
      .select()
      .single()

    if (error) throw error
    res.json({ success: true, trip: data })
  } catch (err: any) {
    console.error('[/trips/assign]', err.message)
    res.status(500).json({ error: err.message })
  }
})