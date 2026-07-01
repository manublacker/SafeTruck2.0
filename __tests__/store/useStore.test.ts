/**
 * Tests del store global de Zustand (`src/store/useStore.ts`). Se ejercitan las
 * acciones síncronas sobre el estado (tema, perfil, vehículos, ruta,
 * incidentes, UI) leyendo/escribiendo vía getState()/setState().
 *
 * Nota: react-native (Appearance) y demás nativos están stubbeados por
 * jest.config. El estado del store es un singleton de módulo, así que cada test
 * lo resetea a un snapshot inicial en beforeEach.
 */
import { useStore } from '../../src/store/useStore'

// Snapshot del estado "de datos" para restaurar entre tests (sin las acciones).
const INITIAL = {
  isDark: useStore.getState().isDark,
  profile: null,
  activeVehicle: null,
  vehicles: [],
  origin: null,
  destination: null,
  destinationAddress: '',
  currentRoute: null,
  isNavigating: false,
  incidents: [],
  isLoading: false,
}

beforeEach(() => {
  useStore.setState({ ...INITIAL })
})

const s = () => useStore.getState()

describe('useStore — estado inicial', () => {
  it('arranca sin perfil', () => {
    expect(s().profile).toBeNull()
  })
  it('arranca sin vehículo activo y con lista vacía', () => {
    expect(s().activeVehicle).toBeNull()
    expect(s().vehicles).toEqual([])
  })
  it('arranca sin ruta ni navegación activa', () => {
    expect(s().currentRoute).toBeNull()
    expect(s().origin).toBeNull()
    expect(s().destination).toBeNull()
    expect(s().destinationAddress).toBe('')
    expect(s().isNavigating).toBe(false)
  })
  it('arranca sin incidentes', () => {
    expect(s().incidents).toEqual([])
  })
  it('arranca sin loading', () => {
    expect(s().isLoading).toBe(false)
  })
  it('expone todas las acciones como funciones', () => {
    const st = s()
    for (const action of [
      'toggleTheme',
      'setProfile',
      'setActiveVehicle',
      'setVehicles',
      'setOrigin',
      'setDestination',
      'setCurrentRoute',
      'setIsNavigating',
      'clearRoute',
      'setIncidents',
      'addIncident',
      'setIsLoading',
    ] as const) {
      expect(typeof (st as any)[action]).toBe('function')
    }
  })
})

describe('useStore — tema', () => {
  it('toggleTheme invierte isDark', () => {
    const before = s().isDark
    s().toggleTheme()
    expect(s().isDark).toBe(!before)
  })
  it('dos toggles vuelven al valor original', () => {
    const before = s().isDark
    s().toggleTheme()
    s().toggleTheme()
    expect(s().isDark).toBe(before)
  })
  it('toggleTheme es idempotente en paridad tras número par de llamadas', () => {
    const before = s().isDark
    for (let i = 0; i < 10; i++) s().toggleTheme()
    expect(s().isDark).toBe(before)
  })
  it('un número impar de toggles invierte el valor', () => {
    const before = s().isDark
    for (let i = 0; i < 7; i++) s().toggleTheme()
    expect(s().isDark).toBe(!before)
  })
})

describe('useStore — perfil', () => {
  it('setProfile guarda el perfil', () => {
    const profile = { id: 'u1', full_name: 'Juan', email: 'juan@x.com' } as any
    s().setProfile(profile)
    expect(s().profile).toBe(profile)
  })
  it('setProfile(null) limpia el perfil', () => {
    s().setProfile({ id: 'u1' } as any)
    s().setProfile(null)
    expect(s().profile).toBeNull()
  })
  it('sobrescribe un perfil previo', () => {
    s().setProfile({ id: 'a' } as any)
    s().setProfile({ id: 'b' } as any)
    expect(s().profile).toEqual({ id: 'b' })
  })
})

describe('useStore — vehículos', () => {
  it('setActiveVehicle setea el vehículo activo', () => {
    const v = { id: 'v1', plate: 'ABC123' } as any
    s().setActiveVehicle(v)
    expect(s().activeVehicle).toBe(v)
  })
  it('setActiveVehicle(null) limpia el vehículo activo', () => {
    s().setActiveVehicle({ id: 'v1' } as any)
    s().setActiveVehicle(null)
    expect(s().activeVehicle).toBeNull()
  })
  it('setVehicles reemplaza la lista completa', () => {
    const list = [{ id: 'v1' }, { id: 'v2' }] as any
    s().setVehicles(list)
    expect(s().vehicles).toBe(list)
    expect(s().vehicles).toHaveLength(2)
  })
  it('setVehicles con lista vacía deja la lista vacía', () => {
    s().setVehicles([{ id: 'v1' }] as any)
    s().setVehicles([])
    expect(s().vehicles).toEqual([])
  })
  it('el vehículo activo es independiente de la lista', () => {
    const v = { id: 'v9' } as any
    s().setVehicles([{ id: 'v1' }] as any)
    s().setActiveVehicle(v)
    expect(s().activeVehicle).toBe(v)
    expect(s().vehicles).toHaveLength(1)
  })
})

