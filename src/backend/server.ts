import 'dotenv/config'
import express, { Request, Response } from 'express'
import cors from 'cors'
import { calculateRoute, denunciarPunto } from './router'
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
import { requireActiveSubscription } from './middleware/requireActiveSubscription'
import assignedTripsRouter from './routes/assigned-trips'
import invitationsRouter from './routes/invitations'
import locationsRouter from './routes/locations'
import pushTokensRouter from './routes/push-tokens'
import { loadGraphCache } from './graphCache'

const app = express()
app.use(cors({ maxAge: 86400 }))

app.use(express.json({ limit: '50mb' }))

app.use('/api/auth', authRouter)
app.use('/api/billing', billingRouter)
app.use('/api/routes', routeRouter)
app.use('/api/search', searchRouter)
app.use('/api/incidents', incidentsRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/users', usersRouter)
app.use('/api/trucks', authMiddleware, requireActiveSubscription, trucksRouter)
app.use('/api/drivers', authMiddleware, requireActiveSubscription, driversRouter)
app.use('/api/truck-drivers', authMiddleware, requireActiveSubscription, truckDriversRouter)
app.use('/api/assigned-trips', assignedTripsRouter)
app.use('/api/invitations', invitationsRouter)
app.use('/api/locations', locationsRouter)
app.use('/api/push-tokens', pushTokensRouter)
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

// ────────────────────────────────────────────────────────────────────────────
// Denuncias cooperativas (CAPA DE PESO en el ruteo)
// La app la llama desde el modal de reporte. Snapea el punto a la arista de
// pgr_edges más cercana y acumula penalización; pgr_route_truck la usa en la
// próxima ruta. La capa VISUAL (st_incidents) va aparte, directo a Supabase.
// Lógica SQL: migración 003_denuncia_penalty_pgr.sql.
// ────────────────────────────────────────────────────────────────────────────
app.post('/reports', async (req, res) => {
  try {
    const { lat, lng, type, trip_id } = req.body
    if (lat == null || lng == null)
      return res.status(400).json({ error: 'lat y lng requeridos' })
    // El sistema de peso sólo distingue 'multa' (negativo) / 'sin_problemas'.
    // Toda denuncia del modal es negativa => 'multa'. El tipo concreto (control,
    // accidente, etc.) se guarda como nota.
    const edgeId = await denunciarPunto(lat, lng, 'multa', trip_id ?? null, type ?? null)
    res.json({ success: true, edge_id: edgeId })
  } catch (err: any) {
    console.error('[/reports]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /trips (legacy st_trips) eliminado en Fase 3.

app.get('/health', (_, res) => res.json({ status: 'ok' }))

// Los endpoints legacy /admin/drivers (st_drivers) fueron eliminados en Fase 2.
// La gestión de conductores ahora usa /api/drivers (Aiven) + /api/invitations.

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`SafeTruck backend en puerto ${PORT}`)
  // Carga el grafo del AMBA en memoria en segundo plano (no bloquea el arranque).
  // Mientras carga, /api/routes usa el método por query como fallback.
  loadGraphCache()
})
