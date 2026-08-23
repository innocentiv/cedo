import { Elysia, ValidationError } from 'elysia'
import { z } from 'zod'
import { sql as raw } from 'drizzle-orm'
import type { ApiError } from '@cedo/contract'
import { db } from './db/client.ts'
import { DomainError, toApiError } from './lib/error.ts'
import { mcpHandler, withCaller } from './mcp/index.ts'
import { resolveTokenCaller } from './mcp/token.ts'
import { createOpenapiPlugin } from './plugins/openapi.ts'
import { adminRoutes } from './modules/admin/index.ts'
import { authRoutes } from './modules/auth/index.ts'
import { exerciseRoutes } from './modules/exercise/index.ts'
import { groupRoutes } from './modules/group/index.ts'
import { mediaBlobRoutes, mediaRoutes } from './modules/media/index.ts'
import { exerciseHistoryRoutes, sessionRoutes } from './modules/session/index.ts'
import { workoutRoutes } from './modules/workout/index.ts'
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
      const { status, body } = describeError(error, code)
      set.status = status
      return body
    })
    .get(
      '/health',
      async () => {
        await db.execute(raw`select 1`)
        return { ok: true, db: true }
      },
      { detail: { summary: 'Liveness and database reachability' } },
    )
    .use(adminRoutes)
    .use(authRoutes)
    .use(exerciseRoutes)
    .use(exerciseHistoryRoutes)
    .use(groupRoutes)
    .use(mediaBlobRoutes)
    .use(mediaRoutes)
    .use(sessionRoutes)
    .use(workoutRoutes)
    .use(tokenRoutes)
    .mount('/mcp', serveMcp)
}

/**
 * The MCP server, mounted as a plain fetch handler.
 *
 * Authentication happens HERE, before the handler runs: the SDK "never reads tokens from headers
 * and never verifies them" by design — its caller does, and passes the result in. A personal access
 * token resolves to the same `Caller` the HTTP routes use, so every tool gets exactly the
 * permissions the UI would. See docs/07-mcp.md.
 */
async function serveMcp(request: Request): Promise<Response> {
  const caller = await resolveTokenCaller(request.headers.get('authorization'))
  if (caller === null) {
    return Response.json(
      envelope(
        'unauthenticated',
        'MCP requires a personal access token. Create one in Settings, then pass it as ' +
          'Authorization: Bearer <token>.',
      ),
      { status: 401 },
    )
  }
  return await mcpHandler.fetch(request, withCaller(caller))
}

export type App = ReturnType<typeof createApp>

/**
 * Maps anything thrown anywhere in the API onto the wire envelope. Pure, so it can be reasoned
 * about and tested without a server, and so there is exactly ONE place where a failure becomes a
 * status code. No handler anywhere constructs an error response. See docs/02-conventions.md.
 */
export function describeError(
  error: unknown,
  code: string | number,
): { status: number; body: ApiError } {
  if (error instanceof DomainError) return toApiError(error)

  if (code === 'VALIDATION') {
    return {
      status: 422,
      body: envelope('validation_failed', 'Request failed validation', validationDetails(error)),
    }
  }

  /**
   * A malformed or undecodable request body. Without this branch it falls through to the 500 case,
   * so any client sending broken JSON looks like a server fault and pollutes the logs of whoever is
   * self-hosting this.
   */
  if (code === 'PARSE') {
    return { status: 400, body: envelope('validation_failed', 'Could not parse the request body') }
  }

  if (code === 'NOT_FOUND') {
    return { status: 404, body: envelope('not_found', 'No such route') }
  }

  // Anything reaching here is a bug. Log it in full; tell the caller nothing.
  console.error('Unhandled error:', error)
  return { status: 500, body: envelope('internal', 'Something went wrong') }
}

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