describe('useStore — ruta y navegación', () => {
  it('setOrigin setea el origen', () => {
    const o = { latitude: -34.6, longitude: -58.38 } as any
    s().setOrigin(o)
    expect(s().origin).toBe(o)
  })
  it('setDestination setea coordenadas y dirección', () => {
    const d = { latitude: -34.9, longitude: -57.95 } as any
    s().setDestination(d, 'La Plata')
    expect(s().destination).toBe(d)
    expect(s().destinationAddress).toBe('La Plata')
  })
  it('setDestination sin dirección usa string vacío por default', () => {
    const d = { latitude: 0, longitude: 0 } as any
    s().setDestination(d)
    expect(s().destinationAddress).toBe('')
  })
  it('setDestination(null) permite limpiar el destino', () => {
    s().setDestination({ latitude: 1, longitude: 1 } as any, 'X')
    s().setDestination(null)
    expect(s().destination).toBeNull()
    expect(s().destinationAddress).toBe('')
  })
  it('setCurrentRoute guarda la ruta', () => {
    const r = { distanceM: 1000 } as any
    s().setCurrentRoute(r)
    expect(s().currentRoute).toBe(r)
  })
  it('setIsNavigating alterna el flag', () => {
    s().setIsNavigating(true)
    expect(s().isNavigating).toBe(true)
    s().setIsNavigating(false)
    expect(s().isNavigating).toBe(false)
  })
  it('clearRoute limpia ruta, destino, dirección y navegación', () => {
    s().setDestination({ latitude: 1, longitude: 1 } as any, 'X')
    s().setCurrentRoute({ distanceM: 5 } as any)
    s().setIsNavigating(true)
    s().clearRoute()
    expect(s().currentRoute).toBeNull()
    expect(s().destination).toBeNull()
    expect(s().destinationAddress).toBe('')
    expect(s().isNavigating).toBe(false)
  })
  it('clearRoute NO borra el origen (se mantiene la posición actual)', () => {
    const o = { latitude: -34.6, longitude: -58.38 } as any
    s().setOrigin(o)
    s().setDestination({ latitude: 1, longitude: 1 } as any, 'X')
    s().clearRoute()
    expect(s().origin).toBe(o)
  })
})

describe('useStore — incidentes', () => {
  it('setIncidents reemplaza la lista', () => {
    const list = [{ id: 1 }, { id: 2 }] as any
    s().setIncidents(list)
    expect(s().incidents).toBe(list)
  })
  it('addIncident agrega al FRENTE de la lista', () => {
    s().setIncidents([{ id: 1 }] as any)
    s().addIncident({ id: 2 } as any)
    expect(s().incidents.map((i: any) => i.id)).toEqual([2, 1])
  })
  it('addIncident sobre lista vacía crea lista de un elemento', () => {
    s().addIncident({ id: 99 } as any)
    expect(s().incidents).toHaveLength(1)
    expect((s().incidents[0] as any).id).toBe(99)
  })
  it('varios addIncident mantienen orden LIFO (el último queda primero)', () => {
    s().addIncident({ id: 1 } as any)
    s().addIncident({ id: 2 } as any)
    s().addIncident({ id: 3 } as any)
    expect(s().incidents.map((i: any) => i.id)).toEqual([3, 2, 1])
  })
  it('addIncident no muta la lista anterior (inmutabilidad)', () => {
    const original = [{ id: 1 }] as any
    s().setIncidents(original)
    s().addIncident({ id: 2 } as any)
    expect(original).toHaveLength(1)
  })
  it('setIncidents([]) vacía la lista', () => {
    s().addIncident({ id: 1 } as any)
    s().setIncidents([])
    expect(s().incidents).toEqual([])
  })
})

describe('useStore — UI loading', () => {
  it('setIsLoading(true) activa loading', () => {
    s().setIsLoading(true)
    expect(s().isLoading).toBe(true)
  })
  it('setIsLoading(false) desactiva loading', () => {
    s().setIsLoading(true)
    s().setIsLoading(false)
    expect(s().isLoading).toBe(false)
  })
})

describe('useStore — aislamiento entre acciones', () => {
  it('setear una parte del estado no pisa otras', () => {
    const profile = { id: 'u1' } as any
    const vehicle = { id: 'v1' } as any
    s().setProfile(profile)
    s().setActiveVehicle(vehicle)
    s().setIsLoading(true)
    s().setIsNavigating(true)
    expect(s().profile).toBe(profile)
    expect(s().activeVehicle).toBe(vehicle)
    expect(s().isLoading).toBe(true)
    expect(s().isNavigating).toBe(true)
  })
  it('clearRoute no afecta perfil ni vehículos ni incidentes', () => {
    s().setProfile({ id: 'u1' } as any)
    s().setVehicles([{ id: 'v1' }] as any)
    s().setIncidents([{ id: 1 }] as any)
    s().clearRoute()
    expect(s().profile).toEqual({ id: 'u1' })
    expect(s().vehicles).toHaveLength(1)
    expect(s().incidents).toHaveLength(1)
  })
})
