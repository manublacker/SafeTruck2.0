import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

// Solo las variables EXPO_PUBLIC_* se inyectan al bundle del cliente. NUNCA
// usar SUPABASE_SERVICE_KEY acá: es la clave service-role (bypassa RLS) y
// quedaría empaquetada dentro de la app, expuesta a cualquiera.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''

// React Native no tiene localStorage, así que la sesión no persiste sin un
// storage explícito. Guardamos el token en SecureStore (cifrado). SecureStore
// limita cada valor a ~2KB y el token de Supabase puede superarlo, así que
// partimos en chunks. En web no se usa: supabase cae a localStorage por defecto.
const CHUNK_SIZE = 1800

const SecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    const countRaw = await SecureStore.getItemAsync(`${key}__n`)
    if (!countRaw) return SecureStore.getItemAsync(key)
    let value = ''
    for (let i = 0; i < Number(countRaw); i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`)
      if (part == null) return null
      value += part
    }
    return value
  },
  setItem: async (key: string, value: string): Promise<void> => {
    // Limpiar cualquier resto previo (formato simple o chunked).
    await removeChunks(key)
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value)
      return
    }
    const chunks = Math.ceil(value.length / CHUNK_SIZE)
    await SecureStore.setItemAsync(`${key}__n`, String(chunks))
    for (let i = 0; i < chunks; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE))
    }
  },
  removeItem: async (key: string): Promise<void> => {
    await removeChunks(key)
    await SecureStore.deleteItemAsync(key)
  },
}

async function removeChunks(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(`${key}__n`)
  if (!countRaw) return
  for (let i = 0; i < Number(countRaw); i++) {
    await SecureStore.deleteItemAsync(`${key}__${i}`)
  }
  await SecureStore.deleteItemAsync(`${key}__n`)
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    ...(Platform.OS === 'web'
      ? {}
      : { storage: SecureStoreAdapter, detectSessionInUrl: false }),
  },
})
