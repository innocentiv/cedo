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

function load(): Env {
  const parsed = Env.safeParse(Bun.env)
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
