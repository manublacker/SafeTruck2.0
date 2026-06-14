export const AMBA_CENTER = {
  lat: -34.6037,
  lng: -58.3816,
}

export const AMBA_BOUNDS = {
  north: -34.2,
  south: -35.1,
  east: -57.8,
  west: -59.2,
}

export const ROUTING = {
  PENALTY_UNAUTHORIZED: 50,   // multiplicador de costo para calles no habilitadas
  PENALTY_UNKNOWN: 1.5,       // leve penalización para calles sin datos
  DEFAULT_SPEED_KMH: 40,
  SEARCH_RADIUS_M: 500,       // radio para buscar segmento más cercano
}

export const INCIDENT_LABELS: Record<string, string> = {
  multa:            '💸 Multa a camión',
  accidente:        '🚨 Accidente',
  control_policial: '👮 Control policial',
  obra:             '🚧 Obras',
  puente_bajo:      '🌉 Puente bajo',
  control_peso:     '⚖️ Control de peso',
  corte:            '🚫 Calle cerrada',
  otro:             '⚠️ Otro',
  trafico:          '🚗 Tráfico',
  objeto_en_via:    '⚠️ Objeto en vía',
}

export const COLORS = {
  primary: '#FF6B35',
  unauthorized: '#FF3B30',
  unknown: '#FF9500',
  ok: '#34C759',
  background: '#1C1C1E',
  card: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  border: '#3A3A3C',
}
