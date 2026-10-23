import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ApiError, GroupMember, GroupMembership } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/**
 * Sharing training (#11): an athlete's own switch, per group, letting its editors read their
 * training. Off by default, and only in a shared group — never a personal group or the library,
 * which every account belongs to. See docs/adr/0021-coaching-through-groups.md.
 */

let h: TestApi
let coach: TestUser
let athlete: TestUser
let squad: GroupMembership

beforeEach(async () => {
  h = await makeApi()
  coach = await h.as('coach')
  athlete = await h.as('athlete')
  squad = expectContract(
    GroupMembership,
    (await coach.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Squad' }) })).body,
  )
  await addMember(coach, squad.id, athlete.username, 'reader')
})

const addMember = (by: TestUser, groupId: string, username: string, role: 'editor' | 'reader') =>
  by.wire(`/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ username, role }),
  })

const share = (user: TestUser, groupId: string, sharesTraining: boolean) =>
  user.wire(`/groups/${groupId}/membership`, {
    method: 'PATCH',
    body: JSON.stringify({ sharesTraining }),
  })

const membershipOf = async (user: TestUser, groupId: string) =>
  expectContract(z.array(GroupMembership), (await user.wire('/groups')).body).find(
    (g) => g.id === groupId,
  )

/** Who, of the members `user` can list, reads their training through `groupId`. */
const readers = async (user: TestUser, groupId: string) =>
  expectContract(z.array(GroupMember), (await user.wire(`/groups/${groupId}/members`)).body)
    .filter((m) => m.readsYourTraining)
    .map((m) => m.user.username)

describe('sharing training with a group', () => {
  test('is off until the athlete switches it on, and offered only in a shared group', async () => {
    expect(await membershipOf(athlete, squad.id)).toMatchObject({
      sharesTraining: false,
      canShareTraining: true,
    })
    expect(await membershipOf(athlete, athlete.personalGroupId)).toMatchObject({
      sharesTraining: false,
      canShareTraining: false,
    })
    expect(await membershipOf(athlete, h.groupId)).toMatchObject({
      sharesTraining: false,
      canShareTraining: false,
    })
  })

  test('the athlete switches it on, and off again', async () => {
    const on = await share(athlete, squad.id, true)
    expect(on.status).toBe(200)
    expect(expectContract(GroupMembership, on.body)).toMatchObject({
      id: squad.id,
      role: 'reader',
      sharesTraining: true,
    })
    expect((await membershipOf(athlete, squad.id))?.sharesTraining).toBe(true)

    await share(athlete, squad.id, false)
    expect((await membershipOf(athlete, squad.id))?.sharesTraining).toBe(false)
  })

  test("is the athlete's own: switching it on shares nobody else's training", async () => {
    await share(coach, squad.id, true)
    expect((await membershipOf(coach, squad.id))?.sharesTraining).toBe(true)
    expect((await membershipOf(athlete, squad.id))?.sharesTraining).toBe(false)
  })

  test('is refused in a personal group and in the library, saying why', async () => {
    for (const groupId of [athlete.personalGroupId, h.groupId]) {
      const refused = await share(athlete, groupId, true)
      expect(refused.status).toBe(409)
      expect(expectContract(ApiError, refused.body).error.message).toMatch(
        /personal group|library/u,
      )
    }
  })

  test('is a 404 in a group the caller is not in', async () => {
    const stranger = await h.as('stranger')
    expect((await share(stranger, squad.id, true)).status).toBe(404)
  })

  test('is gone with the membership: leaving and rejoining starts unshared', async () => {
    await share(athlete, squad.id, true)
    await athlete.wire(`/groups/${squad.id}/members/${athlete.userId}`, { method: 'DELETE' })
    await addMember(coach, squad.id, athlete.username, 'reader')
    expect((await membershipOf(athlete, squad.id))?.sharesTraining).toBe(false)
  })
})

describe('who reads your training', () => {
  test("the group's editors, once you share — never yourself, nor another reader", async () => {
    const assistant = await h.as('assistant')
    const teammate = await h.as('teammate')
    await addMember(coach, squad.id, assistant.username, 'editor')
    await addMember(coach, squad.id, teammate.username, 'reader')

    expect(await readers(athlete, squad.id)).toEqual([])
    await share(athlete, squad.id, true)
    expect((await readers(athlete, squad.id)).toSorted()).toEqual(['assistant', 'coach'])
  })

  test('an editor who shares is read by the other editors — where everyone edits, everyone', async () => {
    const friend = await h.as('friend')
    await addMember(coach, squad.id, friend.username, 'editor')
    await share(coach, squad.id, true)
    expect(await readers(coach, squad.id)).toEqual(['friend'])
  })
})
