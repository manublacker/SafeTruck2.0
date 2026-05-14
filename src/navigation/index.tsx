import React, { useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native'
import { useStore } from '../store/useStore'
import { COLORS } from '../constants'

import LoginScreen from '../screens/auth/LoginScreen'
import RegisterScreen from '../screens/auth/RegisterScreen'
import MapScreen from '../screens/map/MapScreen'
import ProfileScreen from '../screens/profile/ProfileScreen'
import VehiclesScreen from '../screens/profile/VehiclesScreen'
import TripsScreen from '../screens/trips/TripsScreen'
import IncidentsScreen from '../screens/incidents/IncidentsScreen'

const RootStack = createStackNavigator()
const AuthStack = createStackNavigator()

const TABS = [
  { key: 'Map', label: 'Mapa', icon: '🗺️' },
  { key: 'Trips', label: 'Viajes', icon: '📋' },
  { key: 'Incidents', label: 'Alertas', icon: '⚠️' },
  { key: 'Profile', label: 'Perfil', icon: '👤' },
]

function CustomTabBar({ active, onPress }: { active: string; onPress: (k: string) => void }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map(tab => (
        <TouchableOpacity key={tab.key} style={styles.tabItem} onPress={() => onPress(tab.key)}>
          <Text style={styles.tabIcon}>{tab.icon}</Text>
          <Text style={[styles.tabLabel, active === tab.key && styles.tabLabelActive]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

function MainScreen() {
  const [activeTab, setActiveTab] = useState('Map')
  const renderScreen = () => {
    switch (activeTab) {
      case 'Map': return <MapScreen />
      case 'Trips': return <TripsScreen />
      case 'Incidents': return <IncidentsScreen />
      case 'Profile': return <ProfileScreen />
      default: return <MapScreen />
    }
  }
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screen}>{renderScreen()}</View>
      <CustomTabBar active={activeTab} onPress={setActiveTab} />
    </SafeAreaView>
  )
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  )
}

export default function Navigation() {
  const profile = useStore(s => s.profile)
  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {profile
          ? <RootStack.Screen name="Main" component={MainScreen} />
          : <RootStack.Screen name="Auth" component={AuthNavigator} />
        }
      </RootStack.Navigator>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingBottom: 8,
    paddingTop: 8,
    height: 64,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { fontSize: 20 },
  tabLabel: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  tabLabelActive: { color: COLORS.primary },
})
