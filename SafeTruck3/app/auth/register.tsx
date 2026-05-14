import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const setProfile = useStore(s => s.setProfile)
  const router = useRouter()

  const handleRegister = async () => {
    if (!fullName || !email || !password) return Alert.alert('Error', 'Completá todos los campos')
    if (password.length < 6) return Alert.alert('Error', 'La contraseña debe tener al menos 6 caracteres')
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName } } })
      if (error) throw error
      if (!data.user) throw new Error('No se pudo crear el usuario')
      await supabase.from('st_profiles').update({ full_name: fullName }).eq('id', data.user.id)
      const { data: profile } = await supabase.from('st_profiles').select('*').eq('id', data.user.id).single()
      if (profile) setProfile(profile)
      router.replace('/(tabs)/')
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.inner}>
        <Text style={s.logo}>🚛</Text>
        <Text style={s.title}>Crear cuenta</Text>
        <TextInput style={s.input} placeholder="Nombre completo *" placeholderTextColor="#8E8E93" value={fullName} onChangeText={setFullName} />
        <TextInput style={s.input} placeholder="Email *" placeholderTextColor="#8E8E93" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={s.input} placeholder="Contraseña * (mín. 6 caracteres)" placeholderTextColor="#8E8E93" value={password} onChangeText={setPassword} secureTextEntry />
        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleRegister} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Registrarme</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.link} onPress={() => router.back()}>
          <Text style={s.linkText}>¿Ya tenés cuenta? Ingresá</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 60 },
  logo: { fontSize: 56, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 32 },
  input: { backgroundColor: '#2C2C2E', color: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, fontSize: 16, borderWidth: 1, borderColor: '#3A3A3C' },
  btn: { backgroundColor: '#FF6B35', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#FF6B35', fontSize: 14 },
})
