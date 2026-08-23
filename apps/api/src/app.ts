import { Elysia, ValidationError } from 'elysia'
import { z } from 'zod'
import { sql as raw } from 'drizzle-orm'
import type { ApiError } from '@cedo/contract'
import { db } from './db/client.ts'
import { DomainError, toApiError } from './lib/error.ts'
import { createOpenapiPlugin } from './plugins/openapi.ts'
import { authRoutes } from './modules/auth/index.ts'
import { exerciseRoutes } from './modules/exercise/index.ts'
import { groupRoutes } from './modules/group/index.ts'
import { mediaRoutes } from './modules/media/index.ts'
import { tokenRoutes } from './modules/token/index.ts'

const envelope = (
  code: ApiError['error']['code'],
  message: string,
  details: ApiError['error']['details'] = null,
): ApiError => ({ error: { code, message, details } })

/**
 * Built as a function so tests can construct an isolated instance. See docs/10-testing.md.
 *
 * Every failure leaves through the single `onError` handler below, which is what makes the error
 * envelope uniform without any handler ever constructing one.
 */
export function createApp() {
  return new Elysia()
    .use(createOpenapiPlugin())
    .onError(({ error, code, set }) => {
      if (error instanceof DomainError) {
        const { status, body } = toApiError(error)
        set.status = status
        return body
      }

      if (code === 'VALIDATION') {
        set.status = 422
        return envelope('validation_failed', 'Request failed validation', validationDetails(error))
      }
      /**
       * A malformed or undecodable request body. Without this branch it falls through to the 500
       * handler, so any client sending broken JSON looks like a server fault and pollutes the logs
       * of whoever is self-hosting this.
       */
      if (code === 'PARSE') {
        set.status = 400
        return envelope('validation_failed', 'Could not parse the request body')
      }

      if (code === 'NOT_FOUND') {
        set.status = 404
        return envelope('not_found', 'No such route')
      }

      // Anything reaching here is a bug. Log it in full; tell the caller nothing.
      console.error('Unhandled error:', error)
      set.status = 500
      return envelope('internal', 'Something went wrong')
    })
    .get(
      '/health',
      async () => {
        await db.execute(raw`select 1`)
        return { ok: true, db: true }
      },
      { detail: { summary: 'Liveness and database reachability' } },
    )
    .use(authRoutes)
    .use(exerciseRoutes)
    .use(groupRoutes)
    .use(mediaRoutes)
    .use(tokenRoutes)
}

export type App = ReturnType<typeof createApp>

/**
 * Elysia's ValidationError exposes `.all`, which works the same for every Standard Schema
 * validator. Each entry ALSO carries `value` — the submitted input, which on a registration or
 * login includes the plaintext password. Only `path` and `message` are ever echoed back.
 *
 * Parsed rather than cast: the shape comes from a library at runtime, which is exactly the
 * situation Zod exists for.
 */
const ValidationIssues = z.array(
  z.object({
    path: z.string().default(''),
    message: z.string().default(''),
    summary: z.string().default(''),
  }),
)

function validationDetails(error: unknown): ApiError['error']['details'] {
  if (!(error instanceof ValidationError)) return null

  const parsed = ValidationIssues.safeParse(error.all)
  if (!parsed.success) return null

  return parsed.data
    .map((issue) => ({
      path: issue.path.replace(/^\//u, ''),
      message: issue.message === '' ? issue.summary : issue.message,
    }))
    .filter((detail) => detail.message !== '')
}
