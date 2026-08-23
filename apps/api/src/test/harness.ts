import { sql as raw } from 'drizzle-orm'
import { treaty } from '@elysiajs/eden'
import postgres from 'postgres'
import { createApp } from '../app.ts'
import { db } from '../db/client.ts'
import { env } from '../env.ts'
import { runMigrations } from '../db/migrate.ts'
import { seedCore } from '../db/seed.ts'

/**
 * Integration tests run through `treaty(app)`, which exercises the REAL Elysia lifecycle —
 * validation, the auth macro, the error handler — with no socket and no port to manage.
 * See docs/10-testing.md.
 *
 * Isolation is per worker: `bun test --parallel` gives each worker its own database via
 * BUN_TEST_WORKER_ID, and tests inside a worker run sequentially, so truncating between them is
 * both safe and cheap.
 */

let ready: Promise<void> | undefined

/**
 * Under `--parallel` each worker uses its own database (see env.ts), which will not exist the
 * first time that worker runs. Created here through the maintenance database.
 */
async function ensureDatabaseExists(): Promise<void> {
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
  } finally {
    await client.end()
  }
}

/** Migrations run once per worker process, not once per test. */
async function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    await ensureDatabaseExists()
    await runMigrations()
  })()
  await ready
}

/**
 * Everything except `muscles`, which is immutable reference data seeded from the contract and
 * expensive to rewrite for no reason.
 */
async function truncateVolatileTables(): Promise<void> {
  await db.execute(raw`
    do $$
    declare statement text;
    begin
      select 'truncate table ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' cascade'
        into statement
        from pg_tables
       where schemaname = 'public'
         and tablename not in ('muscles', '__drizzle_migrations');
      if statement is not null then execute statement; end if;
    end $$;
  `)
}

type Treaty = ReturnType<typeof treaty<ReturnType<typeof createApp>>>

export interface WireResponse {
  readonly status: number
  /** Exactly what a `fetch` client receives — no revival, no transformation. */
  readonly body: unknown
}

/**
 * Fetch a route and return the raw parsed JSON.
 *
 * REQUIRED for `expectContract`. Eden Treaty revives ISO date strings into `Date` objects on the
 * client, so asserting a contract against a treaty response tests a value the real frontend never
 * receives — the frontend uses plain fetch + Zod and sees strings. Asserting on the treaty value
 * would push the contract toward accepting `Date`, which would then break the actual client.
 * See docs/adr/0015-no-eden-treaty.md.
 */
export type Wire = (path: string, init?: RequestInit) => Promise<WireResponse>

export interface TestApi {
  /** Typed client, ergonomic for driving the API. */
  readonly api: Treaty
  /** Raw client. Use this for `expectContract`. */
  readonly wire: Wire
  /** Register a fresh user and return clients that authenticate as them. */
  readonly as: (username: string) => Promise<TestUser>
  readonly groupId: string
  readonly systemUserId: string
}

export interface TestUser {
  readonly api: Treaty
  readonly wire: Wire
  readonly token: string
  readonly userId: string
  readonly username: string
  readonly personalGroupId: string
}

export const TEST_PASSWORD = 'correct horse battery staple'

function wireFor(app: ReturnType<typeof createApp>, token: string | undefined): Wire {
  return async (path, init) => {
    const headers = new Headers(init?.headers)
    if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
    if (init?.body !== undefined) headers.set('content-type', 'application/json')

    const response = await app.handle(new Request(`http://localhost${path}`, { ...init, headers }))
    const text = await response.text()
    if (text === '') return { status: response.status, body: null }
    try {
      return { status: response.status, body: JSON.parse(text) }
    } catch {
      // Not every route serves JSON — /openapi returns the Scalar UI as HTML.
      return { status: response.status, body: text }
    }
  }
}

/**
 * Resets to a known state and returns a client. Call at the top of each test file's `beforeEach`.
 */
export async function makeApi(): Promise<TestApi> {
  await ensureSchema()
  await truncateVolatileTables()
  const { userId: systemUserId, groupId } = await seedCore()

  const app = createApp()
  const api = treaty(app)

  const makeWire = (token?: string): Wire => wireFor(app, token)

  const as = async (username: string): Promise<TestUser> => {
    const { data, error } = await api.auth.register.post({
      username,
      password: TEST_PASSWORD,
      displayName: username,
    })
    // `error` is non-null whenever `data` is null, so no optional chain is needed here.
    if (data === null)
      throw new Error(`Could not register ${username}: ${JSON.stringify(error.value)}`)

    const authed = treaty(app, { headers: { authorization: `Bearer ${data.token}` } })
    const me = await authed.auth.me.get()
    if (me.data === null) throw new Error(`Could not read /auth/me for ${username}`)

    const personal = me.data.groups.find((g) => g.kind === 'personal')
    if (personal === undefined) throw new Error(`${username} has no personal group`)

    return {
      api: authed,
      wire: makeWire(data.token),
      token: data.token,
      userId: data.user.id,
      username,
      personalGroupId: personal.id,
    }
  }

  return { api, wire: makeWire(), as, groupId, systemUserId }
}
