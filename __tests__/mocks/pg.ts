// Stub de `pg`. El Pool falso no abre ninguna conexión real: sólo permite que
// db.ts (y por transtitividad graphCache.ts) se importen en los tests.
export class Pool {
  constructor(_config?: unknown) {}
  query(): Promise<{ rows: unknown[] }> {
    return Promise.resolve({ rows: [] })
  }
  end(): Promise<void> {
    return Promise.resolve()
  }
  on(): this {
    return this
  }
}
export default { Pool }
