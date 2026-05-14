import React from 'react'
import { StatusBar } from 'expo-status-bar'
import { View, StyleSheet } from 'react-native'
import Navigation from './src/navigation'

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Navigation />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 }
})
