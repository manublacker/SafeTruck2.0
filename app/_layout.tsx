import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { Platform, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView } from 'react-native'
import { supabase } from '../src/services/supabase'
import { useStore } from '../src/store/useStore'
import { registerPushToken } from '../src/services/assignedTrips'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
    shouldShowBanner: true,
    shouldShowList:   true,
  }),
})

async function registerForPushNotifications() {
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

function CompleteProfileScreen({ profileId, onComplete }: { profileId: string; onComplete: (phone: string) => void }) {
  const [phone, setPhone]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const handleSave = async () => {
    const trimmed = phone.trim()
    if (!trimmed) { setError('Ingresá tu número de teléfono'); return }
    setLoading(true)
    setError('')
    try {
      const { error: err } = await supabase
        .from('profiles')
        .update({ phone: trimmed })
        .eq('id', profileId)
      if (err) throw err
      onComplete(trimmed)
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.card}>
        <View style={s.iconWrap}>
          <Text style={s.icon}>👤</Text>
        </View>
        <Text style={s.title}>Completá tu perfil</Text>
        <Text style={s.subtitle}>
          Antes de continuar, necesitamos que agregues tu número de teléfono para que tu empresa pueda contactarte.
        </Text>

        <Text style={s.label}>TELÉFONO</Text>
        <TextInput
          style={s.input}
          placeholder="+54 11 1234-5678"
          placeholderTextColor="#9AA3AD"
          value={phone}
          onChangeText={v => { setPhone(v); setError('') }}
          keyboardType="phone-pad"
          autoFocus
        />
        {error ? <Text style={s.error}>{error}</Text> : null}

        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Guardar y continuar</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 400, borderWidth: 1, borderColor: '#E6E8EC' },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FDECEA', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  icon: { fontSize: 26 },
  title: { fontSize: 22, fontWeight: '800', color: '#16202C', marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#69727E', lineHeight: 21, marginBottom: 24 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: '#9AA3AD', marginBottom: 6 },
  input: { backgroundColor: '#F7F8FA', borderRadius: 10, borderWidth: 1, borderColor: '#E6E8EC', padding: 14, fontSize: 16, color: '#16202C', marginBottom: 8 },
  error: { fontSize: 13, color: '#E5342B', marginBottom: 8 },
  btn: { backgroundColor: '#E5342B', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})

export default function RootLayout() {
  const profile    = useStore(s => s.profile)
  const setProfile = useStore(s => s.setProfile)
  const isDark     = useStore(s => s.isDark)
  const [ready, setReady]               = useState(false)
  const [needsCompletion, setNeedsCompletion] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session?.user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.session.user.id)
          .single()
        if (prof) {
          setProfile(prof)
          if (!prof.phone) setNeedsCompletion(true)
        }
        void registerForPushNotifications()
      }
      setReady(true)
    })
  }, [])

  if (!ready) return null

  if (profile && needsCompletion) {
    return (
      <>
        <StatusBar style="dark" />
        <CompleteProfileScreen
          profileId={profile.id}
          onComplete={(phone) => {
            setProfile({ ...profile, phone })
            setNeedsCompletion(false)
          }}
        />
      </>
    )
  }

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
