import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { PlatformStatus, SlowQuery } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { conflict } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { lastLoginAttemptAddress } from '../auth/login-limit.ts'
import { requireCurator } from './curation.ts'

/**
 * Instance diagnostics, for a CURATOR only — checked here, inside each function, so neither the HTTP
 * route nor the MCP tool carries the check, and no third surface can forget it. A non-curator gets
 * a 404, not a 403: whether an instance has a curator at all is not theirs to learn.
 *
 * The honest use for this is not local development — there you have psql, the source and the tests.
 * It is diagnosing a deployment nobody has a shell on: someone reports that it is slow on their NAS
 * and this is the only way to see their actual query profile and data shape. See docs/07-mcp.md.
 */

/** Counted per table rather than by a single query, so a missing table is visible as a gap. */
const COUNTED = [
  'users',
  'groups',
  'exercises',
  'media',
  'workouts',
  'workout_days',
  'workout_entries',
  'workout_sets',
  'workout_sessions',
  'set_logs',
] as const

const CountRow = z.object({ table: z.string(), rows: z.coerce.number() })
const TextRow = z.object({ value: z.string() })

export async function platformStatus(caller: Caller, version: string): Promise<PlatformStatus> {
  await requireCurator(caller)
  const counts = await db.execute(
    sql.raw(
      COUNTED.map((t) => `select '${t}' as table, count(*)::text as rows from ${t}`).join(
        ' union all ',
      ),
    ),
  )
  const extensions = await db.execute(
    sql`select extname as value from pg_extension order by extname`,
  )
  const migrations = await db.execute(
    sql`select count(*)::text as value from drizzle.__drizzle_migrations`,
  )
  const size = await db.execute(
    sql`select pg_size_pretty(pg_database_size(current_database())) as value`,
  )
  const postgres = await db.execute(sql`select version() as value`)

  /** The planner settings that actually decide whether our indexes get used. */
  const settings = await db.execute(
    sql`select name as table, setting as rows from pg_settings
        where name in ('random_page_cost', 'effective_cache_size', 'shared_buffers', 'work_mem')`,
  )

  return {
    version,
    postgres: firstText(postgres).split(' on ')[0] ?? 'unknown',
    extensions: z
      .array(TextRow)
      .parse(extensions)
      .map((r) => r.value),
    migrationsApplied: Number(firstText(migrations)),
    rowCounts: Object.fromEntries(
      z
        .array(CountRow)
        .parse(counts)
        .map((r) => [r.table, r.rows]),
    ),
    databaseSize: firstText(size),
    settings: Object.fromEntries(
      z
        .array(CountRow.extend({ rows: z.string() }))
        .parse(settings)
        .map((r) => [r.table, r.rows]),
    ),
    lastLoginAddress: lastLoginAttemptAddress(),
  }
}

const SlowQueryRow = z.object({
  calls: z.coerce.number(),
  mean_ms: z.coerce.number(),
  total_ms: z.coerce.number(),
  rows: z.coerce.number(),
  query: z.string(),
})

/**
 * The instance's own worst queries, from `pg_stat_statements`. Normalised statements only — the
 * extension stores `$1` placeholders, never literal parameter values, so this cannot leak a user's
 * data. See docs/05-database.md.
 */
export async function slowQueries(caller: Caller, limit: number): Promise<SlowQuery[]> {
  await requireCurator(caller)
  const available = await db.execute(
    sql`select count(*)::text as value from pg_extension where extname = 'pg_stat_statements'`,
  )
  if (Number(firstText(available)) === 0) {
    /**
     * A DomainError, not a plain one: the single `onError` handler answers 500 "Something went
     * wrong" to anything it does not recognise, which threw away the one sentence that tells an
     * operator how to fix their instance — for exactly the audience this endpoint exists to serve.
     */
    throw conflict(
      'pg_stat_statements is not installed on this instance. Enable it with the shared_preload_libraries flag on the db service in docker-compose.yml, then restart Postgres.',
    )
  }

  const rows = await db.execute(sql`
    select calls::text as calls,
           round(mean_exec_time::numeric, 2)::text as mean_ms,
           round(total_exec_time::numeric, 2)::text as total_ms,
           rows::text as rows,
           query
      from pg_stat_statements
     where query not like '%pg_stat_statements%'
     order by total_exec_time desc
     limit ${limit}
  `)

  return z
    .array(SlowQueryRow)
    .parse(rows)
    .map((r) => ({
      calls: r.calls,
      meanMs: r.mean_ms,
      totalMs: r.total_ms,
      rows: r.rows,
      query: r.query.replaceAll(/\s+/gu, ' ').slice(0, 300),
    }))
}

function firstText(result: unknown): string {
  const parsed = z.array(TextRow).safeParse(result)
  return parsed.success ? (parsed.data[0]?.value ?? '') : ''
}
