import { create } from 'zustand'
import { Profile, Vehicle, Route, Coordinates, Incident } from '../types'

interface AppState {
  // Auth
  profile: Profile | null
  setProfile: (profile: Profile | null) => void

  // Vehículo activo
  activeVehicle: Vehicle | null
  vehicles: Vehicle[]
  setActiveVehicle: (vehicle: Vehicle) => void
  setVehicles: (vehicles: Vehicle[]) => void

  // Navegación/Ruta
  origin: Coordinates | null
  destination: Coordinates | null
  destinationAddress: string
  currentRoute: Route | null
  isNavigating: boolean
  setOrigin: (coords: Coordinates | null) => void
  setDestination: (coords: Coordinates | null, address?: string) => void
  setCurrentRoute: (route: Route | null) => void
  setIsNavigating: (val: boolean) => void
  clearRoute: () => void

  // Incidentes
  incidents: Incident[]
  setIncidents: (incidents: Incident[]) => void
  addIncident: (incident: Incident) => void

  // UI
  isLoading: boolean
  setIsLoading: (val: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  // Auth
  profile: null,
  setProfile: (profile) => set({ profile }),

  // Vehículos
  activeVehicle: null,
  vehicles: [],
  setActiveVehicle: (vehicle) => set({ activeVehicle: vehicle }),
  setVehicles: (vehicles) => set({ vehicles }),

  // Ruta
  origin: null,
  destination: null,
  destinationAddress: '',
  currentRoute: null,
  isNavigating: false,
  setOrigin: (origin) => set({ origin }),
  setDestination: (coords, address = '') =>
    set({ destination: coords, destinationAddress: address }),
  setCurrentRoute: (route) => set({ currentRoute: route }),
  setIsNavigating: (isNavigating) => set({ isNavigating }),
  clearRoute: () =>
    set({
      currentRoute: null,
      destination: null,
      destinationAddress: '',
      isNavigating: false,
    }),

  // Incidentes
  incidents: [],
  setIncidents: (incidents) => set({ incidents }),
  addIncident: (incident) =>
    set((state) => ({ incidents: [incident, ...state.incidents] })),

  // UI
  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),
}))
