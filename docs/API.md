# API REST — SafeTruck 2.0

Referencia de los endpoints del backend (Express). La base en producción es:

```
https://safetruck20-production.up.railway.app
```

## Convenciones

- **Auth**: salvo que se indique lo contrario, los endpoints requieren el header
  `Authorization: Bearer <jwt>` (token de sesión de Supabase). El middleware
  `authMiddleware` valida el token y carga `req.user`.
- **Suscripción**: muchos recursos pasan además por `requireActiveSubscription`,
  que responde **402** si la empresa no tiene un plan activo.
- **Formato**: request y response en JSON. Los errores tienen la forma
  `{ "error": "mensaje" }`.
- **Códigos**: `200/201` OK · `400` body inválido · `401` sin token / token
  inválido · `402` suscripción inactiva · `403` sin permiso · `404` no
  encontrado · `409` conflicto · `500` error interno.

---

## Índice

| Recurso | Prefijo |
|---------|---------|
| [Auth](#auth) | `/api/auth` |
| [Usuarios](#usuarios) | `/api/users` |
| [Camiones](#camiones) | `/api/trucks` |
| [Conductores](#conductores) | `/api/drivers` |
| [Camión ↔ conductor](#camión--conductor) | `/api/truck-drivers` |
| [Invitaciones](#invitaciones) | `/api/invitations` |
| [Viajes asignados](#viajes-asignados) | `/api/assigned-trips` |
| [Ubicaciones (tiempo real)](#ubicaciones) | `/api/locations` |
| [Push tokens](#push-tokens) | `/api/push-tokens` |
| [Incidentes](#incidentes) | `/api/incidents` |
| [Facturación](#facturación) | `/api/billing` |
| [Ruteo](#ruteo) | `/route` |
| [Búsqueda](#búsqueda) | `/search` |
| [Reportes](#reportes) | `/reports` |

---

## Auth

### `GET /api/auth/me`
Devuelve el perfil del usuario autenticado. **Auth.**

### `POST /api/auth/profile`
Crea/actualiza el perfil del usuario. **Auth.**
Body: `{ full_name, ...campos de perfil }`.

---

## Usuarios

### `POST /api/users/push-token`
Registra el token de notificaciones push del dispositivo. **Auth.**
Body: `{ token }`.

---

## Camiones

### `GET /api/trucks`
Lista los camiones de la empresa. **Auth + suscripción.**

### `POST /api/trucks`
Crea un camión. **Auth + suscripción.**
Body: `{ name, patente, modelo?, anio?, max_weight_kg, max_height_m, max_width_m, max_length_m, estado? }`.

### `POST /api/trucks/bulk`
Crea varios camiones de una (desde plantilla). **Auth + suscripción.**
Body: `{ trucks: Truck[] }`.

### `PATCH /api/trucks/:id`
Edita un camión. **Auth + suscripción.**

### `DELETE /api/trucks/:id`
Baja (soft-delete) de un camión. **Auth + suscripción.**

---

## Conductores

### `GET /api/drivers`
Lista los conductores de la empresa. **Auth + suscripción.**

### `POST /api/drivers`
Crea un conductor. **Auth + suscripción.**
Body: `{ nombre, telefono?, licencia?, categoria_licencia?, vencimiento_licencia?, estado? }`.

### `PATCH /api/drivers/:id`
Edita un conductor. **Auth + suscripción.**

### `DELETE /api/drivers/:id`
Baja (soft-delete) de un conductor. **Auth + suscripción.**

### `GET /api/drivers/me`
Perfil del conductor logueado (datos de su ficha en la empresa). **Auth.**

### `GET /api/drivers/me/truck`
Camión asignado al conductor logueado (vía `truck_drivers`). **Auth.**
Respuesta: `AssignedTruck | null`.

### `PATCH /api/drivers/me`
Actualiza datos propios del conductor (ej. teléfono). **Auth.**

---

## Camión ↔ conductor

### `POST /api/truck-drivers`
Asigna un conductor a un camión (transacción: borra la asignación previa e
inserta la nueva). **Auth + suscripción.**
Body: `{ truck_id, driver_id, is_primary? }`.

### `DELETE /api/truck-drivers/:truck_id`
Quita la asignación de un camión. **Auth + suscripción.**

---

## Invitaciones

Flujo para que un conductor vincule su cuenta de la app a una empresa.

### `POST /api/invitations`
Genera una invitación (código) para un conductor. **Auth.**

### `GET /api/invitations`
Lista las invitaciones de la empresa. **Auth.**

### `POST /api/invitations/redeem`
El conductor canjea un código y queda vinculado a la empresa. **Auth.**
Body: `{ code }`. Respuesta: `{ driver_name }`.

### `POST /api/invitations/register`
Registra una cuenta nueva de conductor a partir de una invitación.

### `POST /api/invitations/bulk`
Genera varias invitaciones de una. **Auth.**

### `DELETE /api/invitations/:id`
Elimina una invitación. **Auth.**

---

## Viajes asignados

### `POST /api/assigned-trips`
La empresa crea un viaje para un conductor. **Auth + suscripción.**
Body:
```json
{
  "driver_id": 21,
  "truck_id": 5,
  "origin_address": "Av. 9 de Julio 1000",
  "destination_address": "Av. de los Incas 4000",
  "origin_lat": -34.60, "origin_lng": -58.38,
  "destination_lat": -34.57, "destination_lng": -58.46,
  "route": { /* objeto de ruta del motor */ },
  "scheduled_at": "2026-06-30T09:00:00Z"
}
```
Respuesta: `201 { success: true, trip }`. Emite `trip_assigned` por WS al conductor.

### `POST /api/assigned-trips/personal`
El **conductor** crea su propio viaje (no asignado por la empresa) al
navegar/simular una ruta. **Auth + suscripción.** Nace `in_progress` con
`trip_source = 'personal'`. El backend resuelve empresa, conductor y camión a
partir de la sesión.
Body: `{ origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng, route }`.

### `GET /api/assigned-trips`
La empresa lista sus viajes. **Auth + suscripción.** Antes de listar,
auto-completa los viajes **personales abandonados** (in_progress sin ubicación
fresca > 2 min).

### `GET /api/assigned-trips/mine`
El conductor lista sus propios viajes (últimos 50). **Auth + suscripción.**

### `PATCH /api/assigned-trips/:id/status`
La empresa o el conductor cambian el estado. **Auth + suscripción.**
Body: `{ status: 'accepted' | 'in_progress' | 'completed' | 'cancelled' }`.
- Setea el timestamp correspondiente (`accepted_at` / `started_at` / `completed_at`).
- Regla: un conductor sólo puede tener **un** viaje `in_progress` a la vez (409 si
  ya tiene otro).
- Al `completed`, borra la ubicación viva del conductor.
- Emite `trip_update` por WS a la empresa.

---

## Ubicaciones

Tiempo real de la posición de los camiones.

### `GET /api/locations`
La empresa obtiene las ubicaciones vivas de su flota (frescas < 5 min). **Auth +
suscripción.** Aisladas por empresa.

### `POST /api/locations`
El conductor actualiza su posición GPS. **Auth + suscripción.**
Body: `{ lat, lng, trip_id?, driver_name?, truck_plate?, route? }`.
Hace *upsert* en `driver_locations` y emite `driver_location` por WS a los admins
de la empresa (con el `route` para dibujar el recorrido, que **no** se persiste).

### `DELETE /api/locations`
El conductor se desconecta. **Auth + suscripción.** Borra su ubicación viva y
emite `driver_location_removed`.

---

## Push tokens

### `POST /api/push-tokens`
Registra el token de Expo Push del dispositivo del conductor. **Auth.**
Body: `{ token }`.

---

## Incidentes

Reportes que alimentan el motor de ruteo (multas, controles, obras, etc.).

### `POST /api/incidents`
Crea un incidente. **Auth.**
Body: `{ incident_type, lat, lon }`.

### `GET /api/incidents`
Lista los incidentes activos.

### `PATCH /api/incidents/:id/confirm`
Confirma un incidente reportado. **Auth.**

### `PATCH /api/incidents/:id/deactivate`
Desactiva un incidente. **Auth.**

---

## Facturación

Suscripciones y pagos (MercadoPago).

### `POST /api/billing/checkout`
Inicia el checkout de un plan. **Auth.** Respuesta: URL/preferencia de pago.

### `GET /api/billing/subscription`
Estado de la suscripción de la empresa. **Auth.**

### `POST /api/billing/confirm`
Confirma el pago de forma síncrona (sin depender del webhook). **Auth.**
Body: `{ plan }`.

### `POST /api/billing/webhook`
Webhook de MercadoPago (notificaciones de pago). **Público** (lo llama MP).

---

## Ruteo

### `POST /route`
Calcula la ruta apta para un camión entre dos puntos (motor A\*).
Body:
```json
{
  "origin": { "lat": -34.60, "lng": -58.38 },
  "destination": { "lat": -34.57, "lng": -58.46 },
  "vehicle": { "weight_kg": 12000, "height_m": 4.1, "width_m": 2.6 }
}
```
Respuesta: `{ route: { segments, total_distance_km, total_duration_min, has_unauthorized, ... } }`.
Cada `segment` trae `coordinates` y `status` (`ok` / `unauthorized` / `unknown`).

---

## Búsqueda

### `GET /search`
Geocoding de direcciones (autocompletado de destino).
Query: `?q=<texto>`. Respuesta: lista de lugares con `display_name`, `lat`, `lon`.

---

## Reportes

### `POST /reports`
Registra un reporte (usado junto con los incidentes para el motor de ruteo).
Body: depende del tipo de reporte.
