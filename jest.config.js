/**
 * Configuración de Jest para SafeTruck.
 *
 * Los tests corren en Node (lógica pura de backend + helpers de la app),
 * usando ts-jest para compilar TypeScript al vuelo. Los módulos nativos de
 * Expo / React Native / Supabase / pg se reemplazan por stubs livianos
 * (ver __tests__/mocks) para poder importar los servicios sin arrancar la app
 * ni abrir conexiones reales.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  moduleNameMapper: {
    '^expo-linking$': '<rootDir>/__tests__/mocks/expo-linking.ts',
    '^expo-web-browser$': '<rootDir>/__tests__/mocks/expo-web-browser.ts',
    '^expo-secure-store$': '<rootDir>/__tests__/mocks/expo-secure-store.ts',
    '^expo-location$': '<rootDir>/__tests__/mocks/empty.ts',
    '^expo-notifications$': '<rootDir>/__tests__/mocks/empty.ts',
    '^expo-constants$': '<rootDir>/__tests__/mocks/empty.ts',
    '^@supabase/supabase-js$': '<rootDir>/__tests__/mocks/supabase-js.ts',
    '^react-native$': '<rootDir>/__tests__/mocks/react-native.ts',
    '^pg$': '<rootDir>/__tests__/mocks/pg.ts',
  },
  clearMocks: true,
  testPathIgnorePatterns: ['/node_modules/', '/SafeTruck3/'],
};
