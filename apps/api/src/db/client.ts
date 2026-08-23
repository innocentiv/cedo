import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.ts'
import * as schema from './schema.ts'

/**
 * Per-call query recording, used by the performance suite to detect N+1 by invariant: the same
 * endpoint must issue the SAME number of queries at 10 rows and at 1000.
 * See docs/adr/0018-n1-detection.md.
 */
/** A statement exactly as issued, so the performance suite can EXPLAIN the real thing. */
export interface RecordedQuery {
  readonly sql: string
  readonly params: readonly unknown[]
}

interface QueryRecord {
  readonly statements: RecordedQuery[]
}
const recorder = new AsyncLocalStorage<QueryRecord>()

export const sql = postgres(env.DATABASE_URL, {
  // A self-hosted instance shares a small box with everything else the owner runs.
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  // Return timestamps untouched; the contract serialises them.
  transform: { undefined: null },
  /**
   * Postgres NOTICEs ("extension already exists, skipping") are printed as raw objects by
   * postgres.js and read exactly like crashes to anyone self-hosting this. Migrations are
   * deliberately idempotent, so these are expected and are routed to debug output instead.
   */
  onnotice: (notice) => {
    if (env.NODE_ENV === 'development') console.debug(`[pg] ${notice['message']}`)
  },
})

export const db = drizzle(sql, {
  schema,
  logger: {
    logQuery(query, params) {
      recorder.getStore()?.statements.push({ sql: query, params })
    },
  },
})

export type Database = typeof db
/** The handle passed to a `db.transaction` callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Run `fn`, returning its result alongside every SQL statement it issued. */
export async function withQueryCount<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; count: number; statements: RecordedQuery[] }> {
  const record: QueryRecord = { statements: [] }
  const result = await recorder.run(record, fn)
  return { result, count: record.statements.length, statements: record.statements }
}

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 })
}
