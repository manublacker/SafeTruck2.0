import { useEffect, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { supabase } from '../src/services/supabase'
import { useStore } from '../src/store/useStore'

export default function RootLayout() {
  const setProfile = useStore(s => s.setProfile)
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const router = useRouter()

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const userId = data.session?.user?.id
        if (userId) {
          setAuthed(true)
          const { data: profile } = await supabase
            .from('st_profiles')
            .select('*')
            .eq('id', userId)
            .single()
          if (profile) setProfile(profile)
        }
      })
      .catch(() => {})
      .finally(() => setReady(true))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
      } else if (event === 'SIGNED_IN' && session) {
        setAuthed(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!ready) return
    if (recoveryMode) {
      router.replace('/auth/reset-password')
    } else if (!authed) {
      router.replace('/landing')
    }
  }, [ready, authed, recoveryMode])

  if (!ready) return null

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="landing" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="auth/login" />
      <Stack.Screen name="auth/register" />
      <Stack.Screen name="auth/forgot-password" />
      <Stack.Screen name="auth/reset-password" />
    </Stack>
  )
}
