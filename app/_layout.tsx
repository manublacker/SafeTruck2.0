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
    // Load session and profile before marking the app as ready.
    // setReady(true) must come AFTER the profile fetch so that the tab layout
    // never sees `profile === null` and incorrectly redirects to login.
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session?.user) {
        const { data: profile } = await supabase
          .from('st_profiles')
          .select('*')
          .eq('id', data.session.user.id)
          .single()
        if (profile) setProfile(profile)
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
