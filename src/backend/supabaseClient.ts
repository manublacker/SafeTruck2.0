import { createClient } from '@supabase/supabase-js'
// ws provee WebSocket para Node.js (Railway no tiene WebSocket nativo < v22)
// El cast a `any` es necesario porque los tipos de ws y Supabase no coinciden exactamente
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require('ws') as any

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ''

const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  ''

// En Node.js (Railway) no hay WebSocket nativo (< v22), por eso usamos el
// paquete `ws` como transport. El cliente mobile usa src/services/supabase.ts
// que depende del WebSocket nativo de Expo/React Native.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: ws },
})
