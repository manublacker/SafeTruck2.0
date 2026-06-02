import { Tabs, Redirect } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { getTheme } from '../../src/theme'

export default function TabLayout() {
  const profile = useStore(s => s.profile)
  const isDark  = useStore(s => s.isDark)
  const t       = getTheme(isDark)

  if (!profile) return <Redirect href="/auth/login" />

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: t.navy,
        borderTopWidth: 0,
        elevation: 0,
        shadowOpacity: 0,
        height: 72,
        paddingBottom: 6,
        paddingTop: 12,
      },
      tabBarActiveTintColor: '#FFFFFF',
      tabBarInactiveTintColor: t.navyText,
      tabBarLabelStyle: { fontSize: 13, fontWeight: '600', marginTop: -4 },
    }}>
      <Tabs.Screen name="index"   options={{ title: 'Mapa',   tabBarIcon: () => null }} />
      <Tabs.Screen name="trips"   options={{ title: 'Viajes', tabBarIcon: () => null }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil', tabBarIcon: () => null }} />
      <Tabs.Screen name="incidents" options={{ href: null }} />
    </Tabs>
  )
}
