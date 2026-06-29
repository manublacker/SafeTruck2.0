# Puesta en marcha — SafeTruck 2.0

Guía para levantar el proyecto completo en tu máquina: backend, web y móvil.

---

## 1. Requisitos previos

| Herramienta | Versión recomendada | Para qué |
|-------------|---------------------|----------|
| **Node.js** | 20.x LTS | Backend, web y móvil |
| **npm** | 10.x | Gestor de paquetes |
| **Git** | reciente | Control de versiones |
| **Cuenta Expo / EAS** | — | Builds y OTA del móvil |
| **Android Studio + emulador o celu** | — | Correr la app móvil (dev build) |

> El móvil usa **mapas nativos** (`react-native-maps` con Google Maps), así que
> **no funciona en Expo Go**: hace falta un **dev build**.

---

## 2. Clonar e instalar

```bash
git clone https://github.com/manublacker/SafeTruck2.0.git
cd SafeTruck2.0

# Dependencias de la RAÍZ (móvil + backend)
npm install

# Dependencias de la WEB
cd frontend && npm install && cd ..
```

> En el móvil, para agregar paquetes usá **`npx expo install <paquete>`** (no
> `npm install`), así Expo elige la versión compatible con el SDK.

---

## 3. Variables de entorno

### 3.1. Backend (`.env` en la raíz)

```bash
# Base principal (Supabase) — auth + flota + viajes
DATABASE_URL=postgres://USER:PASS@HOST:PORT/DB

# Supabase (validación de JWT y service role)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Bases de ruteo (Aiven)
AIVEN_GRAPH_URL=postgres://...     # grafo de calles
AIVEN_ROUTING_URL=postgres://...   # datos de ruteo

# MercadoPago (pagos)
MP_ACCESS_TOKEN=...

# Puerto (opcional, default 3000)
PORT=3000
```

> ⚠️ El `.env` **no se commitea** (está en `.gitignore`). Pedile las credenciales
> a alguien del equipo.

### 3.2. Web (`frontend/.env`)

```bash
VITE_API_URL=http://localhost:3000      # backend local
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

### 3.3. Móvil

La URL del backend se resuelve con `EXPO_PUBLIC_API_URL` (si no, usa la de
producción de Railway por defecto). Las claves de Supabase y la API key de Google
Maps viven en `app.json` / la config de Expo.

```bash
EXPO_PUBLIC_API_URL=http://<IP-de-tu-PC>:3000   # para pegarle a tu backend local
```

> Para que el celu le pegue a tu backend local, usá la **IP de red** de tu PC
> (no `localhost`), y asegurate de estar en la misma red.

---

## 4. Bases de datos

- **Supabase**: ya está creada (la comparte el equipo). Las migraciones de
  `src/backend/migrations/*.sql` se corren **a mano** en el editor SQL de Supabase
  cuando hay cambios de esquema. No hay runner automático.
- **Aiven (×2)**: el grafo de calles y los datos de ruteo. También compartidas.

Si agregás una migración nueva, numerala (`002_...sql`, `003_...sql`, …) y dejá el
SQL **idempotente** (`IF NOT EXISTS`, etc.) para que sea seguro re-correrlo.

---

## 5. Correr cada parte

### Backend
```bash
npm run backend
# Levanta la API en http://localhost:3000 (HTTP + WebSocket)
```

### Web (admin)
```bash
cd frontend
npm run dev
# http://localhost:5173
```

### Móvil (conductor)
```bash
# Con un dev build ya instalado en el celu/emulador:
npx expo start --dev-client
# Escaneá el QR o abrí el dev build
```

Para crear el dev build / APK:
```bash
npx eas-cli build --platform android --profile preview
```

---

## 6. Despliegue

| Componente | Plataforma | Disparador |
|------------|------------|------------|
| Backend | Railway | `git push` a `main` |
| Web | Vercel | `git push` a `main` |
| Móvil (JS) | EAS OTA | `npx eas-cli update --branch preview --platform android` |
| Móvil (nativo) | EAS Build | `npx eas-cli build --platform android --profile preview` |

> Cambios **solo de JS** (lógica, UI) van por **OTA** y los baja la app al
> reabrir. Cambios **nativos** (dependencias, permisos, config) necesitan un
> **build** nuevo.

---

## 7. Problemas comunes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| La app se cierra al abrir el mapa | Falta la API key de Google Maps en el manifiesto | Configurar `android.config.googleMaps.apiKey` en `app.json` y rebuild |
| El backend no conecta a la base | `DATABASE_URL` mal o SSL | Revisar el `.env` y que `ssl.rejectUnauthorized` esté en `false` |
| El celu no ve el backend local | Usaste `localhost` | Usar la IP de red de la PC en `EXPO_PUBLIC_API_URL` |
| HTTP 402 en la web | Suscripción inactiva | Activar/regularizar el plan de la empresa |
| El OTA no se aplica | Falta reabrir | Cerrar la app del todo y reabrir 2 veces |
