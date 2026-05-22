import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { supabase } from '../src/services/supabase'
import { useStore } from '../src/store/useStore'

export default function RootLayout() {
  const setProfile = useStore(s => s.setProfile)
  const isDark = useStore(s => s.isDark)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        supabase
          .from('st_profiles')
          .select('*')
          .eq('id', data.session.user.id)
          .single()
          .then(({ data: profile }) => {
            if (profile) setProfile(profile)
          })
      }
      setReady(true)
    })
  }, [])

  if (!ready) return null

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth" />
      </Stack>
    </>
  )
}
