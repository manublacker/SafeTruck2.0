/*******************************************************
 * realtime/hub.ts
 *
 * Servidor WebSocket de SafeTruck. Vive en el mismo proceso/puerto que
 * Express (se engancha al HTTP server en server.ts) y empuja eventos en
 * tiempo real a la web (y más adelante a la app móvil).
 *
 * Conceptos:
 *   - "Sala" (room): agrupa las conexiones de UNA empresa. El admin y todos
 *     sus choferes comparten sala. Así un broadcast nunca cruza datos entre
 *     empresas distintas.
 *   - companyId: el user_id del admin. Un chofer pertenece a la sala de su
 *     admin (drivers.user_id); un admin pertenece a su propia sala (su id).
 *
 * Este archivo SOLO provee la infraestructura. Quién dispara los eventos
 * (ubicación, viajes, etc.) son las rutas, que llamarán a broadcastToCompany.
 *******************************************************/

import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import { supabase } from '../supabaseClient'
import pool from '../db'

export type Role = 'admin' | 'driver'

interface Client {
  ws: WebSocket
  userId: string
  companyId: string
  role: Role
  isAlive: boolean
}

// Salas por empresa: companyId -> conjunto de conexiones (admin + sus choferes).
const rooms = new Map<string, Set<Client>>()

function joinRoom(client: Client): void {
  let set = rooms.get(client.companyId)
  if (!set) { set = new Set(); rooms.set(client.companyId, set) }
  set.add(client)
}

function leaveRoom(client: Client): void {
  const set = rooms.get(client.companyId)
  if (!set) return
  set.delete(client)
  if (set.size === 0) rooms.delete(client.companyId)
}

export interface BroadcastOptions {
  role?: Role       // enviar solo a las conexiones de este rol dentro de la empresa
  exclude?: string  // excluir a este userId (ej: el que originó el evento)
  only?: string     // enviar SOLO a las conexiones de este userId (ej: el chofer asignado)
}

/**
 * Empuja un evento (objeto JSON) a todas las conexiones de una empresa.
 * Con filtros opcionales por rol o excluyendo a un usuario.
 * Si la empresa no tiene a nadie conectado, no hace nada.
 */
export function broadcastToCompany(
  companyId: string,
  event: object,
  opts: BroadcastOptions = {},
): void {
  const set = rooms.get(companyId)
  if (!set) return
  const payload = JSON.stringify(event)
  for (const client of set) {
    if (opts.role && client.role !== opts.role) continue
    if (opts.exclude && client.userId === opts.exclude) continue
    if (opts.only && client.userId !== opts.only) continue
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(payload)
  }
}

/**
 * Determina a qué empresa pertenece el usuario y con qué rol, mirando la
 * tabla drivers: un chofer está vinculado a un admin (drivers.user_id); si
 * el usuario no aparece como chofer activo, asumimos que ES el admin.
 */
export async function resolveCompany(userId: string): Promise<{ companyId: string; role: Role }> {
  const r = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM drivers WHERE app_user_id = $1 AND is_active = true LIMIT 1',
    [userId],
  )
  if (r.rows[0]?.user_id) return { companyId: r.rows[0].user_id, role: 'driver' }
  return { companyId: userId, role: 'admin' }
}

/** Valida el JWT de Supabase del handshake. Devuelve el userId o null. */
async function authenticate(token: string | null): Promise<string | null> {
  if (!token) return null
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user.id
}

/**
 * Engancha el servidor WebSocket al HTTP server de Express.
 * Endpoint: wss://<host>/ws?token=<jwt-de-supabase>
 * (el token va en la query porque el navegador no permite headers custom al
 *  abrir un WebSocket).
 */
export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', async (ws, req) => {
    // Todo el setup va en try/catch: es un handler async, así que una excepción
    // (token inválido, DB caída en resolveCompany, etc.) quedaría como promesa
    // rechazada sin atrapar y tiraría la conexión sin explicación (cierre 1006).
    try {
      const url = new URL(req.url ?? '', 'http://localhost')
      const token = url.searchParams.get('token')

      const userId = await authenticate(token)
      if (!userId) {
        ws.close(4001, 'unauthorized')
        return
      }

      const { companyId, role } = await resolveCompany(userId)
      const client: Client = { ws, userId, companyId, role, isAlive: true }
      joinRoom(client)
      console.log(`[realtime] conectado role=${role} empresa=${companyId} (conexiones de la empresa: ${rooms.get(companyId)?.size ?? 0})`)

      // Mensaje de bienvenida: confirma al cliente que quedó suscripto y le dice
      // su rol/empresa (útil para debug y para que el front sepa qué esperar).
      ws.send(JSON.stringify({ type: 'connected', role, companyId }))

      ws.on('pong', () => { client.isAlive = true })
      ws.on('close', () => {
        leaveRoom(client)
        console.log(`[realtime] desconectado role=${role} empresa=${companyId}`)
      })
      ws.on('error', () => leaveRoom(client))
    } catch (err: any) {
      console.error('[realtime] error en handshake:', err?.message ?? err)
      // 1011 = error interno del server (close code estándar de WebSocket).
      try { ws.close(1011, 'internal_error') } catch { /* ya cerrado */ }
    }
  })

  // Heartbeat: cada 30s pingeamos a todos. Si una conexión no respondió el
  // ping anterior (isAlive sigue en false), la consideramos muerta y la
  // cerramos. Evita acumular sockets zombie (móvil que perdió señal, etc.).
  const heartbeat = setInterval(() => {
    // Snapshot de salas y clientes ([...]) porque terminar una conexión muerta
    // dispara su 'close' -> leaveRoom, que muta los Set/Map mientras iteramos.
    for (const set of [...rooms.values()]) {
      for (const client of [...set]) {
        if (!client.isAlive) { client.ws.terminate(); continue }
        client.isAlive = false
        client.ws.ping()
      }
    }
  }, 30_000)

  wss.on('close', () => clearInterval(heartbeat))

  console.log('[realtime] WebSocket server escuchando en /ws')
}
