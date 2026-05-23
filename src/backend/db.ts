/*******************************************************
 * db.ts
 *
 * Módulo de conexión a PostgreSQL.
 * Exporta un pool de conexiones reutilizable para
 * que el resto del backend no abra una conexión nueva
 * en cada request.
 *******************************************************/

import { Pool } from "pg";

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host:     process.env.PGHOST     ?? "localhost",
      port:     Number(process.env.PGPORT ?? 5432),
      database: process.env.PGDATABASE ?? "safetruck",
      user:     process.env.PGUSER     ?? "postgres",
      password: process.env.PGPASSWORD ?? "postgres",
      ssl: { rejectUnauthorized: false },
    });

export default pool;