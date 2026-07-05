import { Redirect, Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStore } from '../../src/store/useStore'
import { getTheme } from '../../src/theme'

type IoniconName = keyof typeof Ionicons.glyphMap

const ICONS: Record<string, [IoniconName, IoniconName]> = {
  index:       ['map-outline', 'map'],
  trips:       ['list-outline', 'list'],
  maintenance: ['construct-outline', 'construct'],
  profile:     ['person-outline', 'person'],
}

export default function TabLayout() {
  const profile = useStore(s => s.profile)
  const isDark  = useStore(s => s.isDark)
  const t       = getTheme(isDark)
  const insets  = useSafeAreaInsets()

  if (!profile) return <Redirect href="/auth/login" />

  const renderIcon = (name: string) =>
    ({ focused, color }: { focused: boolean; color: string }) => {
      const pair = ICONS[name]
      if (!pair) return null
      return <Ionicons name={pair[focused ? 1 : 0]} size={22} color={color} />
    }

  return (
    <Tabs
      // Mantiene las pantallas montadas al cambiar de tab (por defecto Android/iOS
      // las "detachan" y destruyen su vista nativa). Sin esto, el MapView se
      // recreaba cada vez que se volvía al Mapa: pantalla azul + recarga de tiles
      // y ruta. Con 4 tabs el costo de memoria es mínimo.
      detachInactiveScreens={false}
      screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: t.navy,
        borderTopWidth: 0,
        elevation: 0,
        shadowOpacity: 0,
        height: 62 + insets.bottom,
        paddingTop: 0,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
      },
      tabBarActiveTintColor: '#FFFFFF',
      tabBarInactiveTintColor: t.navyText,
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      // Centra verticalmente el ícono + label dentro de la barra (antes quedaban
      // pegados al borde de abajo).
      tabBarItemStyle: { justifyContent: 'center', paddingVertical: 6 },
    }}>
      <Tabs.Screen name="index"       options={{ title: 'Mapa',   tabBarIcon: renderIcon('index') }} />
      <Tabs.Screen name="trips"       options={{ title: 'Viajes', tabBarIcon: renderIcon('trips') }} />
      <Tabs.Screen name="maintenance" options={{ title: 'Manten.', tabBarIcon: renderIcon('maintenance') }} />
      <Tabs.Screen name="profile"     options={{ title: 'Perfil', tabBarIcon: renderIcon('profile') }} />
      <Tabs.Screen name="incidents" options={{ href: null }} />
    </Tabs>
  )
}
