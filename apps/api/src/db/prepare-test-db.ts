import { closeDatabase, db } from './client.ts'
import { instanceSettings } from './schema.ts'
import { ensureDatabaseExists } from './ensure.ts'
import { runMigrations } from './migrate.ts'
import { env } from '../env.ts'

/**
 * Creates and migrates whatever database `TEST_DATABASE_URL` points at.
 *
 * Exists so the end-to-end harness can prepare a database WITHOUT importing anything from
 * `apps/api`. `apps/app` may never import from `apps/api` — not even a type — so the two meet at a
 * process boundary instead, exactly as they do in production. See docs/01-architecture.md.
 */
if (env.NODE_ENV !== 'test') {
  throw new Error('prepare-test-db is only for NODE_ENV=test. It creates and migrates a database.')
}

await ensureDatabaseExists()
await runMigrations()
// A test database takes every account its tests register (#71). Left as the migration started it,
// `first`, the first to register would become its curator and close sign-up behind them.
await db
  .insert(instanceSettings)
  .values({ signUp: 'open' })
  .onConflictDoUpdate({ target: instanceSettings.one, set: { signUp: 'open' } })
console.log(`Prepared ${new URL(env.DATABASE_URL).pathname.slice(1)}.`)
await closeDatabase()
