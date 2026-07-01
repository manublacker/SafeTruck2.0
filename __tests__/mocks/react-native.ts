// Stub mínimo de react-native para poder importar servicios que sólo usan
// `Platform` fuera de la app real.
export const Platform = {
  OS: 'web' as 'web' | 'ios' | 'android',
  select<T>(specifics: { [k: string]: T }): T | undefined {
    return specifics[Platform.OS] ?? specifics.default
  },
}

// Stub de Appearance: por defecto reporta esquema oscuro (null también sirve,
// el store trata "!= 'light'" como oscuro).
export const Appearance = {
  getColorScheme(): 'light' | 'dark' | null {
    return 'dark'
  },
  addChangeListener() {
    return { remove() {} }
  },
}

export default { Platform, Appearance }
