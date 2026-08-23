import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { PlatformStatus, SlowQuery } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupMembers } from '../../db/schema.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/**
 * `/admin/*` is the HTTP half of the diagnostics an AI reads over MCP. The thing worth testing is
 * not that the numbers are right — they come from Postgres — but that only a curator can see them,
 * and that what comes back matches the published contract.
 */

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

/** Editor of the seeded shared group. There is no separate admin flag. See docs/07-mcp.md. */
async function promote(user: TestUser): Promise<void> {
  await db
    .insert(groupMembers)
    .values({ groupId: h.groupId, userId: user.userId, role: 'editor' })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.userId],
      set: { role: 'editor' },
    })
}

describe('diagnostics are curator-only', () => {
  test('an ordinary user gets 404, not 403', async () => {
    // 403 would confirm the endpoint exists and that someone, somewhere, is a curator.
    expect((await alice.wire('/admin/status')).status).toBe(404)
    expect((await alice.wire('/admin/slow-queries')).status).toBe(404)
  })

  test('an anonymous caller gets 401', async () => {
    expect((await h.wire('/admin/status')).status).toBe(401)
  })
})

describe('a curator', () => {
  test('reads the instance status, matching the contract', async () => {
    await promote(alice)
    const res = await alice.wire('/admin/status')
    const status = expectContract(PlatformStatus, res.body)

    expect(status.rowCounts['users']).toBeGreaterThan(0)
    expect(status.extensions).toContain('pg_trgm')
    // The setting that decides whether the trigram and keyset indexes get used at all.
    expect(status.settings['random_page_cost']).toBeDefined()
  })

  test('reads the slow query log, matching the contract', async () => {
    await promote(alice)
    const res = await alice.wire('/admin/slow-queries?limit=5')
    const queries = expectContract(z.array(SlowQuery), res.body)

    expect(queries.length).toBeLessThanOrEqual(5)
    // Normalised statements only: pg_stat_statements stores placeholders, never parameter values.
    expect(queries.every((q) => !q.query.includes('correct horse'))).toBe(true)
  })
})
