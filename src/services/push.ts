import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { registerPushToken } from './assignedTrips'

// Registra el Expo push token del dispositivo en el backend. No bloqueante:
// cualquier error se traga (permisos denegados, sin projectId, sin red).
// Se llama tanto en el arranque (si ya hay sesión) como tras un login en
// caliente, para que un conductor recién logueado reciba notificaciones sin
// tener que reiniciar la app.
export async function registerForPushNotifications(): Promise<void> {
  try {
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
  } catch { /* no bloqueante */ }
}
