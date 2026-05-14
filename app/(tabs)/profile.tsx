import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView } from 'react-native'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'

export default function ProfileScreen() {
  const { profile, setProfile, activeVehicle, setActiveVehicle, vehicles, setVehicles } = useStore()
  const [loading, setLoading] = useState(false)
  const [showAddVehicle, setShowAddVehicle] = useState(false)

  // Form nuevo vehículo
  const [plate, setPlate] = useState('')
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [width, setWidth] = useState('')
  const [length, setLength] = useState('')

  useEffect(() => { loadVehicles() }, [])

  const loadVehicles = async () => {
    if (!profile) return
    const { data } = await supabase
      .from('st_vehicles')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
    if (data) {
      setVehicles(data)
      const def = data.find(v => v.is_default) || data[0]
      if (def) setActiveVehicle(def)
    }
  }

  const saveVehicle = async () => {
    if (!plate || !weight || !height || !width) return Alert.alert('Error', 'Patente, peso, altura y ancho son obligatorios')
    if (!profile) return
    setLoading(true)
    try {
      const isFirst = vehicles.length === 0
      const { data, error } = await supabase
        .from('st_vehicles')
        .insert({
          user_id: profile.id,
          plate: plate.toUpperCase(),
          name: name || plate.toUpperCase(),
          weight_kg: parseFloat(weight),
          height_m: parseFloat(height),
          width_m: parseFloat(width),
          length_m: parseFloat(length) || 12,
          is_default: isFirst,
        })
        .select()
        .single()
      if (error) throw error
      setActiveVehicle(data)
      setVehicles([data, ...vehicles])
      setShowAddVehicle(false)
      setPlate(''); setName(''); setWeight(''); setHeight(''); setWidth(''); setLength('')
      Alert.alert('✅', 'Vehículo guardado')
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  const setDefault = async (vehicle: any) => {
    if (!profile) return
    await supabase.from('st_vehicles').update({ is_default: false }).eq('user_id', profile.id)
    await supabase.from('st_vehicles').update({ is_default: true }).eq('id', vehicle.id)
    setActiveVehicle(vehicle)
    loadVehicles()
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Header perfil */}
      <View style={s.profileCard}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{profile?.full_name?.[0]?.toUpperCase() || '?'}</Text>
        </View>
        <View style={s.profileInfo}>
          <Text style={s.profileName}>{profile?.full_name}</Text>
          <Text style={s.profileSub}>Conductor registrado</Text>
        </View>
        <TouchableOpacity style={s.logoutBtn} onPress={logout}>
          <Text style={s.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* Vehículo activo */}
      {activeVehicle && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>🚛 Vehículo activo</Text>
          <View style={s.vehicleCard}>
            <Text style={s.vehicleName}>{activeVehicle.name || activeVehicle.plate}</Text>
            <Text style={s.vehiclePlate}>{activeVehicle.plate}</Text>
            <View style={s.vehicleSpecs}>
              <View style={s.spec}><Text style={s.specVal}>{activeVehicle.weight_kg} kg</Text><Text style={s.specLbl}>Peso</Text></View>
              <View style={s.spec}><Text style={s.specVal}>{activeVehicle.height_m} m</Text><Text style={s.specLbl}>Altura</Text></View>
              <View style={s.spec}><Text style={s.specVal}>{activeVehicle.width_m} m</Text><Text style={s.specLbl}>Ancho</Text></View>
            </View>
          </View>
        </View>
      )}

      {/* Lista de vehículos */}
      {vehicles.length > 1 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Mis vehículos</Text>
          {vehicles.map(v => (
            <TouchableOpacity key={v.id} style={[s.vehicleItem, activeVehicle?.id === v.id && s.vehicleItemActive]} onPress={() => setDefault(v)}>
              <View>
                <Text style={s.vehicleItemName}>{v.name || v.plate}</Text>
                <Text style={s.vehicleItemPlate}>{v.plate} · {v.weight_kg}kg · {v.height_m}m alt</Text>
              </View>
              {activeVehicle?.id === v.id && <Text style={s.vehicleItemCheck}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Agregar vehículo */}
      <TouchableOpacity style={s.addBtn} onPress={() => setShowAddVehicle(!showAddVehicle)}>
        <Text style={s.addBtnText}>{showAddVehicle ? '✕ Cancelar' : '+ Agregar vehículo'}</Text>
      </TouchableOpacity>

      {showAddVehicle && (
        <View style={s.form}>
          <Text style={s.formTitle}>Nuevo vehículo</Text>
          <TextInput style={s.input} placeholder="Patente *" placeholderTextColor="#8E8E93" value={plate} onChangeText={setPlate} autoCapitalize="characters" />
          <TextInput style={s.input} placeholder="Nombre (ej: Mercedes Actros)" placeholderTextColor="#8E8E93" value={name} onChangeText={setName} />
          <View style={s.row}>
            <TextInput style={[s.input, s.inputHalf]} placeholder="Peso total (kg) *" placeholderTextColor="#8E8E93" value={weight} onChangeText={setWeight} keyboardType="numeric" />
            <TextInput style={[s.input, s.inputHalf]} placeholder="Altura (m) *" placeholderTextColor="#8E8E93" value={height} onChangeText={setHeight} keyboardType="numeric" />
          </View>
          <View style={s.row}>
            <TextInput style={[s.input, s.inputHalf]} placeholder="Ancho (m) *" placeholderTextColor="#8E8E93" value={width} onChangeText={setWidth} keyboardType="numeric" />
            <TextInput style={[s.input, s.inputHalf]} placeholder="Largo (m)" placeholderTextColor="#8E8E93" value={length} onChangeText={setLength} keyboardType="numeric" />
          </View>
          <TouchableOpacity style={[s.saveBtn, loading && s.saveBtnDisabled]} onPress={saveVehicle} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Guardar vehículo</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  content: { padding: 16, paddingBottom: 100 },
  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2C2C2E', borderRadius: 16, padding: 16, marginBottom: 20 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FF6B35', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileInfo: { flex: 1 },
  profileName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  profileSub: { color: '#8E8E93', fontSize: 13, marginTop: 2 },
  logoutBtn: { backgroundColor: '#3A3A3C', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  logoutText: { color: '#FF3B30', fontSize: 13, fontWeight: '600' },
  section: { marginBottom: 20 },
  sectionTitle: { color: '#8E8E93', fontSize: 13, fontWeight: '600', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  vehicleCard: { backgroundColor: '#2C2C2E', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#FF6B35' },
  vehicleName: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 2 },
  vehiclePlate: { color: '#8E8E93', fontSize: 13, marginBottom: 12 },
  vehicleSpecs: { flexDirection: 'row' },
  spec: { flex: 1, alignItems: 'center' },
  specVal: { color: '#FF6B35', fontSize: 18, fontWeight: '700' },
  specLbl: { color: '#8E8E93', fontSize: 11, marginTop: 2 },
  vehicleItem: { backgroundColor: '#2C2C2E', borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vehicleItemActive: { borderWidth: 1, borderColor: '#FF6B35' },
  vehicleItemName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  vehicleItemPlate: { color: '#8E8E93', fontSize: 12, marginTop: 2 },
  vehicleItemCheck: { color: '#FF6B35', fontSize: 20 },
  addBtn: { backgroundColor: '#2C2C2E', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#3A3A3C', borderStyle: 'dashed' },
  addBtnText: { color: '#FF6B35', fontSize: 15, fontWeight: '600' },
  form: { backgroundColor: '#2C2C2E', borderRadius: 16, padding: 16 },
  formTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 16 },
  input: { backgroundColor: '#3A3A3C', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, fontSize: 15 },
  row: { flexDirection: 'row', gap: 10 },
  inputHalf: { flex: 1 },
  saveBtn: { backgroundColor: '#FF6B35', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 6 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
