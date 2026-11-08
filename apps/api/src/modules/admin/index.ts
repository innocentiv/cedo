import { Elysia } from 'elysia'
import { z } from 'zod'
import { PlatformStatus, SlowQuery, SlowQueryQuery, VERSION } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { platformStatus, slowQueries } from '../review/diagnostics.ts'

/**
 * Diagnostics over HTTP, mirroring the MCP tools exactly.
 *
 * Both surfaces call the same functions in `review/diagnostics.ts`, which check for a curator
 * themselves — so there is no version of this that an AI can see and a person cannot.
 * See docs/06-api.md.
 */
export const adminRoutes = new Elysia({ prefix: '/admin', tags: ['admin'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/status', async ({ caller }) => await platformStatus(caller, VERSION), {
    response: PlatformStatus,
    detail: { summary: 'Row counts, extensions and planner settings for this instance' },
  })
  .get('/slow-queries', async ({ caller, query }) => await slowQueries(caller, query.limit), {
    query: SlowQueryQuery,
    response: z.array(SlowQuery),
    detail: { summary: "This instance's worst queries, from pg_stat_statements" },
  })
