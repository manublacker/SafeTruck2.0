import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { isValidPassword, MIN_PASSWORD_LENGTH, updatePassword } from '../../src/services/auth'

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleSubmit = async () => {
    if (!isValidPassword(password)) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await updatePassword(password)
      setDone(true)
    } catch (e: any) {
      setError(e.message ?? 'No se pudo actualizar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={s.inner}>
        {done ? (
          <>
            <Text style={s.title}>Contraseña actualizada</Text>
            <Text style={s.subtitle}>Ya podés ingresar con tu nueva contraseña.</Text>
            <TouchableOpacity style={s.btn} onPress={() => router.replace('/auth/login')}>
              <Text style={s.btnText}>Ir al login</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.title}>Nueva contraseña</Text>
            <Text style={s.subtitle}>Elegí una contraseña segura para tu cuenta.</Text>

            <TextInput
              style={s.input}
              placeholder={`Nueva contraseña (mín. ${MIN_PASSWORD_LENGTH})`}
              placeholderTextColor="#8E8E93"
              value={password}
              onChangeText={text => {
                setPassword(text)
                setError(null)
              }}
              secureTextEntry
            />
            <TextInput
              style={s.input}
              placeholder="Repetí tu contraseña"
              placeholderTextColor="#8E8E93"
              value={confirm}
              onChangeText={text => {
                setConfirm(text)
                setError(null)
              }}
              secureTextEntry
            />
            {error && <Text style={s.error}>{error}</Text>}

            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.btnText}>Guardar contraseña</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#8E8E93', textAlign: 'center', marginBottom: 32 },
  input: {
    backgroundColor: '#2C2C2E',
    color: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  error: { color: '#FF453A', fontSize: 13, marginBottom: 8 },
  btn: { backgroundColor: '#FF6B35', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
