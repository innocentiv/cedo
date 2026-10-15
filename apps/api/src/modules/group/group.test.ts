import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ApiError, GroupMember, GroupMembership } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

const createGroup = (user: TestUser, name: string) =>
  user.wire('/groups', { method: 'POST', body: JSON.stringify({ name }) })

describe('listing', () => {
  test('a new user sees their personal group and the shared library, nothing else', async () => {
    const res = await alice.wire('/groups')
    const groups = expectContract(z.array(GroupMembership), res.body)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.kind).toSorted()).toEqual(['personal', 'shared'])
  })

  test("a group one user creates does not appear in another user's list", async () => {
    await createGroup(alice, 'Alice and friends')

    const forAlice = expectContract(z.array(GroupMembership), (await alice.wire('/groups')).body)
    const forBob = expectContract(z.array(GroupMembership), (await bob.wire('/groups')).body)

    expect(forAlice.map((g) => g.name)).toContain('Alice and friends')
    expect(forBob.map((g) => g.name)).not.toContain('Alice and friends')
  })

  test('member counts are reported', async () => {
    const created = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    expect(created.memberCount).toBe(1)

    await alice.wire(`/groups/${created.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'reader' }),
    })

    const groups = expectContract(z.array(GroupMembership), (await alice.wire('/groups')).body)
    expect(groups.find((g) => g.id === created.id)?.memberCount).toBe(2)
  })
})

describe('creation', () => {
  test('the creator becomes an editor, or they could not put anything in it', async () => {
    const created = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    expect(created.role).toBe('editor')
    expect(created.kind).toBe('shared')
  })

  test('slugs are unique even when names collide', async () => {
    const a = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    const b = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    expect(a.slug).not.toBe(b.slug)
  })
})

/**
 * The ACL invariant, proven per module. Not-permitted and not-found must be indistinguishable, or
 * a stranger can probe for the existence of other people's resources.
 * See docs/02-conventions.md.
 */
describe('access control', () => {
  test('a non-member cannot read the membership list, and gets 404 not 403', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    const res = await bob.wire(`/groups/${squad.id}/members`)
    expect(res.status).toBe(404)
    expectContract(ApiError, res.body)
  })

  test('a non-member cannot add members', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    const res = await bob.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'editor' }),
    })
    expect(res.status).toBe(404)
  })

  test('a reader cannot add members', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    await alice.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'reader' }),
    })

    const carol = await h.as('carol')
    const res = await bob.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: carol.username, role: 'reader' }),
    })
    expect(res.status).toBe(404)
  })

  test('a reader CAN read the membership list', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    await alice.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'reader' }),
    })
    const res = await bob.wire(`/groups/${squad.id}/members`)
    expect(res.status).toBe(200)
    expect(expectContract(z.array(GroupMember), res.body)).toHaveLength(2)
  })

  /**
   * A reader sees who RUNS the group, and themselves — not the other readers. Every account is a
   * reader of the starter library, so "any member sees every member" let any user list every
   * account on the instance through it.
   */
  test('a reader sees the editors and themselves, never the other readers', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    const carol = await h.as('carol')
    for (const username of ['bob', 'carol']) {
      await alice.wire(`/groups/${squad.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ username, role: 'reader' }),
      })
    }

    const asBob = expectContract(
      z.array(GroupMember),
      (await bob.wire(`/groups/${squad.id}/members`)).body,
    )
    expect(asBob.map((m) => m.user.username).toSorted()).toEqual(['alice', 'bob'])

    // An editor still sees everyone.
    const asAlice = expectContract(
      z.array(GroupMember),
      (await alice.wire(`/groups/${squad.id}/members`)).body,
    )
    expect(asAlice).toHaveLength(3)
    expect(carol.userId).toBeString()
  })

  test('nobody can list the accounts on the instance through the starter library', async () => {
    const library = expectContract(z.array(GroupMembership), (await bob.wire('/groups')).body).find(
      (g) => g.id === h.groupId,
    )
    expect(library?.role).toBe('reader')

    const listed = expectContract(
      z.array(GroupMember),
      (await bob.wire(`/groups/${h.groupId}/members`)).body,
    )
    expect(listed.map((m) => m.user.username)).not.toContain('alice')

    // Nor how many there are: the count matches the list the reader may see.
    expect(library?.memberCount).toBe(listed.length)
  })

  test('a nonexistent group is indistinguishable from one you cannot see', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    const hidden = await bob.wire(`/groups/${squad.id}/members`)
    const missing = await bob.wire(`/groups/${crypto.randomUUID()}/members`)
    expect(hidden.status).toBe(missing.status)
    expect(hidden.body).toEqual(missing.body)
  })

  test('every group route requires authentication', async () => {
    for (const path of ['/groups', `/groups/${crypto.randomUUID()}/members`]) {
      expect((await h.wire(path)).status).toBe(401)
    }
  })
})

