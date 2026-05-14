import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const setProfile = useStore(s => s.setProfile)
  const router = useRouter()

  const handleLogin = async () => {
    if (!email || !password) return Alert.alert('Error', 'Completá todos los campos')
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error

      // Buscar perfil, crearlo si no existe
      let { data: profile } = await supabase
        .from('st_profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()

      if (!profile) {
        const { data: newProfile } = await supabase
          .from('st_profiles')
          .insert({ id: data.user.id, full_name: data.user.email || 'Usuario' })
          .select()
          .single()
        profile = newProfile
      }

      if (profile) {
        setProfile(profile)
        router.replace('/(tabs)/')
      }
    } catch (e: any) {
      Alert.alert('Error al ingresar', e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.inner}>
        <Text style={s.logo}>🚛</Text>
        <Text style={s.title}>SafeTruck</Text>
        <Text style={s.subtitle}>Navegación para camiones en el AMBA</Text>
        <TextInput style={s.input} placeholder="Email" placeholderTextColor="#8E8E93" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={s.input} placeholder="Contraseña" placeholderTextColor="#8E8E93" value={password} onChangeText={setPassword} secureTextEntry />
        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Ingresar</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.link} onPress={() => router.push('/auth/register')}>
          <Text style={s.linkText}>¿No tenés cuenta? Registrate</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  logo: { fontSize: 64, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 32, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#8E8E93', textAlign: 'center', marginBottom: 40 },
  input: { backgroundColor: '#2C2C2E', color: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, fontSize: 16, borderWidth: 1, borderColor: '#3A3A3C' },
  btn: { backgroundColor: '#FF6B35', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#FF6B35', fontSize: 14 },
})
