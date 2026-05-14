import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, ScrollView
} from 'react-native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { supabase } from '../../services/supabase'
import { useStore } from '../../store/useStore'
import { COLORS } from '../../constants'
import { AuthStackParamList } from '../../navigation'

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Register'>
}

export default function RegisterScreen({ navigation }: Props) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const setProfile = useStore((s) => s.setProfile)

  const handleRegister = async () => {
    if (!fullName || !email || !password) {
      Alert.alert('Error', 'Nombre, email y contraseña son obligatorios')
      return
    }
    if (password.length < 6) {
      Alert.alert('Error', 'La contraseña debe tener al menos 6 caracteres')
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) throw error
      if (!data.user) throw new Error('No se pudo crear el usuario')

      // Actualizar perfil con phone si lo ingresó
      if (phone) {
        await supabase
          .from('st_profiles')
          .update({ phone, full_name: fullName })
          .eq('id', data.user.id)
      }

      const { data: profile, error: profileError } = await supabase
        .from('st_profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()

      if (profileError) throw profileError
      setProfile(profile)
    } catch (e: any) {
      Alert.alert('Error al registrarse', e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.logo}>🚛</Text>
        <Text style={styles.title}>Crear cuenta</Text>
        <Text style={styles.subtitle}>SafeTruck — AMBA</Text>

        <TextInput
          style={styles.input}
          placeholder="Nombre completo *"
          placeholderTextColor={COLORS.textSecondary}
          value={fullName}
          onChangeText={setFullName}
        />
        <TextInput
          style={styles.input}
          placeholder="Email *"
          placeholderTextColor={COLORS.textSecondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Contraseña * (mín. 6 caracteres)"
          placeholderTextColor={COLORS.textSecondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          placeholder="Teléfono (opcional)"
          placeholderTextColor={COLORS.textSecondary}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Registrarme</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.linkText}>¿Ya tenés cuenta? Ingresá</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  inner: {
    flexGrow: 1, justifyContent: 'center',
    paddingHorizontal: 32, paddingVertical: 60
  },
  logo: { fontSize: 56, textAlign: 'center', marginBottom: 8 },
  title: {
    fontSize: 28, fontWeight: '700', color: COLORS.text,
    textAlign: 'center', marginBottom: 4
  },
  subtitle: {
    fontSize: 14, color: COLORS.textSecondary,
    textAlign: 'center', marginBottom: 32
  },
  input: {
    backgroundColor: COLORS.card, color: COLORS.text,
    borderRadius: 12, padding: 16, marginBottom: 12,
    fontSize: 16, borderWidth: 1, borderColor: COLORS.border
  },
  button: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    padding: 16, alignItems: 'center', marginTop: 8
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkButton: { marginTop: 20, alignItems: 'center' },
  linkText: { color: COLORS.primary, fontSize: 14 },
})
