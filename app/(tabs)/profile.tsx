import { useState, useEffect, useMemo } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, ScrollView,
} from 'react-native'
import { supabase } from '../../src/services/supabase'
import { useStore } from '../../src/store/useStore'
import { getTheme, Theme } from '../../src/theme'

export default function ProfileScreen() {
  const { profile, setProfile, activeVehicle, setActiveVehicle, vehicles, setVehicles } = useStore()
  const isDark = useStore(st => st.isDark)
  const t = getTheme(isDark)
  const s = useMemo(() => makeStyles(t), [isDark])

  const [loading, setLoading] = useState(false)
  const [showAddVehicle, setShowAddVehicle] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<any>(null)

  const [plate, setPlate]   = useState('')
  const [name, setName]     = useState('')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [width, setWidth]   = useState('')
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

  const openEdit = (vehicle: any) => {
    setEditingVehicle(vehicle)
    setPlate(vehicle.plate)
    setName(vehicle.name || '')
    setWeight(String(vehicle.weight_kg))
    setHeight(String(vehicle.height_m))
    setWidth(String(vehicle.width_m))
    setLength(String(vehicle.length_m || ''))
    setShowAddVehicle(false)
  }

  const cancelEdit = () => {
    setEditingVehicle(null)
    setPlate(''); setName(''); setWeight(''); setHeight(''); setWidth(''); setLength('')
  }

  const saveVehicle = async () => {
    if (!plate || !weight || !height || !width)
      return Alert.alert('Error', 'Patente, peso, altura y ancho son obligatorios')
    if (!profile) return
    setLoading(true)
    try {
      if (editingVehicle) {
        const { data, error } = await supabase
          .from('st_vehicles')
          .update({
            plate: plate.toUpperCase(),
            name: name || plate.toUpperCase(),
            weight_kg: parseFloat(weight),
            height_m:  parseFloat(height),
            width_m:   parseFloat(width),
            length_m:  parseFloat(length) || 12,
          })
          .eq('id', editingVehicle.id)
          .select().single()
        if (error) throw error
        setActiveVehicle(data)
        setVehicles(vehicles.map(v => v.id === data.id ? data : v))
        setEditingVehicle(null)
      } else {
        const isFirst = vehicles.length === 0
        const { data, error } = await supabase
          .from('st_vehicles')
          .insert({
            user_id:    profile.id,
            plate:      plate.toUpperCase(),
            name:       name || plate.toUpperCase(),
            weight_kg:  parseFloat(weight),
            height_m:   parseFloat(height),
            width_m:    parseFloat(width),
            length_m:   parseFloat(length) || 12,
            is_default: isFirst,
          })
          .select().single()
        if (error) throw error
        setActiveVehicle(data)
        setVehicles([data, ...vehicles])
        setShowAddVehicle(false)
      }
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

      {/* Perfil */}
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
          <Text style={s.sectionLabel}> VEHÍCULO ACTIVO</Text>

          {editingVehicle?.id === activeVehicle.id ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Editar vehículo</Text>
              <VehicleForm
                s={s} t={t}
                plate={plate} setPlate={setPlate}
                name={name} setName={setName}
                weight={weight} setWeight={setWeight}
                height={height} setHeight={setHeight}
                width={width} setWidth={setWidth}
                length={length} setLength={setLength}
              />
              <View style={s.formActions}>
                <TouchableOpacity
                  style={[s.btnPrimary, { flex: 1 }, loading && s.btnDisabled]}
                  onPress={saveVehicle} disabled={loading}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Guardar</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnGhost, { flex: 1 }]} onPress={cancelEdit}>
                  <Text style={s.btnGhostText}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={s.vehicleCard}>
              <TouchableOpacity style={s.editBtn} onPress={() => openEdit(activeVehicle)}>
                <Text style={s.editBtnText}>Editar</Text>
              </TouchableOpacity>
              <Text style={s.vehicleName}>{activeVehicle.name || activeVehicle.plate}</Text>
              <Text style={s.vehiclePlate}>{activeVehicle.plate}</Text>
              <View style={s.specsRow}>
                {[
                  { val: `${activeVehicle.weight_kg} kg`, lbl: 'PESO' },
                  { val: `${activeVehicle.height_m} m`,   lbl: 'ALTURA' },
                  { val: `${activeVehicle.width_m} m`,    lbl: 'ANCHO' },
                ].map(spec => (
                  <View key={spec.lbl} style={s.spec}>
                    <Text style={s.specVal}>{spec.val}</Text>
                    <Text style={s.specLbl}>{spec.lbl}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Lista de vehículos */}
      {vehicles.length > 1 && (
        <View style={s.section}>
          <Text style={s.sectionLabel}> MIS VEHÍCULOS</Text>
          {vehicles.map(v => (
            <TouchableOpacity
              key={v.id}
              style={[s.vehicleItem, activeVehicle?.id === v.id && s.vehicleItemActive]}
              onPress={() => setDefault(v)}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.vehicleItemName}>{v.name || v.plate}</Text>
                <Text style={s.vehicleItemSub}>{v.plate} · {v.weight_kg} kg · {v.height_m} m alt</Text>
              </View>
              {activeVehicle?.id === v.id && (
                <View style={s.checkBadge}>
                  <Text style={s.checkBadgeText}>Activo</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Agregar vehículo */}
      <TouchableOpacity style={s.addBtn} onPress={() => setShowAddVehicle(!showAddVehicle)}>
        <Text style={s.addBtnText}>{showAddVehicle ? '✕  Cancelar' : '+  Agregar vehículo'}</Text>
      </TouchableOpacity>

      {showAddVehicle && (
        <View style={[s.card, { marginTop: 8 }]}>
          <Text style={s.cardTitle}>Nuevo vehículo</Text>
          <VehicleForm
            s={s} t={t}
            plate={plate} setPlate={setPlate}
            name={name} setName={setName}
            weight={weight} setWeight={setWeight}
            height={height} setHeight={setHeight}
            width={width} setWidth={setWidth}
            length={length} setLength={setLength}
          />
          <TouchableOpacity
            style={[s.btnPrimary, loading && s.btnDisabled]}
            onPress={saveVehicle} disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Guardar vehículo</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

// Sub-componente del formulario para no repetir código
function VehicleForm({ s, t, plate, setPlate, name, setName, weight, setWeight, height, setHeight, width, setWidth, length, setLength }: any) {
  return (
    <>
      <View style={s.field}>
        <Text style={s.fieldLabel}>PATENTE *</Text>
        <TextInput style={s.input} placeholder="ABC 123" placeholderTextColor={t.textSoft}
          value={plate} onChangeText={setPlate} autoCapitalize="characters" />
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>NOMBRE DEL VEHÍCULO</Text>
        <TextInput style={s.input} placeholder="Ej: Mercedes Actros" placeholderTextColor={t.textSoft}
          value={name} onChangeText={setName} />
      </View>
      <View style={s.formRow}>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.fieldLabel}>PESO TOTAL (kg) *</Text>
          <TextInput style={s.input} placeholder="25000" placeholderTextColor={t.textSoft}
            value={weight} onChangeText={setWeight} keyboardType="numeric" />
        </View>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.fieldLabel}>ALTURA (m) *</Text>
          <TextInput style={s.input} placeholder="4.2" placeholderTextColor={t.textSoft}
            value={height} onChangeText={setHeight} keyboardType="numeric" />
        </View>
      </View>
      <View style={s.formRow}>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.fieldLabel}>ANCHO (m) *</Text>
          <TextInput style={s.input} placeholder="2.6" placeholderTextColor={t.textSoft}
            value={width} onChangeText={setWidth} keyboardType="numeric" />
        </View>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.fieldLabel}>LARGO (m)</Text>
          <TextInput style={s.input} placeholder="12" placeholderTextColor={t.textSoft}
            value={length} onChangeText={setLength} keyboardType="numeric" />
        </View>
      </View>
    </>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    content: { padding: 16, paddingTop: 60, paddingBottom: 100 },

    // Header de perfil
    profileCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1, borderColor: t.cardBorder,
      padding: 16, marginBottom: 24,
    },
    avatar: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: t.accent,
      alignItems: 'center', justifyContent: 'center', marginRight: 12,
    },
    avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
    profileInfo: { flex: 1 },
    profileName: { color: t.text, fontSize: 15, fontWeight: '600' },
    profileSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    logoutBtn: { backgroundColor: t.dangerSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    logoutText: { color: t.danger, fontSize: 13, fontWeight: '600' },

    // Secciones
    section: { marginBottom: 20 },
    sectionLabel: {
      fontSize: 11, fontWeight: '700', color: t.textMuted,
      letterSpacing: 0.8, marginBottom: 10,
    },

    // Card genérica (--dash-card style)
    card: {
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1, borderColor: t.cardBorder,
      padding: 20,
    },
    cardTitle: { color: t.text, fontSize: 16, fontWeight: '700', marginBottom: 16 },

    // Vehículo activo (con borde accent como --dash-plan--current)
    vehicleCard: {
      backgroundColor: t.card, borderRadius: 16,
      borderWidth: 1.5, borderColor: t.accent,
      padding: 20, position: 'relative',
    },
    editBtn: {
      position: 'absolute', top: 12, right: 12,
      backgroundColor: t.surface2, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 5,
    },
    editBtnText: { color: t.accent, fontSize: 13, fontWeight: '600' },
    vehicleName: { color: t.text, fontSize: 18, fontWeight: '700', marginBottom: 2, paddingRight: 60 },
    vehiclePlate: { color: t.textMuted, fontSize: 13, marginBottom: 16 },
    specsRow: { flexDirection: 'row' },
    spec: { flex: 1, alignItems: 'center' },
    specVal: { color: t.accent, fontSize: 17, fontWeight: '700' },
    specLbl: { color: t.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginTop: 2 },

    // Lista de vehículos
    vehicleItem: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: t.card, borderRadius: 12,
      borderWidth: 1, borderColor: t.cardBorder,
      padding: 14, marginBottom: 8,
    },
    vehicleItemActive: { borderColor: t.accent },
    vehicleItemName: { color: t.text, fontSize: 14, fontWeight: '600' },
    vehicleItemSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    checkBadge: {
      backgroundColor: t.accentSoft, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 4,
    },
    checkBadgeText: { color: t.accent, fontSize: 12, fontWeight: '600' },

    // Botón agregar vehículo
    addBtn: {
      backgroundColor: t.card, borderRadius: 12,
      borderWidth: 1, borderColor: t.border, borderStyle: 'dashed',
      padding: 16, alignItems: 'center',
    },
    addBtnText: { color: t.accent, fontSize: 14, fontWeight: '600' },

    // Formulario (--dash-form style)
    field: { marginBottom: 12 },
    fieldLabel: {
      fontSize: 11, fontWeight: '700', color: t.textMuted,
      letterSpacing: 0.8, marginBottom: 5,
    },
    input: {
      backgroundColor: t.surface2, color: t.text,
      borderWidth: 1, borderColor: 'transparent',
      borderRadius: 10, padding: 13, fontSize: 15,
    },
    formRow: { flexDirection: 'row', gap: 10 },
    formActions: { flexDirection: 'row', gap: 10, marginTop: 8 },

    // Botones (--dash-btn style)
    btnPrimary: {
      backgroundColor: t.accent, borderRadius: 10,
      padding: 14, alignItems: 'center',
    },
    btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
    btnDisabled: { opacity: 0.6 },
    btnGhost: {
      backgroundColor: t.surface2, borderRadius: 10,
      padding: 14, alignItems: 'center',
    },
    btnGhostText: { color: t.text, fontSize: 15, fontWeight: '600' },
  })
}
