import { beforeEach, describe, expect, test } from 'bun:test'
import { ApiError, AuthResult, Me } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { TEST_PASSWORD, type TestApi, makeApi } from '../../test/harness.ts'

/**
 * Convention in this suite: drive the API with `wire` when asserting status codes or contract
 * shapes, because it returns exactly what a fetch client receives. `api` (Eden Treaty) is for
 * ergonomic typed calls, but it revives ISO dates into `Date` objects, which the real client does
 * not. See the note on `Wire` in test/harness.ts.
 */

let h: TestApi
beforeEach(async () => {
  h = await makeApi()
})

const register = (username: string, password = TEST_PASSWORD, displayName = username) =>
  h.wire('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, displayName }),
  })

describe('registration', () => {
  test('creates the user, a personal group, and membership of the shared library', async () => {
    const res = await register('alice', TEST_PASSWORD, 'Alice')
    expect(res.status).toBe(200)
    const result = expectContract(AuthResult, res.body)
    expect(result.user.username).toBe('alice')

    const meRes = await h.wire('/auth/me', { headers: { authorization: `Bearer ${result.token}` } })
    const me = expectContract(Me, meRes.body)
    expect(me.groups.map((g) => g.kind).toSorted()).toEqual(['personal', 'shared'])
    expect(me.groups.find((g) => g.kind === 'personal')?.role).toBe('editor')
    expect(me.groups.find((g) => g.kind === 'shared')?.role).toBe('reader')
  })

  test('usernames are case-insensitive, because the contract lowercases them', async () => {
    await register('alice')
    const res = await register('ALICE', TEST_PASSWORD, 'Impostor')
    expect(res.status).toBe(409)
    expectContract(ApiError, res.body)
  })

  test('rejects a duplicate username with a conflict, not a 500', async () => {
    await register('alice')
    expect((await register('alice')).status).toBe(409)
  })

  test('rejects a short password before it reaches the database', async () => {
    expect((await register('bob', 'short')).status).toBe(422)
  })

  test('rejects unknown fields, so a mistaken client cannot silently drop data', async () => {
    const res = await h.wire('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'bob',
        password: TEST_PASSWORD,
        displayName: 'Bob',
        isAdmin: true,
      }),
    })
    expect(res.status).toBe(422)
  })

  test('a validation failure names the offending field', async () => {
    const res = await register('b', TEST_PASSWORD)
    const err = expectContract(ApiError, res.body)
    expect(err.error.code).toBe('validation_failed')
    expect(err.error.details?.some((d) => d.path.includes('username'))).toBe(true)
  })
})

describe('login', () => {
  const login = (username: string, password: string) =>
    h.wire('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })

  test('returns a working token', async () => {
    await register('alice')
    const res = await login('alice', TEST_PASSWORD)
    const result = expectContract(AuthResult, res.body)
    expect(result.token.length).toBeGreaterThan(20)
    expect(
      (await h.wire('/auth/me', { headers: { authorization: `Bearer ${result.token}` } })).status,
    ).toBe(200)
  })

  test('rejects a wrong password', async () => {
    await register('alice')
    expect((await login('alice', 'wrong password')).status).toBe(401)
  })

  /** Otherwise the response reveals which usernames exist. */
  test('gives an unknown user exactly the same answer as a wrong password', async () => {
    await register('alice')
    const unknown = await login('nobody', TEST_PASSWORD)
    const wrong = await login('alice', 'wrong password')
    expect(unknown.status).toBe(wrong.status)
    expect(unknown.body).toEqual(wrong.body)
  })

  test('issues a distinct token per login, so revoking one leaves the others working', async () => {
    await register('alice')
    const a = expectContract(AuthResult, (await login('alice', TEST_PASSWORD)).body)
    const b = expectContract(AuthResult, (await login('alice', TEST_PASSWORD)).body)
    expect(a.token).not.toBe(b.token)

    await h.wire('/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}` },
    })
    expect(
      (await h.wire('/auth/me', { headers: { authorization: `Bearer ${a.token}` } })).status,
    ).toBe(401)
    expect(
      (await h.wire('/auth/me', { headers: { authorization: `Bearer ${b.token}` } })).status,
    ).toBe(200)
  })
})

describe('authentication', () => {
  test('an authenticated route rejects a missing token', async () => {
    expect((await h.wire('/auth/me')).status).toBe(401)
  })

  test.each(['', 'Bearer', 'Basic abc', 'bearer', 'Token abc', 'Bearer '])(
    'rejects the malformed authorization header %p',
    async (authorization) => {
      expect((await h.wire('/auth/me', { headers: { authorization } })).status).toBe(401)
    },
  )

  test('rejects a well-formed but unknown token', async () => {
    const res = await h.wire('/auth/me', { headers: { authorization: `Bearer ${'a'.repeat(43)}` } })
    expect(res.status).toBe(401)
  })
})

describe('error envelope', () => {
  test('every failure matches the published ApiError shape', async () => {
    const cases = [
      await h.wire('/auth/me'),
      await h.wire('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'nobody', password: TEST_PASSWORD }),
      }),
      await register('x', 'y', ''),
      await h.wire('/no-such-route'),
    ]
    for (const c of cases) {
      expect(c.status).toBeGreaterThanOrEqual(400)
      expectContract(ApiError, c.body)
    }
  })

  /**
   * Elysia's ValidationError carries the submitted input on every issue. Echoing it back would put
   * plaintext passwords in API responses and in whatever logs them.
   */
  test('a validation failure never echoes the submitted password back', async () => {
    const secret = 'a-very-distinctive-password-value'
    const res = await h.wire('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'a', password: secret, displayName: '' }),
    })
    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body)).not.toContain(secret)
  })

  test('login validation failures do not echo the password either', async () => {
    const secret = 'another-distinctive-secret'
    const res = await h.wire('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: '', password: secret }),
    })
    expect(JSON.stringify(res.body)).not.toContain(secret)
  })

  test('an unknown route is a contract-shaped 404, not an Elysia default', async () => {
    const res = await h.wire('/no-such-route')
    expect(res.status).toBe(404)
    expect(expectContract(ApiError, res.body).error.code).toBe('not_found')
  })
})
