/*******************************************************
 * db.ts
 *
 * Módulo de conexión a PostgreSQL.
 * Exporta un pool de conexiones reutilizable para
 * que el resto del backend no abra una conexión nueva
 * en cada request.
 *******************************************************/

import { Pool, PoolClient } from "pg";

const useSsl = process.env.PGSSL !== "false";

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      host:     process.env.PGHOST     ?? "localhost",
      port:     Number(process.env.PGPORT ?? 5432),
      database: process.env.PGDATABASE ?? "safetruck",
      user:     process.env.PGUSER     ?? "postgres",
      password: process.env.PGPASSWORD ?? "postgres",
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    });

/**
 * Ejecuta `fn` dentro de una transacción sobre UN cliente dedicado del pool.
 *
 * Es la forma correcta de transaccionar con `pg.Pool`: `pool.query('BEGIN')`
 * suelto NO sirve porque cada `query()` puede tomar una conexión distinta del
 * pool → el BEGIN abre la transacción en un cliente y las queries siguientes
 * pueden caer en otro (fuera de la transacción), y un ROLLBACK podría revertir
 * escrituras de otra request. Acá hacemos checkout de un cliente, corremos todo
 * ahí, y COMMIT/ROLLBACK + release garantizado.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* la conexión ya puede estar rota */ }
    throw err;
  } finally {
    client.release();
  }
}

export default pool;