import { z } from 'zod'

/**
 * Instance diagnostics, readable only by a curator — an editor of the seeded `cedo` group.
 *
 * These exist for one situation: someone self-hosting reports "it is slow on my NAS" and there is
 * no shell to log into. They are the same shapes the `platform_status` and `db_slow_queries` MCP
 * tools return, so the AI and a human read exactly the same numbers. See docs/07-mcp.md.
 */

/**
 * A normalised statement from `pg_stat_statements`. The extension stores `$1` placeholders and
 * never literal parameter values, so this cannot disclose a user's data.
 */
export const SlowQuery = z.object({
  calls: z.int().nonnegative(),
  meanMs: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  rows: z.int().nonnegative(),
  query: z.string(),
})
export type SlowQuery = z.output<typeof SlowQuery>

export const SlowQueryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(10),
})
export type SlowQueryQuery = z.output<typeof SlowQueryQuery>

export const PlatformStatus = z.object({
  version: z.string(),
  postgres: z.string(),
  extensions: z.array(z.string()),
  migrationsApplied: z.int().nonnegative(),
  rowCounts: z.record(z.string(), z.int().nonnegative()),
  databaseSize: z.string(),
  /** The planner settings that decide whether the indexes get used at all. */
  settings: z.record(z.string(), z.string()),
})
export type PlatformStatus = z.output<typeof PlatformStatus>
