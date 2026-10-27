import { z } from 'zod'

/**
 * Validated once at boot. A misconfigured deployment fails immediately with a readable message
 * instead of throwing something obscure on the first request — which matters when the operator is
 * a stranger running this on their own NAS. See docs/09-deployment.md.
 */
const Env = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/u }),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  UPLOAD_DIR: z.string().min(1).default('/data/uploads'),
  /**
   * Promoted to editor of the seeded `cedo` group on every seed run, which is what makes someone a
   * platform curator: they can edit the shared exercise library and read diagnostics. Everyone else
   * joins that group as a reader. Optional — an instance with no curator still works, its library
   * is just fixed at whatever shipped. See docs/07-mcp.md.
   */
  CEDO_CURATOR_USERNAME: z.string().min(1).optional(),
})

export type Env = z.output<typeof Env>

/**
 * Under test, the database URL comes from TEST_DATABASE_URL and DATABASE_URL is IGNORED.
 *
 * This is a safety interlock, not a convenience: the test harness truncates every table, so it
 * must be impossible for a stray `bun test` to reach a development or production database.
 * `bun test` sets NODE_ENV=test on its own, so this cannot be forgotten.
 *
 * Under `bun test --parallel` each worker gets its own database, since workers run concurrently
 * and would otherwise truncate each other's rows mid-test.
 */
function resolveDatabaseUrl(source: Record<string, string | undefined>): string | undefined {
  if (source['NODE_ENV'] !== 'test') return source['DATABASE_URL']

  const testUrl = source['TEST_DATABASE_URL']
  if (testUrl === undefined || testUrl === '') {
    throw new Error(
      'TEST_DATABASE_URL is required when NODE_ENV=test.\n' +
        'The test harness truncates every table, so it will not use DATABASE_URL.\n' +
        'Start one with `bun run db:test` and see .env.example.',
    )
  }

  /**
   * The performance suite gets its OWN database, derived from the same URL.
   *
   * It seeds a quarter of a million rows and reuses them across runs; the integration harness
   * truncates every table between tests. Sharing one database would mean either rebuilding the
   * seed constantly or having `bun test` silently destroy it.
   */
  if (source['CEDO_PERF'] !== undefined) return suffixed(testUrl, '_perf')

  const worker = source['BUN_TEST_WORKER_ID']
  return worker === undefined ? testUrl : suffixed(testUrl, `_w${worker}`)
}

function suffixed(databaseUrl: string, suffix: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `${url.pathname}${suffix}`
  return url.toString()
}

/**
 * An empty variable means UNSET, not "the empty string".
 *
 * `.env` files are written by hand and blank values are the natural way to leave something out —
 * `.env.example` itself ships `CEDO_CURATOR_USERNAME=`. Without this, that blank line is a hard boot
 * failure with a message about minimum string length, which is a miserable first experience for
 * someone self-hosting.
 */
function withoutBlanks(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value?.trim() === '' ? undefined : value]),
  )
}

function load(): Env {
  const source = withoutBlanks(Bun.env)
  const parsed = Env.safeParse({ ...source, DATABASE_URL: resolveDatabaseUrl(source) })
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${problems}\n\nSee .env.example.`)
  }
  return parsed.data
}

export const env = load()
export const isTest = env.NODE_ENV === 'test'
