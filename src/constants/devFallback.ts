// ⚠️ DEV ONLY — fallback temporal mientras no existe el flujo de "camión
// propio" para independientes. Solo se aplica si __DEV__ es true, así que
// no puede filtrarse a un build de producción/EAS por accidente.
// Valores de un camión pesado a propósito, para poder ver las restricciones
// (heavy_vehicle_allowed) funcionando al testear rutas.
// TODO: borrar este archivo + sus 2 usos (index.tsx y profile.tsx) cuando
// esté el flujo real de alta de camión propio.
export const DEV_FALLBACK_VEHICLE = {
  id: 'dev-test-truck',
  user_id: '',
  plate: 'TEST123',
  name: 'Camión de prueba (dev)',
  weight_kg: 22000,
  height_m: 4.2,
  width_m: 2.5,
  length_m: 12,
  axles: 2,
  is_default: true,
  created_at: '',
}
