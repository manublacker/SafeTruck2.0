import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { calculateRoute } from './router'
import { supabase } from '../services/supabase'

const app = express()
app.use(cors())
app.use(express.json())

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

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`SafeTruck backend en puerto ${PORT}`))
