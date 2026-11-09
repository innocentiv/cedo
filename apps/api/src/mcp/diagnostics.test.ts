import { beforeEach, describe, expect, test } from 'bun:test'
import { type TestApi, type TestUser, makeApi } from '../test/harness.ts'
import { callTool, mintPat, textOf } from '../test/mcp-wire.ts'

/**
 * The two tools that tell an AI what is happening inside an instance it has no shell on (#83: the
 * tools themselves were never called). Driven as a client drives them: JSON-RPC with a token.
 * The services behind them, and who may call them, are `modules/review/curator.test.ts`.
 */
let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

describe('diagnostic tools, for a curator', () => {
  test('platform_status reads the instance: version, Postgres, rows, planner, last login', async () => {
    await h.curator(alice)
    const out = textOf((await callTool(await mintPat(alice), 'platform_status')).body)
    const lines = out.split('\n')

    expect(lines[0]).toMatch(/^cedo \S+ on PostgreSQL \d+/u)
    expect(lines[1]).toMatch(/^database .+, \d+ migrations applied$/u)
    expect(lines).toContain('rows:')
    expect(lines.some((line) => /^ {2}users: \d+$/u.test(line))).toBe(true)
    expect(lines).toContain('planner settings:')
    expect(lines.some((line) => /^ {2}random_page_cost = /u.test(line))).toBe(true)
    // The test database preloads it, as docker-compose.yml does for a real instance.
    expect(lines).toContain('Query statistics are available — call db_slow_queries.')
    expect(out).toMatch(
      /No login attempt since the server started\.|The last login attempt came from/u,
    )
  })

  test('db_slow_queries lists statements by total time, with their calls and rows', async () => {
    await h.curator(alice)
    const out = textOf((await callTool(await mintPat(alice), 'db_slow_queries', { limit: 3 })).body)
    const entries = out.split('\n\n')

    expect(entries.length).toBeGreaterThan(0)
    expect(entries.length).toBeLessThanOrEqual(3)
    for (const entry of entries)
      expect(entry).toMatch(/^[\d.]+ms total \| \d+ calls \| [\d.]+ms mean \| \d+ rows\n {2}\S/u)
  })
})

describe('diagnostic tools, for anyone else', () => {
  /** A refusal that read as a result would tell an AI the instance has no slow queries. */
  test('db_slow_queries is an error, not an answer', async () => {
    const result = await callTool(await mintPat(alice), 'db_slow_queries')
    expect(result.body.result?.isError).toBe(true)
    expect(textOf(result.body)).not.toContain('ms total')
  })
})
