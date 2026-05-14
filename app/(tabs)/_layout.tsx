import { Tabs } from 'expo-router'
import { useStore } from '../../src/store/useStore'
import { Redirect } from 'expo-router'

export default function TabLayout() {
  const profile = useStore(s => s.profile)
  if (!profile) return <Redirect href="/auth/login" />
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: '#2C2C2E', borderTopColor: '#3A3A3C' }, tabBarActiveTintColor: '#FF6B35', tabBarInactiveTintColor: '#8E8E93' }}>
      <Tabs.Screen name="index" options={{ title: 'Mapa', tabBarIcon: () => null }} />
      <Tabs.Screen name="trips" options={{ title: 'Viajes', tabBarIcon: () => null }} />
      <Tabs.Screen name="incidents" options={{ title: 'Alertas', tabBarIcon: () => null }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil', tabBarIcon: () => null }} />
    </Tabs>
  )
}
