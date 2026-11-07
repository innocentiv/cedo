import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { DomainError } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { platformStatus, slowQueries } from '../../modules/review/diagnostics.ts'
import { READ, text } from '../format.ts'

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
        'database size, and the planner settings that decide whether indexes get used. Curator only.',
      inputSchema: z.object({}),
      annotations: READ,
    },
    async () => {
      const status = await platformStatus(caller, version)

      return text(
        [
          `cedo ${status.version} on ${status.postgres}`,
          `database ${status.databaseSize}, ${status.migrationsApplied} migrations applied`,
          `extensions: ${status.extensions.join(', ')}`,
          '',
          'rows:',
          ...Object.entries(status.rowCounts).map(([table, rows]) => `  ${table}: ${rows}`),
          '',
          'planner settings:',
          ...Object.entries(status.settings).map(([name, value]) => `  ${name} = ${value}`),
          '',
          status.extensions.includes('pg_stat_statements')
            ? 'Query statistics are available — call db_slow_queries.'
            : 'pg_stat_statements is NOT installed, so query statistics are unavailable.',
        ].join('\n'),
      )
    },
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
        const rows = await slowQueries(caller, limit)
        if (rows.length === 0) return text('No query statistics recorded yet.')

        return text(
          rows
            .map(
              (r) =>
                `${r.totalMs}ms total | ${r.calls} calls | ${r.meanMs}ms mean | ${r.rows} rows\n  ${r.query}`,
            )
            .join('\n\n'),
        )
      } catch (error: unknown) {
        // Only the "extension not installed" conflict is an answer. Anything else — above all the
        // service's 404 for a non-curator — stays an error, or the refusal reads as a result.
        if (error instanceof DomainError && error.code === 'conflict') return text(error.message)
        throw error
      }
    },
  )
}
