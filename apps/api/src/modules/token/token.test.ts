import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { PersonalAccessToken, PersonalAccessTokenCreated } from '@cedo/contract'
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

const mint = (user: TestUser, name: string, expiresInDays: number | null = null) =>
  user.wire('/tokens', { method: 'POST', body: JSON.stringify({ name, expiresInDays }) })

describe('personal access tokens', () => {
  test('creation returns the secret exactly once', async () => {
    const created = expectContract(PersonalAccessTokenCreated, (await mint(alice, 'claude')).body)
    expect(created.token.length).toBeGreaterThan(20)

    const listed = expectContract(z.array(PersonalAccessToken), (await alice.wire('/tokens')).body)
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(created.token)
  })

  test('the listing never contains a secret in any field', async () => {
    const created = expectContract(PersonalAccessTokenCreated, (await mint(alice, 'claude')).body)
    const raw = JSON.stringify((await alice.wire('/tokens')).body)
    expect(raw).not.toContain(created.token)
    expect(raw).not.toContain('tokenHash')
  })

  test('each token is distinct', async () => {
    const a = expectContract(PersonalAccessTokenCreated, (await mint(alice, 'one')).body)
    const b = expectContract(PersonalAccessTokenCreated, (await mint(alice, 'two')).body)
    expect(a.token).not.toBe(b.token)
  })

  test('expiry is stored when requested and null when not', async () => {
    const never = expectContract(PersonalAccessTokenCreated, (await mint(alice, 'forever')).body)
    expect(never.expiresAt).toBeNull()

    const soon = expectContract(PersonalAccessTokenCreated, (await mint(alice, 'temp', 30)).body)
    expect(soon.expiresAt).not.toBeNull()
  })

  test('rejects a nonsensical expiry rather than storing it', async () => {
    expect((await mint(alice, 'bad', 0)).status).toBe(422)
    expect((await mint(alice, 'bad', -5)).status).toBe(422)
  })
})

describe('access control', () => {
  test("a user cannot see another user's tokens", async () => {
    await mint(alice, 'alice-token')
    const bobs = expectContract(z.array(PersonalAccessToken), (await bob.wire('/tokens')).body)
    expect(bobs).toHaveLength(0)
  })

  test("a user cannot revoke another user's token, and gets 404 not 403", async () => {
    const created = expectContract(
      PersonalAccessTokenCreated,
      (await mint(alice, 'alice-token')).body,
    )
    const res = await bob.wire(`/tokens/${created.id}`, { method: 'DELETE' })
    expect(res.status).toBe(404)

    // Still there for its owner.
    const listed = expectContract(z.array(PersonalAccessToken), (await alice.wire('/tokens')).body)
    expect(listed).toHaveLength(1)
  })

  test("revoking someone else's token is indistinguishable from revoking a nonexistent one", async () => {
    const created = expectContract(
      PersonalAccessTokenCreated,
      (await mint(alice, 'alice-token')).body,
    )
    const other = await bob.wire(`/tokens/${created.id}`, { method: 'DELETE' })
    const missing = await bob.wire(`/tokens/${crypto.randomUUID()}`, { method: 'DELETE' })
    expect(other.status).toBe(missing.status)
    expect(other.body).toEqual(missing.body)
  })

  test('the owner can revoke their own token', async () => {
    const created = expectContract(
      PersonalAccessTokenCreated,
      (await mint(alice, 'alice-token')).body,
    )
    expect((await alice.wire(`/tokens/${created.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(
      expectContract(z.array(PersonalAccessToken), (await alice.wire('/tokens')).body),
    ).toHaveLength(0)
  })

  test('every token route requires authentication', async () => {
    expect((await h.wire('/tokens')).status).toBe(401)
    expect(
      (await h.wire('/tokens', { method: 'POST', body: JSON.stringify({ name: 'x' }) })).status,
    ).toBe(401)
  })

  /** A PAT authenticates MCP, not the HTTP API — those are separate credentials. */
  test('a personal access token is not accepted as a session token', async () => {
    const created = expectContract(PersonalAccessTokenCreated, (await mint(alice, 'claude')).body)
    const res = await h.wire('/auth/me', { headers: { authorization: `Bearer ${created.token}` } })
    expect(res.status).toBe(401)
  })
})
