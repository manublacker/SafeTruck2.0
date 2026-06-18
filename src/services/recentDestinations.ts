import * as SecureStore from 'expo-secure-store'

const KEY = 'recent_destinations'
const MAX = 5

export interface RecentDest {
  display_name: string
  lat: string
  lon: string
}

export async function getRecentDestinations(): Promise<RecentDest[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Agrega un destino al frente (dedup por display_name), limita a MAX y persiste. */
export async function addRecentDestination(dest: RecentDest): Promise<RecentDest[]> {
  try {
    const current = await getRecentDestinations()
    const deduped = current.filter(d => d.display_name !== dest.display_name)
    const next = [dest, ...deduped].slice(0, MAX)
    await SecureStore.setItemAsync(KEY, JSON.stringify(next))
    return next
  } catch {
    return []
  }
}
