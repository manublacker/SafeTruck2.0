# Arquitectura — SafeTruck 2.0

Este documento explica **cómo está armado el sistema por dentro**: las tres
aplicaciones, las bases de datos, el motor de ruteo y el tiempo real.

---

## 1. Visión general

SafeTruck son **tres clientes** (web admin, móvil del conductor y el propio
backend) que conversan a través de una **API REST** y de un canal de **WebSockets**
para el tiempo real. El backend, además de exponer la API, contiene el **motor de
ruteo** (A\*) que calcula los recorridos aptos para cada camión.

```
   Empresa (web)                         Conductor (móvil)
        │                                       │
        │  REST  ───────────────────────────►   │  REST
        │  WS    ◄───── tiempo real ─────────►   │  WS
        │                                       │
        └──────────────────┬────────────────────┘
                           ▼
                  Backend (Express, Railway)
                  ├── REST API (/api/*, /route, /reports)
                  ├── WebSocket hub (rooms por empresa)
                  └── Motor de ruteo A* (algorithm/astar.ts)
                           │
            ┌──────────────┼───────────────────┐
            ▼              ▼                   ▼
       Supabase        Aiven DB #1         Aiven DB #2
    (auth + flota)   (grafo de calles)   (datos de ruteo)
```

---

## 2. Las tres aplicaciones

### 2.1. Web admin (`frontend/`)

- **Stack**: React 18 + Vite + TypeScript. Mapas con **Leaflet** (tiles de
  CartoDB Voyager, ver `frontend/src/lib/mapTiles.ts`).
- **Para quién**: el administrador/empresa que gestiona la flota.
- **Pantallas** (`frontend/src/components/dashboard/`):
  - **Live Map** (`LiveMapContainer` + `MapDisplay`): posiciones GPS en vivo,
    recorridos coloreados, panel de "Viajes activos".
  - **Flota** (`FleetView`): camiones y conductores.
  - **Viajes / Historial** (`TripHistoryView`): tabla con filtros, export CSV y
    modal de detalle (`TripDetailModal`).
  - **Mi cuenta / Planes** (`AccountView`, `PlansView`): suscripción y pagos.
- **Tiempo real**: el hook `useRealtime` (`frontend/src/hooks/useRealtime.ts`)
  abre el WebSocket y entrega eventos (`driver_location`, `trip_update`, …).
- **Autenticación**: sesión de Supabase; el token va en el header `Authorization`
  de cada request.

### 2.2. Móvil del conductor (`app/`)

- **Stack**: React Native + Expo SDK 54, `react-native-maps` (proveedor Google en
  Android). Estado global con **Zustand** (`src/store/useStore.ts`).
- ⚠️ Requiere **dev build** (no Expo Go) porque usa mapas nativos.
- **Pantallas** (`app/(tabs)/`):
  - **Mapa** (`index.tsx`): búsqueda de destino, cálculo de ruta, navegación,
    simulación, reporte de incidentes, viajes asignados.
  - **Viajes** (`trips.tsx`): viajes asignados por la empresa (tiempo real).
  - **Perfil** (`profile.tsx`): datos del conductor.
- **Servicios** (`src/services/`): clientes de la API (`assignedTrips.ts`,
  `recentDestinations.ts`, `realtime.ts`, `supabase.ts`).

### 2.3. Backend (`src/backend/`)

- **Stack**: Express + TypeScript corriendo con **ts-node** (sin paso de build).
- **Entrada**: `server.ts` levanta el HTTP server + el WebSocket hub.
- **Ruteo de endpoints**: `router.ts` monta cada recurso bajo su prefijo
  (`/api/assigned-trips`, `/api/locations`, `/route`, etc.). Ver
  **[API.md](API.md)**.
- **Middleware** (`middleware/`):
  - `authMiddleware`: valida el JWT de Supabase y carga `req.user`.
  - `requireActiveSubscription`: bloquea (402) si la empresa no tiene un plan
    activo. Para conductores resuelve la empresa dueña (`adminOf`).
- **Tiempo real** (`realtime/hub.ts`): ver sección 5.
- **Motor de ruteo** (`algorithm/astar.ts`): ver sección 4.

---

## 3. Bases de datos

El sistema usa **tres bases**, cada una con un propósito distinto:

| Base | Tecnología | Qué guarda |
|------|------------|------------|
| **Supabase** | PostgreSQL gestionado | Auth (usuarios), flota (`drivers`, `trucks`, `truck_drivers`), viajes (`assigned_trips`), ubicaciones en vivo (`driver_locations`), suscripciones, push tokens. |
| **Aiven #1** | PostgreSQL | El **grafo de calles** (nodos y aristas) que usa el motor de ruteo. |
| **Aiven #2** | PostgreSQL | Datos de ruteo / restricciones de calles (aptitud por tramo, etc.). |

El backend se conecta a Supabase a través del pool de `db.ts`
(`DATABASE_URL`). El SSL va con `rejectUnauthorized: false` (certificados
gestionados).

### Tablas principales (Supabase)

- **`users`**: cuentas (empresas y conductores), vinculadas a `auth.users`.
- **`drivers`**: conductores de una empresa (`user_id` = empresa dueña;
  `app_user_id` = cuenta del conductor en la app).
