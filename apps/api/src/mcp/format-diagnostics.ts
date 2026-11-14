import type { PlatformStatus, SlowQuery } from '@cedo/contract'

/**
 * What a running instance says of itself, for whoever must diagnose one with no shell on it
 * (docs/07-mcp.md, objective 3) — compact text, as `format.ts` is for the rest.
 */

/** The instance in a screen: versions, sizes, rows, the planner's settings, the last login. */
export const statusLines = (status: PlatformStatus): string =>
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
    '',
    status.lastLoginAddress === null
      ? 'No login attempt since the server started.'
      : `The last login attempt came from ${status.lastLoginAddress}. If that is the proxy ` +
        'in front of Caddy, every client shares one login limit: see docs/09-deployment.md.',
  ].join('\n')

/** The worst queries, a block each: its totals, then the statement as Postgres normalised it. */
export const slowQueryLines = (rows: readonly SlowQuery[]): string =>
  rows.length === 0
    ? 'No query statistics recorded yet.'
    : rows
        .map(
          (r) =>
            `${r.totalMs}ms total | ${r.calls} calls | ${r.meanMs}ms mean | ${r.rows} rows\n  ${r.query}`,
        )
        .join('\n\n')
