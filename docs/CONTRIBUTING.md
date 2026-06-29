# Guía de contribución — SafeTruck 2.0

Convenciones del equipo para trabajar sobre el repo de forma ordenada.

---

## 1. Flujo de ramas

- `main` es la rama de **producción**: lo que está en `main` se **deploya
  automáticamente** (Railway + Vercel). No se rompe.
- Para cada feature/fix se crea una **rama** a partir de `main`:
  ```bash
  git checkout main
  git pull origin main
  git checkout -b feat/nombre-corto      # o fix/..., refactor/..., docs/...
  ```
- Antes de cualquier tarea no trivial, **`git pull` de `main`** primero.
- No se mergea/pushea a `main` sin que **alguien lo haya probado** (localhost o
  preview). Mejor abrir un PR.

### Prefijos de rama
| Prefijo | Para |
|---------|------|
| `feat/` | Funcionalidad nueva |
| `fix/` | Corrección de bug |
| `refactor/` | Reorganizar código sin cambiar comportamiento |
| `style/` | Cambios visuales / formato |
| `docs/` | Documentación |
| `test/` | Tests |

---

## 2. Mensajes de commit

Usamos **Conventional Commits**: `tipo(scope): descripción en presente`.

```
feat(dashboard): agregar filtro empresa/personal en el historial
fix(backend): redondear distance_m al crear viaje personal
docs(api): documentar el endpoint /route
test(backend): tests del middleware de suscripción
```

- **Tipos**: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `perf`, `chore`.
- **Scope** (opcional): la parte tocada (`dashboard`, `backend`, `movil`, `web`…).
- Descripción **clara y corta**, en minúscula, sin punto final.

---

## 3. Estilo de código

- **TypeScript en todo el proyecto.** Antes de commitear, que **typecheckee**:
  ```bash
  # raíz (móvil)
  npx tsc --noEmit
  # backend
  npx tsc --noEmit -p src/backend/tsconfig.json
  # web
  cd frontend && npx tsc --noEmit
  ```
- Seguir el estilo del código que rodea: misma densidad de comentarios, nombres e
  idioma (los comentarios del proyecto están en **español**).
- Comentar el **por qué**, no el **qué** (el qué ya lo dice el código).
- Nombres descriptivos; evitar abreviaturas crípticas.
- Funciones puras y chicas cuando se pueda (más fáciles de testear).

---

## 4. Tests

Los tests viven en **`tests/`** y corren con **[Vitest](https://vitest.dev)**.

```bash
# Correr toda la suite
npm test

# Modo watch (re-corre al guardar)
npm run test:watch

# Con reporte de cobertura
npm run test:coverage
```

### Qué testeamos
- **Backend** (`tests/backend/`): lógica pura del motor de ruteo y helpers,
  validaciones y reglas de negocio (estados de viaje, frescura de ubicaciones,
  etc.).
- **Web** (`tests/frontend/`): funciones de presentación (formato de fechas,
  duración, distancia, CSV, mapeo de estados) y lógica de filtros.
- **Móvil** (`tests/mobile/`): helpers de los servicios (cálculo de progreso de
  simulación, parsing de rutas, etc.).

### Pautas para escribir tests
- Un archivo de test por módulo: `loQueTesteas.test.ts`.
- Nombres de test que describan el comportamiento esperado:
  `it("redondea la distancia a metros enteros")`.
- Cubrir el **caso feliz**, los **bordes** (vacío, null, 0, negativos) y los
  **errores** esperados.
- Tests **deterministas**: nada de depender de la hora real, red o estado
  externo. Si hace falta una fecha, pasala fija.

---

## 5. Antes de abrir un PR

- [ ] Typecheck OK en la(s) parte(s) tocada(s).
- [ ] `npm test` en verde.
- [ ] Probado a mano (localhost / preview).
- [ ] Mensajes de commit con Conventional Commits.
- [ ] Sin credenciales ni `.env` commiteados.
- [ ] Descripción del PR explicando **qué** y **por qué**.

---

## 6. Estructura de carpetas (recordatorio)

```
app/                  # Móvil (pantallas, expo-router)
src/backend/          # API + motor de ruteo
src/services/         # Clientes de API del móvil
frontend/src/         # Web admin
docs/                 # Documentación
tests/                # Tests (vitest)
```

¡Gracias por mantener el repo prolijo! 🚚
