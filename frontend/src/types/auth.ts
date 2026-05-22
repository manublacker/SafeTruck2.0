// types/auth.ts — contratos de autenticación y dominio de flota

export interface Truck {
  id: number;
  name: string;
  max_weight_kg: number;
  max_height_m: number;
  max_width_m: number;
  max_length_m: number;
  patente: string | null;
  modelo: string | null;
  anio: number | null;
  km_actual: number | null;
  fecha_service: string | null;
  proximo_service: string | null;
  estado: string;
  created_at: string;
  driver?: { id: number; nombre: string; telefono: string | null } | null;
}

export interface Driver {
  id: number;
  nombre: string;
  telefono: string | null;
  licencia: string | null;
  categoria_licencia: string | null;
  vencimiento_licencia: string | null;
  estado: string;
  is_active: boolean;
  created_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  company: string | null;
  trucks: Truck[];
  drivers: Driver[];
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface TruckPayload {
  name: string;
  max_weight_kg: number;
  max_height_m: number;
  max_width_m: number;
  max_length_m: number;
}

export interface RegisterPayload {
  email: string;
  password: string;
  full_name: string;
  company?: string;
  trucks?: TruckPayload[];
}

export interface LoginPayload {
  email: string;
  password: string;
}
