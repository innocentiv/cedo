import { Elysia } from 'elysia'
import { z } from 'zod'
import { PlatformStatus, SlowQuery, SlowQueryQuery } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { requireCurator } from '../review/curation.ts'
import { platformStatus, slowQueries } from '../review/diagnostics.ts'
import { VERSION } from '../../version.ts'

/**
 * Diagnostics over HTTP, mirroring the MCP tools exactly.
 *
 * Both surfaces call the same functions in `review/diagnostics.ts`, so there is no version of this
 * that an AI can see and a person cannot. `requireCurator` answers 404 rather than 403: whether an
 * instance has a curator at all is not something an ordinary caller needs to learn.
 * See docs/06-api.md.
 */
export const adminRoutes = new Elysia({ prefix: '/admin', tags: ['admin'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get(
    '/status',
    async ({ caller }) => {
      await requireCurator(caller)
      return await platformStatus(VERSION)
    },
    {
      response: PlatformStatus,
      detail: { summary: 'Row counts, extensions and planner settings for this instance' },
    },
  )
  .get(
    '/slow-queries',
    async ({ caller, query }) => {
      await requireCurator(caller)
      return await slowQueries(query.limit)
    },
    {
      query: SlowQueryQuery,
      response: z.array(SlowQuery),
      detail: { summary: "This instance's worst queries, from pg_stat_statements" },
    },
  )
