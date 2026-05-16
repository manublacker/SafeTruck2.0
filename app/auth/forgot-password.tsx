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
import { isValidEmail, sendPasswordReset } from '../../src/services/auth'

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleSend = async () => {
    if (!isValidEmail(email)) {
      setError('Ingresá un email válido')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await sendPasswordReset(email)
      setSent(true)
    } catch (e: any) {
      setError(e.message ?? 'No se pudo enviar el email')
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
        {sent ? (
          <>
            <Text style={s.title}>Revisá tu email</Text>
            <Text style={s.subtitle}>
              Te enviamos un link para restablecer tu contraseña a {email.trim()}.
            </Text>
            <TouchableOpacity style={s.btn} onPress={() => router.replace('/auth/login')}>
              <Text style={s.btnText}>Volver al login</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.title}>Restablecer contraseña</Text>
            <Text style={s.subtitle}>Ingresá tu email y te enviamos un link.</Text>

            <TextInput
              style={s.input}
              placeholder="empresa@mail.com"
              placeholderTextColor="#8E8E93"
              value={email}
              onChangeText={text => {
                setEmail(text)
                setError(null)
              }}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            {error && <Text style={s.error}>{error}</Text>}

            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={handleSend}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.btnText}>Enviar link</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={s.link} onPress={() => router.back()}>
              <Text style={s.linkText}>Volver al login</Text>
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
  link: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#FF6B35', fontSize: 14 },
})
