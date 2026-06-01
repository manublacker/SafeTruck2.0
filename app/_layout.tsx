import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { Platform } from 'react-native'
import { supabase } from '../src/services/supabase'
import { useStore } from '../src/store/useStore'
import { registerPushToken } from '../src/services/assignedTrips'

// expo-notifications (push remoto) fue removido de Expo Go en SDK 53: importarlo
// ahí crashea la app. Solo lo cargamos fuera de Expo Go (development build /
// standalone), de forma diferida, para no romper el arranque en Expo Go.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

async function registerForPushNotifications() {
  if (isExpoGo) return
  try {
    const Notifications = await import('expo-notifications')

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge:  true,
        shouldShowBanner: true,
        shouldShowList:   true,
      }),
    })

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      })
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    if (finalStatus !== 'granted') return

    const projectId = Constants.expoConfig?.extra?.eas?.projectId
    if (!projectId) return

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId })
    await registerPushToken(tokenData.data)
  } catch {
    // No bloqueante: las notificaciones son opcionales
  }
}

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
        void registerForPushNotifications()
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
