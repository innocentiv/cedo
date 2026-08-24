import postgres from 'postgres'
import { env } from '../env.ts'

/**
 * Creates the configured database if it is missing, through the maintenance database.
 *
 * Needed by both test entry points and for the same reason: neither the per-worker integration
 * databases (`cedo_test_w3`) nor the performance database (`cedo_test_perf`) exist until something
 * asks for them, and requiring an operator to create them by hand would make `bun test` fail on a
 * fresh checkout for a reason that has nothing to do with the code.
 */
export async function ensureDatabaseExists(): Promise<void> {
  const url = new URL(env.DATABASE_URL)
  // Decoded, because postgres.js decodes it before connecting — creating `cedo%20test` and then
  // connecting to `cedo test` fails with an error that points nowhere near the cause.
  const name = decodeURIComponent(url.pathname.slice(1))
  const admin = new URL(url)
  admin.pathname = '/postgres'

  const client = postgres(admin.toString(), { max: 1, onnotice: () => {} })
  try {
    const rows = await client`select 1 from pg_database where datname = ${name}`
    // `create database` cannot be parameterised, so the identifier is quoted and any embedded
    // quote doubled.
    if (rows.length === 0) await client.unsafe(`create database "${name.replaceAll('"', '""')}"`)
  } catch (error) {
    throw new Error(unreachable(url, error), { cause: error })
  } finally {
    await client.end()
  }
}

/**
 * The first thing a new contributor gets wrong, so it is worth a real sentence.
 *
 * Forgetting `bun run db:test` surfaces as `connect ECONNREFUSED ::1:55433` from eleven unrelated
 * test files at once, which names neither the cause nor the fix.
 */
function unreachable(url: URL, error: unknown): string {
  const refused = error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED'
  if (!refused) {
    return `Could not reach Postgres at ${url.host}: ${error instanceof Error ? error.message : String(error)}`
  }
  return [
    `No Postgres is listening on ${url.host}.`,
    '',
    'Start the databases with:  bun run db:up',
    'Or set everything up at once with:  bun run setup',
    '',
    'See README.md — "Development".',
  ].join('\n')
}
