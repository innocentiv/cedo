import { beforeEach, describe, expect, test } from 'bun:test'
import { ExerciseCreate } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupMembers } from '../../db/schema.ts'
import { type Caller, resolveCaller } from '../../plugins/auth.ts'
import { type TestApi, makeApi } from '../../test/harness.ts'
import * as ExerciseService from '../exercise/service.ts'
import { platformStatus, slowQueries } from './diagnostics.ts'

/**
 * What only a curator may do, asked of the SERVICES directly — no route, no tool in between. The
 * HTTP and MCP suites test the same refusals through their adapters, and would stay green if the
 * check moved back into those adapters, where a third surface can forget it. These would not.
 */

let h: TestApi

beforeEach(async () => {
  h = await makeApi()
})

async function callerOf(username: string, curator: boolean): Promise<Caller> {
  const user = await h.as(username)
  if (curator) {
    // Editor of the seeded shared group — there is no separate admin flag. See docs/07-mcp.md.
    await db
      .insert(groupMembers)
      .values({ groupId: h.groupId, userId: user.userId, role: 'editor' })
      .onConflictDoUpdate({
        target: [groupMembers.groupId, groupMembers.userId],
        set: { role: 'editor' },
      })
  }
  const caller = await resolveCaller(`Bearer ${user.token}`)
  if (caller === null) throw new Error(`${username} could not be resolved`)
  return caller
}

const squat = ExerciseCreate.parse({
  name: 'Curated Squat',
  muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
})

describe('a non-curator is refused, by the service itself, with a 404', () => {
  test.each([
    ['instance status', async (c: Caller) => await platformStatus(c, 'test')],
    ['the slow query log', async (c: Caller) => await slowQueries(c, 5)],
    ['a shared exercise', async (c: Caller) => await ExerciseService.createShared(c, squat)],
  ])('%s', async (_, act) => {
    const alice = await callerOf('alice', false)
    // Captured, not `expect(…).rejects`: an unawaited `rejects` can pass without ever running.
    const refused = await act(alice).then(
      () => null,
      (error: unknown) => error,
    )
    expect(refused).toMatchObject({ code: 'not_found' })
  })
})

test('a curator writes to the shared library', async () => {
  const curator = await callerOf('carol', true)
  const created = await ExerciseService.createShared(curator, squat)
  expect(created.ownerGroupId).toBe(h.groupId)
})
