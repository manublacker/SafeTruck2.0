import { useState, useMemo } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/services/supabase'
import { signInWithGoogle } from '../../src/services/auth'
import { registerForPushNotifications } from '../../src/services/push'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'

export default function LoginScreen() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const setProfile = useStore(s => s.setProfile)
  const isDark     = useStore(s => s.isDark)
  const t          = getTheme(isDark)
  const s          = useMemo(() => makeStyles(t), [isDark])
  const router     = useRouter()

  const handleLogin = async () => {
    if (!email || !password) return Alert.alert('Error', 'Completá todos los campos')
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error

      let { data: profile } = await supabase
        .from('profiles').select('*').eq('id', data.user.id).single()

      if (!profile) {
        // No usar el email como nombre: cae al nombre del registro o un placeholder editable.
        const metaName = (data.user.user_metadata?.full_name as string)?.trim()
        const { data: newProfile } = await supabase
          .from('profiles')
          .insert({ id: data.user.id, full_name: metaName || 'Conductor', email: data.user.email })
          .select().single()
        profile = newProfile
      }

      if (profile) {
        setProfile(profile)
        void registerForPushNotifications()
        router.replace('/(tabs)/')
      }
    } catch (e: any) {
      Alert.alert('Error al ingresar', e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    try { await signInWithGoogle() }
    catch (e: any) { Alert.alert('Error con Google', e.message) }
    finally { setGoogleLoading(false) }
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.inner}>
        <Image
          source={isDark ? require('../../camion_padding.png') : require('../../logo-DARK.png')}
          style={s.logo}
          resizeMode="contain"
        />
        <Text style={s.title}>SafeTruck</Text>
        <Text style={s.subtitle}>Navegación para camiones en el AMBA</Text>

        <TextInput
          style={s.input}
          placeholder="Email"
          placeholderTextColor={t.textSoft}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
        />
        <View style={s.passwordWrap}>
          <TextInput
            style={s.passwordInput}
            placeholder="Contraseña"
            placeholderTextColor={t.textSoft}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType="password"
            autoComplete="password"
          />
          <TouchableOpacity
            onPress={() => setShowPassword(v => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={s.eyeBtn}
            accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={t.textMuted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.forgotLink} onPress={() => router.push('/auth/forgot-password')}>
          <Text style={s.forgotText}>¿Olvidaste tu contraseña?</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[s.btnPrimary, loading && s.btnDisabled]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Ingresar</Text>}
        </TouchableOpacity>

        <View style={s.dividerRow}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>o</Text>
          <View style={s.dividerLine} />
        </View>

        <TouchableOpacity style={[s.btnGhost, googleLoading && s.btnDisabled]} onPress={handleGoogle} disabled={googleLoading}>
          {googleLoading ? <ActivityIndicator color={t.text} /> : <Text style={s.btnGhostText}>Continuar con Google</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={s.link} onPress={() => router.push('/auth/register')}>
          <Text style={s.linkText}>¿No tenés cuenta? Registrate</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    inner:     { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
    logo:      { width: 180, height: 150, alignSelf: 'center' },
    title:     { fontSize: 32, fontWeight: '700', color: t.text, textAlign: 'center', marginBottom: 4 },
    subtitle:  { fontSize: 14, color: t.textMuted, textAlign: 'center', marginBottom: 40 },
    input: {
      backgroundColor: t.card, color: t.text,
      borderRadius: 12, padding: 16, marginBottom: 12, fontSize: 16,
      borderWidth: 1, borderColor: t.border,
    },
    passwordWrap: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: t.card, borderRadius: 12, marginBottom: 12,
      borderWidth: 1, borderColor: t.border, paddingRight: 10,
    },
    passwordInput: { flex: 1, color: t.text, padding: 16, fontSize: 16 },
    eyeBtn: { padding: 6 },
    forgotLink: { alignSelf: 'flex-end', marginBottom: 8 },
    forgotText: { color: t.info, fontSize: 13 },
    btnPrimary: {
      backgroundColor: t.accent, borderRadius: 12,
      padding: 16, alignItems: 'center', marginTop: 8,
    },
    btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    btnDisabled:    { opacity: 0.6 },
    dividerRow:  { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
    dividerLine: { flex: 1, height: 1, backgroundColor: t.border },
    dividerText: { color: t.textMuted, marginHorizontal: 12, fontSize: 13 },
    btnGhost: {
      backgroundColor: t.card, borderRadius: 12, padding: 16,
      alignItems: 'center', borderWidth: 1, borderColor: t.border,
    },
    btnGhostText: { color: t.text, fontSize: 16, fontWeight: '600' },
    link:     { marginTop: 20, alignItems: 'center' },
    linkText: { color: t.info, fontSize: 14, fontWeight: '600' },
  })
}
