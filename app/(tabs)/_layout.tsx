import { Tabs, Redirect } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { getTheme } from '../../src/theme'

export default function TabLayout() {
  const profile = useStore(s => s.profile)
  const isDark = useStore(s => s.isDark)
  const t = getTheme(isDark)

  if (!profile) return <Redirect href="/auth/login" />

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: t.card,
        borderTopWidth: 1,
        borderTopColor: t.border,
      },
      tabBarActiveTintColor: t.accent,
      tabBarInactiveTintColor: t.textMuted,
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    }}>
      <Tabs.Screen name="index"     options={{ title: 'Mapa',    tabBarIcon: () => null }} />
      <Tabs.Screen name="trips"     options={{ title: 'Viajes',  tabBarIcon: () => null }} />
      <Tabs.Screen name="incidents" options={{ title: 'Alertas', tabBarIcon: () => null }} />
      <Tabs.Screen name="profile"   options={{ title: 'Perfil',  tabBarIcon: () => null }} />
    </Tabs>
  )
}
