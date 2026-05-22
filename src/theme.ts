// Tokens que espejean exactamente las CSS variables de /src/styles/dashboard.css
export const DARK = {
  bg:           '#1C1C1E',
  card:         '#2C2C2E',
  surface2:     '#3A3A3C',
  border:       '#3A3A3C',
  borderStrong: '#48484A',
  cardBorder:   'transparent',   // flat design — sin borde en dark
  text:         '#FFFFFF',
  textMuted:    '#8E8E93',
  textSoft:     '#636366',
  accent:       '#FF6B35',
  accentSoft:   'rgba(255,107,53,0.15)',
  success:      '#34C759',
  successSoft:  'rgba(52,199,89,0.15)',
  warning:      '#FF9500',
  warningSoft:  'rgba(255,149,0,0.15)',
  danger:       '#FF3B30',
  dangerSoft:   'rgba(255,59,48,0.15)',
}

// Light mode: contrapartida lógica — iOS system light + mismo acento naranja
export const LIGHT = {
  bg:           '#F2F2F7',
  card:         '#FFFFFF',
  surface2:     '#F2F2F7',
  border:       '#E5E5EA',
  borderStrong: '#C7C7CC',
  cardBorder:   '#E5E5EA',       // borde sutil para que la card blanca sea visible
  text:         '#1C1C1E',
  textMuted:    '#8E8E93',
  textSoft:     '#AEAEB2',
  accent:       '#FF6B35',
  accentSoft:   'rgba(255,107,53,0.12)',
  success:      '#34C759',
  successSoft:  'rgba(52,199,89,0.12)',
  warning:      '#FF9500',
  warningSoft:  'rgba(255,149,0,0.12)',
  danger:       '#FF3B30',
  dangerSoft:   'rgba(255,59,48,0.12)',
}

export type Theme = typeof DARK
export const getTheme = (isDark: boolean): Theme => (isDark ? DARK : LIGHT)
