import { defineConfig } from 'vitest/config'

// Configuración de Vitest para SafeTruck. Los tests viven en `tests/` (fuera de
// los builds de las apps) y prueban lógica PURA: helpers de formato, validaciones
// de negocio y geometría de la simulación. No dependen de DOM, red ni base de
// datos, así que corren en el entorno `node` y son 100% deterministas.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: [
        'src/backend/lib/**/*.ts',
        'src/lib/**/*.ts',
        'frontend/src/lib/**/*.ts',
      ],
    },
  },
})
