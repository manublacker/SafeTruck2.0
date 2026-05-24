// Cliente Supabase dedicado al backend (Node.js).
// Node 20 no tiene WebSocket nativo, hay que pasarle `ws` como transport.
// En cliente mobile (React Native) se usa src/services/supabase.ts, que NO importa `ws`.

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ''

const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  ''

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    transport: ws as any,
  },
})
