import { GroupMembership } from '@cedo/contract'
import { expectContract } from './contract.ts'
import type { TestApi, TestUser, WireResponse } from './harness.ts'

/**
 * A coach and an athlete who shares their training with them (ADR-0021), set up over HTTP as the
 * app does — for the tests of what a coach reads and writes.
 */

/** A request as `user`, its body JSON when given. */
export const send = async (
  user: TestUser,
  path: string,
  body?: unknown,
  method = 'POST',
): Promise<WireResponse> =>
  await user.wire(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

/** `send`, which must succeed: its body. */
export const ok = async (user: TestUser, path: string, body?: unknown, method = 'POST') => {
  const res = await send(user, path, body, method)
  if (res.status >= 300) throw new Error(`${method} ${path}: ${String(res.status)}`)
  return res.body
}

/** Their training shared with the group, or no longer. */
export const share = async (user: TestUser, groupId: string, sharesTraining: boolean) =>
  await ok(user, `/groups/${groupId}/membership`, { sharesTraining }, 'PATCH')

/** `coach` edits Squad, whose reader `athlete` shares their training with it. */
export async function coachedSquad(h: TestApi) {
  const coach = await h.as('coach')
  const athlete = await h.as('athlete')
  const squadId = expectContract(GroupMembership, await ok(coach, '/groups', { name: 'Squad' })).id
  await ok(coach, `/groups/${squadId}/members`, { username: athlete.username, role: 'reader' })
  await share(athlete, squadId, true)
  return { coach, athlete, squadId }
}

/** Another member of Squad who shares too: an athlete the coach has besides. */
export async function anotherAthlete(h: TestApi, coach: TestUser, squadId: string) {
  const other = await h.as('other')
  await ok(coach, `/groups/${squadId}/members`, { username: other.username, role: 'reader' })
  await share(other, squadId, true)
  return other
}
