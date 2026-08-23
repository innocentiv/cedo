import { sql as raw } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { closeDatabase, db } from './client.ts'

/**
 * Runs at container start, before the server binds. Idempotent and safe to re-run, because a
 * self-hosted deployment restarts for reasons nobody planned. See docs/05-database.md.
 */
export async function runMigrations(): Promise<void> {
  // Drizzle Kit does not generate extension statements, and the trigram index depends on one.
  await db.execute(raw`create extension if not exists pg_trgm`)
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
}

if (import.meta.main) {
  await runMigrations()
  await closeDatabase()
  console.log('Migrations applied.')
}
