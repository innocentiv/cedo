import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { DomainError } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { platformStatus, slowQueries } from '../../modules/review/diagnostics.ts'
import { READ, text } from '../format.ts'
import { slowQueryLines, statusLines } from '../format-diagnostics.ts'

/**
 * OBJECTIVE 3 — telling an AI what is actually happening inside a running instance.
 *
 * Honest about its value: during local development this adds nothing, because psql and the source
 * are right there. It earns its place when the instance belongs to someone else and there is no
 * shell — "it is slow on my NAS" is otherwise unanswerable. Curator-only.
 * See docs/07-mcp.md.
 */
export function registerDiagnosticTools(server: McpServer, caller: Caller, version: string): void {
  server.registerTool(
    'platform_status',
    {
      title: 'Instance status',
      description:
        'Postgres version, installed extensions, migrations applied, row counts per table, ' +
        'database size, the planner settings that decide whether indexes get used, and where the ' +
        'last login attempt came from. Curator only.',
      inputSchema: z.object({}),
      annotations: READ,
    },
    async () => text(statusLines(await platformStatus(caller, version))),
  )

  server.registerTool(
    'db_slow_queries',
    {
      title: 'Slowest queries',
      description:
        "The instance's worst queries by total execution time, from pg_stat_statements. Use this " +
        'to diagnose a slow deployment. Statements are normalised by Postgres — parameters appear ' +
        'as $1 placeholders, so no user data is exposed. Curator only.',
      inputSchema: z.object({ limit: z.int().min(1).max(50).default(10) }),
      annotations: READ,
    },
    async ({ limit }) => {
      try {
        return text(slowQueryLines(await slowQueries(caller, limit)))
      } catch (error: unknown) {
        // Only the "extension not installed" conflict is an answer. Anything else — above all the
        // service's 404 for a non-curator — stays an error, or the refusal reads as a result.
        if (error instanceof DomainError && error.code === 'conflict') return text(error.message)
        throw error
      }
    },
  )
}
