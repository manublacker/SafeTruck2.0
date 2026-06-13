/**
 * backfill-users.ts
 *
 * Sincroniza todos los usuarios de Supabase Auth a la tabla users de Aiven.
 * Ejecutar UNA SOLA VEZ tras deployar la Fase 1.
 *
 * Uso:
 *   npx ts-node src/backend/scripts/backfill-users.ts
 *
 * Requiere las variables de entorno SUPABASE_URL, SUPABASE_SERVICE_KEY
 * y DATABASE_URL (o PGHOST/PGPORT/etc.) configuradas.
 */

import pool from "../db";
import { supabase } from "../supabaseClient";

async function main() {
  console.log("Iniciando backfill de usuarios Supabase → Aiven...\n");

  // Supabase Admin API pagina de a 1000 usuarios
  let page = 1;
  let totalInserted = 0;
  let totalSkipped = 0;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      console.error("Error al listar usuarios de Supabase:", error.message);
      process.exit(1);
    }

    const users = data?.users ?? [];
    if (users.length === 0) break;

    console.log(`Página ${page}: ${users.length} usuarios encontrados`);

    for (const user of users) {
      const full_name =
        (user.user_metadata?.["full_name"] as string | undefined) ?? null;
      const company =
        (user.user_metadata?.["company"] as string | undefined) ?? null;

      const result = await pool.query(
        `INSERT INTO users (id, email, full_name, company)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
           SET email     = EXCLUDED.email,
               full_name = COALESCE(EXCLUDED.full_name, users.full_name),
               company   = COALESCE(EXCLUDED.company,   users.company)
         RETURNING (xmax = 0) AS inserted`,
        [user.id, user.email, full_name, company]
      );

      if (result.rows[0]?.inserted) {
        totalInserted++;
        console.log(`  ✓ Insertado: ${user.email}`);
      } else {
        totalSkipped++;
        console.log(`  ~ Actualizado: ${user.email}`);
      }
    }

    if (users.length < 1000) break;
    page++;
  }

  console.log(`\nBackfill completado.`);
  console.log(`  Insertados: ${totalInserted}`);
  console.log(`  Actualizados: ${totalSkipped}`);
  console.log(`  Total procesados: ${totalInserted + totalSkipped}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Error inesperado:", err);
  process.exit(1);
});