describe('membership', () => {
  test('adding an unknown user is a 404', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    const res = await alice.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'nobody', role: 'reader' }),
    })
    expect(res.status).toBe(404)
  })

  test('adding the same member twice is a conflict', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    const add = () =>
      alice.wire(`/groups/${squad.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ username: 'bob', role: 'reader' }),
      })
    expect((await add()).status).toBe(200)
    expect((await add()).status).toBe(409)
  })

  /** Two editors adding the same person at once: one wins, the other is told — never a 500. */
  test('adding the same member twice AT ONCE is still one success and one conflict', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    const add = () =>
      alice.wire(`/groups/${squad.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ username: 'bob', role: 'reader' }),
      })
    for (let round = 0; round < 5; round += 1) {
      await alice.wire(`/groups/${squad.id}/members/${bob.userId}`, { method: 'DELETE' })
      const statuses = (await Promise.all([add(), add()]))
        .map((r) => r.status)
        .toSorted((a, b) => a - b)
      expect(statuses).toEqual([200, 409])
    }
  })

  test('a personal group cannot take members', async () => {
    const res = await alice.wire(`/groups/${alice.personalGroupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'reader' }),
    })
    expect(res.status).toBe(409)
  })

  /** A group with no editor is unusable and unrecoverable through the API. */
  test('the last editor cannot be removed', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    const res = await alice.wire(`/groups/${squad.id}/members/${alice.userId}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(409)
  })

  test('an editor can be removed once another editor exists', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    await alice.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'editor' }),
    })
    const res = await alice.wire(`/groups/${squad.id}/members/${alice.userId}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
  })

  /**
   * Regression: the editor count and the delete used to be separate statements, so two editors
   * removing each other simultaneously both saw two editors, both passed the check, and both
   * committed — stranding the group with no editor and no API path back.
   *
   * Measured against the unfixed code, a single round strands the group ~13 times in 15, so one
   * round would false-pass roughly one run in seven. Five rounds makes that vanishingly unlikely
   * while staying fast.
   */
  test('two editors removing each other concurrently cannot strand the group', async () => {
    for (let round = 0; round < 5; round++) {
      const squad = expectContract(
        GroupMembership,
        (await createGroup(alice, `Squad ${round}`)).body,
      )
      await alice.wire(`/groups/${squad.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ username: 'bob', role: 'editor' }),
      })

      await Promise.all([
        alice.wire(`/groups/${squad.id}/members/${bob.userId}`, { method: 'DELETE' }),
        bob.wire(`/groups/${squad.id}/members/${alice.userId}`, { method: 'DELETE' }),
      ])

      // Whoever survived must still be able to administer the group.
      const seen = await Promise.all([
        alice.wire(`/groups/${squad.id}/members`),
        bob.wire(`/groups/${squad.id}/members`),
      ])
      const visible = seen.filter((r) => r.status === 200)
      expect(visible.length).toBeGreaterThanOrEqual(1)

      const members = expectContract(z.array(GroupMember), visible[0]?.body)
      expect(members.filter((m) => m.role === 'editor').length).toBeGreaterThanOrEqual(1)
    }
  })

  test('removing a member revokes their access immediately', async () => {
    const squad = expectContract(GroupMembership, (await createGroup(alice, 'Squad')).body)
    await alice.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', role: 'reader' }),
    })
    expect((await bob.wire(`/groups/${squad.id}/members`)).status).toBe(200)

    await alice.wire(`/groups/${squad.id}/members/${bob.userId}`, { method: 'DELETE' })
    expect((await bob.wire(`/groups/${squad.id}/members`)).status).toBe(404)
  })
})
