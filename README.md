# SafeTruck 2.0

**SafeTruck** es una plataforma de logística para el AMBA (Área Metropolitana de
Buenos Aires) que ayuda a las empresas de transporte a **planificar rutas seguras
para camiones** y a **seguir a su flota en tiempo real**. El sistema calcula
recorridos teniendo en cuenta las restricciones reales de cada vehículo (peso,
alto, ancho, largo) y las normas de circulación de camiones, evitando calles no
habilitadas, puentes bajos y zonas restringidas.

La plataforma está compuesta por **tres aplicaciones** que comparten un mismo
backend:

| App | Para quién | Stack | Dónde corre |
|-----|------------|-------|-------------|
| **Web (admin)** | Empresas / administradores de flota | React + Vite | [Vercel](https://safetruck20.vercel.app) |
| **Móvil (conductor)** | Conductores de los camiones | React Native + Expo | App Android (EAS) |
| **Backend (API)** | — (lo consumen las otras dos) | Express + TypeScript (ts-node) | Railway |

---

## ✨ Funcionalidades principales

### Para la empresa (web)
- **Live Map**: mapa en tiempo real con la posición de cada camión y el recorrido
  que está haciendo (coloreado por aptitud del tramo: verde apto / rojo no apto /
  naranja sin datos), con puntos de partida y destino.
- **Gestión de flota**: alta/baja/edición de camiones (con sus dimensiones) y de
  conductores, y asignación de conductores a camiones.
- **Asignación de viajes**: crear un viaje (origen → destino) para un conductor,
  que le llega al instante a su app por WebSocket + notificación push.
- **Viajes y Historial**: panel de viajes pendientes/en curso y de viajes
  finalizados, con filtros (conductor, estado, **tipo: empresa / personal**,
  fechas), exportación a CSV y un modal con el detalle completo de cada viaje.
- **Suscripción**: alta de plan y pago vía MercadoPago; el acceso a las funciones
  está protegido por un *gate* de suscripción activa.

### Para el conductor (móvil)
- **Cálculo de ruta para camión**: ingresa un destino y la app le calcula el
  recorrido apto para su vehículo (usando el motor de ruteo del backend).
- **Navegación y simulación**: puede navegar la ruta con GPS real o **simular** el
  recorrido; en ambos casos el empresario lo ve moverse en vivo en la web.
- **Viajes asignados**: ve los viajes que le asignó la empresa, los acepta, los
  inicia y los completa.
- **Viajes personales**: si arma su propia ruta y arranca a navegar/simular, queda
  registrado como un viaje "personal" en curso, que se finaliza al frenar.
- **Reporte de incidentes**: puede reportar multas, controles, accidentes, obras,
  puentes bajos, cortes, etc., que alimentan el motor de ruteo.

---

## 🗺️ Arquitectura en una imagen

```
┌─────────────────┐         ┌──────────────────┐
│   Web (admin)   │         │ Móvil (conductor)│
│  React + Vite   │         │  React Native    │
│  Vercel         │         │  Expo / EAS      │
└───────┬─────────┘         └────────┬─────────┘
        │   HTTPS (REST)             │   HTTPS (REST)
        │   WebSocket (tiempo real)  │   WebSocket
        └────────────┬───────────────┘
                     ▼
          ┌────────────────────────┐
          │   Backend (Express)    │
          │   Railway              │
          │  ┌──────────────────┐  │
          │  │ Motor de ruteo   │  │  A* sobre un grafo de calles
          │  │ (A* / astar.ts)  │  │
          │  └──────────────────┘  │
          └───────┬────────┬───────┘
                  │        │
      ┌───────────▼──┐  ┌──▼───────────────┐
      │ Supabase     │  │ Aiven (2 DBs)    │
      │ (auth +      │  │ - grafo / ruteo  │
      │  flota)      │  │ - datos calles   │
      └──────────────┘  └──────────────────┘
```

Para el detalle completo ver **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## 🚀 Puesta en marcha rápida

> Guía completa (variables de entorno, bases de datos, etc.) en
> **[docs/SETUP.md](docs/SETUP.md)**.

```bash
# 1. Clonar e instalar dependencias (raíz = móvil + backend)
git clone https://github.com/manublacker/SafeTruck2.0.git
cd SafeTruck2.0
npm install

# 2. Backend (Express) — necesita un .env con las URLs de las bases
npm run backend          # levanta la API en localhost:3000

# 3. Web (admin)
cd frontend
npm install
npm run dev              # http://localhost:5173

# 4. Móvil (conductor) — requiere dev build (mapas nativos), no Expo Go
npx expo start --dev-client
```

---

## 📁 Estructura del repo

```
SafeTruck2.0/
├── app/                  # Pantallas de la app móvil (expo-router)
│   └── (tabs)/           # Tabs: Mapa, Viajes, Perfil
├── src/
│   ├── backend/          # API Express + motor de ruteo
│   │   ├── algorithm/    # A* (astar.ts) — cálculo de rutas para camión
│   │   ├── routes/       # Endpoints REST (uno por recurso)
│   │   ├── middleware/   # auth + gate de suscripción
│   │   ├── realtime/     # Hub de WebSockets (tiempo real)
│   │   ├── migrations/   # SQL de las tablas (se corre a mano en Supabase)
│   │   └── server.ts     # Punto de entrada del backend
│   ├── services/         # Clientes de API del móvil
│   └── store/            # Estado global del móvil (Zustand)
├── frontend/             # Web admin (React + Vite)
│   └── src/
│       ├── components/dashboard/  # Live Map, flota, viajes, historial…
│       ├── hooks/        # useRealtime (WebSocket), etc.
│       └── services/     # Cliente de API de la web
├── docs/                 # 📚 Documentación (este directorio)
└── tests/                # 🧪 Tests (ver docs/CONTRIBUTING.md)
```

---

## 📚 Documentación

| Documento | Qué encontrás |
|-----------|---------------|
| **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Cómo se conectan las tres apps, las bases de datos, el tiempo real y el motor de ruteo. |
| **[API.md](docs/API.md)** | Referencia de **todos los endpoints** del backend (método, path, body, respuesta, auth). |
| **[SETUP.md](docs/SETUP.md)** | Cómo levantar todo localmente, variables de entorno y bases de datos. |
| **[CONTRIBUTING.md](docs/CONTRIBUTING.md)** | Convenciones de código, ramas, commits y cómo correr los tests. |

---

## 🛠️ Tecnologías

- **Frontend web**: React 18, Vite, TypeScript, Leaflet (mapas).
- **Móvil**: React Native, Expo SDK 54, `react-native-maps` (mapas nativos de
  Google), Zustand.
- **Backend**: Node.js, Express, TypeScript (ts-node), `pg` (PostgreSQL),
  `ws` (WebSockets).
- **Bases de datos**: Supabase (auth + flota), Aiven PostgreSQL × 2 (grafo de
  calles + datos de ruteo).
- **Infra**: Railway (backend), Vercel (web), EAS / Expo (móvil),
  MercadoPago (pagos).

---

## 📄 Licencia

Proyecto académico — Ingeniería de Software. Uso interno del equipo.
