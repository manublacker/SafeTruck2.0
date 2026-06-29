/**
 * Helper de testing HTTP para los routers de Express del backend.
 *
 * En vez de levantar todo `server.ts` (que abre la DB real, el WebSocket y
 * escucha en un puerto fijo), montamos UN router suelto en un Express limpio,
 * lo levantamos en un puerto efímero (`listen(0)`), hacemos un request con el
 * `fetch` nativo de Node y cerramos el server. Sin dependencias nuevas y sin
 * tocar nada del código de la app: los tests son 100% aditivos.
 *
 * La DB y los middlewares se reemplazan con `vi.mock` en cada test, así estos
 * helpers nunca tocan Postgres ni Supabase.
 */
import express, { type Express, type Router, type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'

/** Monta un router en un Express nuevo con `express.json()` ya configurado. */
export function appWith(router: Router, ...pre: RequestHandler[]): Express {
  const app = express()
  app.use(express.json())
  for (const mw of pre) app.use(mw)
  app.use(router)
  return app
}

export interface TestResponse {
  status: number
  /** Body parseado como JSON (o `null` si la respuesta no era JSON). */
  body: any
  /** Body crudo, por si se quiere inspeccionar texto. */
  text: string
}

export interface RequestOptions {
  body?: unknown
  headers?: Record<string, string>
}

/**
 * Levanta `app` en un puerto efímero, hace UN request y cierra el server.
 * Aísla cada caso: no comparte estado de red entre tests.
 */
export async function request(
  app: Express,
  method: string,
  path: string,
  opts: RequestOptions = {}
): Promise<TestResponse> {
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const { port } = server.address() as AddressInfo

  try {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    let bodyInit: string | undefined
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json'
      bodyInit = JSON.stringify(opts.body)
    }

    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      body: bodyInit,
    })

    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }

    return { status: res.status, body, text }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/**
 * Middleware de auth FALSO para los tests de rutas: lee el usuario de la
 * cabecera `x-test-user` (JSON) o usa uno por defecto. Así probamos la lógica
 * del handler sin depender del authMiddleware real (ese tiene sus propios tests).
 */
export const fakeAuth: RequestHandler = (req, _res, next) => {
  const raw = req.headers['x-test-user']
  ;(req as any).user = raw
    ? JSON.parse(Array.isArray(raw) ? raw[0] : raw)
    : { id: 'admin-1', email: 'admin@test.com', user_metadata: { full_name: 'Admin Uno' } }
  next()
}

/** Serializa un usuario para mandarlo en la cabecera `x-test-user`. */
export function asUser(user: Record<string, unknown>): Record<string, string> {
  return { 'x-test-user': JSON.stringify(user) }
}
