/**
 * Tests de los tokens de diseño (`src/theme.ts`): selección de tema, detección
 * de tema oscuro y elevaciones parametrizadas.
 */
import { DARK, LIGHT, getTheme, isDarkTheme, elevation } from '../src/theme'

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/
const RGBA = /^rgba\(/

describe('theme — paletas DARK y LIGHT', () => {
  it('DARK y LIGHT exponen exactamente las mismas claves', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort())
  })

  it('el color de acento es el rojo SafeTruck en ambos temas', () => {
    expect(DARK.accent).toBe('#E5342B')
    expect(LIGHT.accent).toBe('#E5342B')
  })

  it('el fondo oscuro es navy y el claro es gris muy claro', () => {
    expect(DARK.bg).toBe('#0F1B2D')
    expect(LIGHT.bg).toBe('#F7F8FA')
  })

  it('los backgrounds de DARK y LIGHT son distintos', () => {
    expect(DARK.bg).not.toBe(LIGHT.bg)
  })

  it('todos los tokens de color son hex, rgba o "transparent"', () => {
    for (const palette of [DARK, LIGHT]) {
      for (const [, value] of Object.entries(palette)) {
        const ok = HEX.test(value) || RGBA.test(value) || value === 'transparent'
        expect(ok).toBe(true)
      }
    }
  })

  it('el texto principal contrasta con el fondo en cada tema', () => {
    expect(DARK.text).toBe('#FFFFFF')
    expect(LIGHT.text).not.toBe('#FFFFFF')
  })

  it('danger coincide con accent (rojo) en ambos temas', () => {
    expect(DARK.danger).toBe(DARK.accent)
    expect(LIGHT.danger).toBe(LIGHT.accent)
  })

  it('define tokens semánticos de estado (success, warning, danger, info)', () => {
    for (const palette of [DARK, LIGHT]) {
      expect(palette.success).toBeDefined()
      expect(palette.warning).toBeDefined()
      expect(palette.danger).toBeDefined()
      expect(palette.info).toBeDefined()
    }
  })
})

describe('theme — getTheme', () => {
  it('devuelve DARK cuando isDark es true', () => {
    expect(getTheme(true)).toBe(DARK)
  })

  it('devuelve LIGHT cuando isDark es false', () => {
    expect(getTheme(false)).toBe(LIGHT)
  })

  it('devuelve el mismo objeto referencia (no copia) para el mismo input', () => {
    expect(getTheme(true)).toBe(getTheme(true))
    expect(getTheme(false)).toBe(getTheme(false))
  })
})

describe('theme — isDarkTheme', () => {
  it('reconoce el tema DARK', () => {
    expect(isDarkTheme(DARK)).toBe(true)
  })

  it('reconoce el tema LIGHT como no oscuro', () => {
    expect(isDarkTheme(LIGHT)).toBe(false)
  })

  it('es la inversa de la relación con LIGHT via getTheme', () => {
    expect(isDarkTheme(getTheme(true))).toBe(true)
    expect(isDarkTheme(getTheme(false))).toBe(false)
  })

  it('detecta por el bg real, no por identidad de objeto', () => {
    const clon = { ...DARK }
    expect(isDarkTheme(clon)).toBe(true)
  })
})

describe('theme — elevation', () => {
  it('expone tres niveles sm, md, lg', () => {
    const e = elevation(false)
    expect(e).toHaveProperty('sm')
    expect(e).toHaveProperty('md')
    expect(e).toHaveProperty('lg')
  })

  it('la opacidad crece de sm a md a lg', () => {
    const e = elevation(false)
    expect(e.sm.shadowOpacity).toBeLessThan(e.md.shadowOpacity)
    expect(e.md.shadowOpacity).toBeLessThan(e.lg.shadowOpacity)
  })

  it('el modo oscuro usa más opacidad que el claro en cada nivel', () => {
    const dark = elevation(true)
    const light = elevation(false)
    expect(dark.sm.shadowOpacity).toBeGreaterThan(light.sm.shadowOpacity)
    expect(dark.md.shadowOpacity).toBeGreaterThan(light.md.shadowOpacity)
    expect(dark.lg.shadowOpacity).toBeGreaterThan(light.lg.shadowOpacity)
  })

  it('el radio de sombra crece con el nivel', () => {
    const e = elevation(true)
    expect(e.sm.shadowRadius).toBeLessThan(e.md.shadowRadius)
    expect(e.md.shadowRadius).toBeLessThan(e.lg.shadowRadius)
  })

  it('la elevación Android crece con el nivel', () => {
    const e = elevation(false)
    expect(e.sm.elevation).toBeLessThan(e.md.elevation)
    expect(e.md.elevation).toBeLessThan(e.lg.elevation)
  })

  it('el color de sombra es negro en todos los niveles', () => {
    const e = elevation(true)
    expect(e.sm.shadowColor).toBe('#000')
    expect(e.md.shadowColor).toBe('#000')
    expect(e.lg.shadowColor).toBe('#000')
  })

  it('el offset vertical crece con el nivel y no hay offset horizontal', () => {
    const e = elevation(false)
    expect(e.sm.shadowOffset.width).toBe(0)
    expect(e.sm.shadowOffset.height).toBeLessThan(e.md.shadowOffset.height)
    expect(e.md.shadowOffset.height).toBeLessThan(e.lg.shadowOffset.height)
  })

  it('las opacidades están en el rango [0, 1]', () => {
    for (const isDark of [true, false]) {
      const e = elevation(isDark)
      for (const level of [e.sm, e.md, e.lg]) {
        expect(level.shadowOpacity).toBeGreaterThanOrEqual(0)
        expect(level.shadowOpacity).toBeLessThanOrEqual(1)
      }
    }
  })
})
