// Tokens que espejean el diseño system SafeTruck (web + mobile)
// Color primario: rojo SafeTruck #E5342B (no naranja)
// Navy: #0F1B2D (chrome/tabbar)
export const DARK = {
  bg:           '#0F1B2D',
  card:         '#18283D',
  surface2:     '#26374D',
  border:       '#26374D',
  borderStrong: '#3A4D61',
  cardBorder:   'transparent',
  text:         '#FFFFFF',
  textMuted:    '#AEB8C4',
  textSoft:     '#637482',
  accent:       '#E5342B',
  accentSoft:   'rgba(229,52,43,0.18)',
  navy:         '#0F1B2D',
  navyCard:     '#18283D',
  navyLine:     'rgba(255,255,255,0.08)',
  navyText:     '#AEB8C4',
  success:      '#1F9D57',
  successSoft:  'rgba(31,157,87,0.18)',
  warning:      '#D9881A',
  warningSoft:  'rgba(217,136,26,0.18)',
  danger:       '#E5342B',
  dangerSoft:   'rgba(229,52,43,0.18)',
}

export const LIGHT = {
  bg:           '#F7F8FA',
  card:         '#FFFFFF',
  surface2:     '#F2F4F7',
  border:       '#E6E8EC',
  borderStrong: '#D6DAE0',
  cardBorder:   '#E6E8EC',
  text:         '#16202C',
  textMuted:    '#69727E',
  textSoft:     '#9AA3AD',
  accent:       '#E5342B',
  accentSoft:   '#FDECEA',
  navy:         '#0F1B2D',
  navyCard:     '#18283D',
  navyLine:     '#26374D',
  navyText:     '#AEB8C4',
  success:      '#1F9D57',
  successSoft:  '#E7F6EE',
  warning:      '#D9881A',
  warningSoft:  '#FBF1E0',
  danger:       '#E5342B',
  dangerSoft:   '#FDECEA',
}

export type Theme = typeof LIGHT
export const getTheme = (isDark: boolean): Theme => (isDark ? DARK : LIGHT)
