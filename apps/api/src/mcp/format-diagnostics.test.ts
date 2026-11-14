import { describe, expect, test } from 'bun:test'
import { PlatformStatus, SlowQuery } from '@cedo/contract'
import { slowQueryLines, statusLines } from './format-diagnostics.ts'

/**
 * What the diagnostic tools say, as the model reads it: a contract value in, the whole text out,
 * with no wire and no database (docs/07-mcp.md, "Adding a tool"). That the tools reach these, and
 * refuse whoever is not a curator, is `diagnostics.test.ts`'s, through the wire.
 */

const status = PlatformStatus.parse({
  version: '0.1.2',
  postgres: 'PostgreSQL 18.1',
  extensions: ['plpgsql', 'pg_trgm'],
  migrationsApplied: 41,
  rowCounts: { users: 3, set_logs: 1250 },
  databaseSize: '12 MB',
  settings: { random_page_cost: '1.1', work_mem: '4MB' },
  lastLoginAddress: null,
})

describe('the instance’s status', () => {
  test('versions, sizes, rows and the planner’s settings, a block each', () => {
    expect(statusLines(status)).toBe(
      [
        'cedo 0.1.2 on PostgreSQL 18.1',
        'database 12 MB, 41 migrations applied',
        'extensions: plpgsql, pg_trgm',
        '',
        'rows:',
        '  users: 3',
        '  set_logs: 1250',
        '',
        'planner settings:',
        '  random_page_cost = 1.1',
        '  work_mem = 4MB',
        '',
        'pg_stat_statements is NOT installed, so query statistics are unavailable.',
        '',
        'No login attempt since the server started.',
      ].join('\n'),
    )
  })

  test('with query statistics installed, it says which tool reads them', () => {
    const lines = statusLines({ ...status, extensions: ['plpgsql', 'pg_stat_statements'] })
    expect(lines.split('\n').slice(-3)).toEqual([
      'Query statistics are available — call db_slow_queries.',
      '',
      'No login attempt since the server started.',
    ])
  })

  /** #72: behind a proxy that hides the client, every login shares one limit — said where it shows. */
  test('the last login’s address, and what it means if it is the proxy’s', () => {
    const lines = statusLines({ ...status, lastLoginAddress: '203.0.113.7' })
    expect(lines.split('\n').at(-1)).toBe(
      'The last login attempt came from 203.0.113.7. If that is the proxy in front of Caddy, every client shares one login limit: see docs/09-deployment.md.',
    )
  })
})

describe('the slowest queries', () => {
  const query = (totalMs: number, statement: string) =>
    SlowQuery.parse({ calls: 120, meanMs: 4.2, totalMs, rows: 240, query: statement })

  test('a block each: its totals, then the statement as Postgres normalised it', () => {
    const rows = [
      query(504, 'select * from set_logs where session_id = $1'),
      query(96.5, 'select count(*) from exercises'),
    ]
    expect(slowQueryLines(rows)).toBe(
      [
        '504ms total | 120 calls | 4.2ms mean | 240 rows',
        '  select * from set_logs where session_id = $1',
        '',
        '96.5ms total | 120 calls | 4.2ms mean | 240 rows',
        '  select count(*) from exercises',
      ].join('\n'),
    )
  })

  test('none recorded yet is said, not an empty answer', () => {
    expect(slowQueryLines([])).toBe('No query statistics recorded yet.')
  })
})

describe('one of anything, in the instance’s numbers too', () => {
  test('one migration, one call and one row are each said in the singular', () => {
    expect(statusLines({ ...status, migrationsApplied: 1 }).split('\n')[1]).toBe(
      'database 12 MB, 1 migration applied',
    )
    const once = SlowQuery.parse({ calls: 1, meanMs: 12, totalMs: 12, rows: 1, query: 'select 1' })
    expect(slowQueryLines([once])).toBe(
      ['12ms total | 1 call | 12ms mean | 1 row', '  select 1'].join('\n'),
    )
  })
})
