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

  const worker = source['BUN_TEST_WORKER_ID']
  if (worker === undefined) return testUrl

  const url = new URL(testUrl)
  url.pathname = `${url.pathname}_w${worker}`
  return url.toString()
}

function load(): Env {
  const parsed = Env.safeParse({ ...Bun.env, DATABASE_URL: resolveDatabaseUrl(Bun.env) })
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