- **`trucks`**: camiones con sus dimensiones (`max_weight_kg`, `max_height_m`,
  `max_width_m`, `max_length_m`).
- **`truck_drivers`**: tabla de unión camión ↔ conductor (PK compuesta,
  `is_primary`).
- **`assigned_trips`**: viajes. Campos clave: `empresa_user_id`, `driver_id`,
  `driver_app_user_id`, `truck_id`, `origin_label`/`destination_label`,
  coordenadas, `path` (JSONB), `distance_m`, `duration_min`, `status`
  (`pending`/`accepted`/`in_progress`/`completed`/`cancelled`), timestamps y
  **`trip_source`** (`company` = asignado por la empresa, `personal` = lo armó el
  conductor).
- **`driver_locations`**: última posición de cada conductor en vivo
  (`driver_app_user_id` único, `lat`, `lng`, `updated_at`). El Live Map filtra por
  frescura (< 5 min).

> Las migraciones viven en `src/backend/migrations/` y **se corren a mano** en el
> editor SQL de Supabase (no hay runner automático).

---

## 4. Motor de ruteo (A\*)

El corazón del sistema es `src/backend/algorithm/astar.ts`. Calcula el **camino
más apto** para un camión entre dos puntos.

- **Entrada**: un grafo (`nodes` + `edges`), nodo de origen, nodo de destino y el
  **perfil del vehículo** (peso/alto/ancho/largo).
- **Algoritmo**: A\* con una heurística de distancia. El **costo de cada arista**
  penaliza (o prohíbe) los tramos donde el camión no entra por sus dimensiones, y
  los marcados como no habilitados o con incidentes activos (overlays).
- **Salida** (`AStarResult`): el recorrido como lista de tramos (`segments`), cada
  uno con su **aptitud** (`ok` / `unauthorized` / `unknown`), más distancia y
  duración estimadas.

El endpoint `POST /route` recibe `{ origin, destination, vehicle }`, arma/usa el
grafo (cacheado en `graphCache.ts`) y devuelve la ruta. La web y el móvil dibujan
los `segments` con su color según la aptitud.

> El grafo se cachea en memoria al arrancar (ver `graphCache.ts`) para no
> reconstruirlo en cada request.

---

## 5. Tiempo real (WebSockets)

Implementado en `src/backend/realtime/hub.ts`. Permite que el mapa de la web y los
viajes se actualicen **al instante**, sin esperar al polling.

- **Conexión**: el cliente abre el WS con su JWT de Supabase. El hub lo autentica
  y lo une a una **room por empresa** (`companyId` = `user_id` del admin).
- **Rooms**: cada empresa tiene su room; los eventos se emiten **aislados por
  empresa** (un admin nunca ve camiones de otra).
- **Eventos** (servidor → cliente):
  | Evento | Cuándo | Para quién |
  |--------|--------|------------|
  | `driver_location` | El conductor manda su posición (`POST /api/locations`) | Admins de la empresa |
  | `driver_location_removed` | El conductor se desconecta (`DELETE /api/locations`) | Admins |
  | `trip_assigned` | El admin crea un viaje | Solo el conductor asignado |
  | `trip_update` | Un viaje cambió de estado | Empresa (excluyendo al que originó) |
  | `presence` | Cambios de conexión | Empresa |

- **Respaldo (polling)**: si el socket se cae, la web igual reconcilia con un
  *polling* cada 30 s (`GET /api/locations` y `GET /api/assigned-trips`). El
  WebSocket es la vía rápida; el polling es la red de seguridad.

---

## 6. Flujo de un viaje (de punta a punta)

### Viaje asignado por la empresa
1. El admin crea el viaje en la web → `POST /api/assigned-trips` (status `pending`).
2. El backend vincula al conductor y le emite `trip_assigned` por WS + push.
3. El conductor lo ve en su app, lo **acepta** e **inicia**
   (`PATCH /:id/status`).
4. Mientras está `in_progress`, el móvil manda GPS (`POST /api/locations`) y el
   admin lo ve moverse en el Live Map.
5. Al **completar**, el backend marca `completed`, borra la ubicación viva y emite
   `trip_update`.

### Viaje personal (lo arma el conductor)
1. El conductor busca un destino y arranca a **navegar o simular**.
2. El móvil crea el viaje → `POST /api/assigned-trips/personal`
   (`trip_source = 'personal'`, status `in_progress`).
3. Manda la posición seguido; el admin lo ve en vivo (camión + recorrido).
4. Al **frenar**, el móvil lo completa. Si el conductor manda la app a segundo
   plano, se cierra solo; y como respaldo, el backend auto-completa los personales
   abandonados (sin ubicación fresca > 2 min) al listar.

---

## 7. Despliegue

| Componente | Plataforma | Cómo se despliega |
|------------|------------|-------------------|
| Backend | **Railway** | Auto-deploy al pushear a `main`. |
| Web | **Vercel** | Auto-deploy al pushear a `main`. |
| Móvil | **EAS / Expo** | OTA (`eas update --branch preview`) para cambios de JS; build de APK para cambios nativos. |

Las variables de entorno de cada plataforma están documentadas en
**[SETUP.md](SETUP.md)**.
