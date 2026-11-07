import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq, sql } from 'drizzle-orm'
import { ApiError, PlatformStatus } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { loginFailures } from '../../db/schema.ts'
import { expectContract } from '../../test/contract.ts'
import { TEST_PASSWORD, type TestApi, makeApi } from '../../test/harness.ts'
import { PER_ADDRESS, PER_ADDRESS_AND_USERNAME, WINDOW_S } from './login-limit.ts'

/** The login limit (#72, ADR-0031), through the route, with the address as Caddy passes it on. */

let h: TestApi
beforeEach(async () => {
  h = await makeApi()
})

const HERE = '203.0.113.7'
const ELSEWHERE = '198.51.100.20'

const login = async (username: string, password: string, forwardedFor = HERE) =>
  await h.wire('/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({ username, password }),
  })

const fail = async (username: string, times: number, forwardedFor = HERE) => {
  for (let i = 0; i < times; i++)
    expect((await login(username, 'wrong', forwardedFor)).status).toBe(401)
}

/** Failures written straight in: fifty real logins would spend fifty argon2 verifications. */
const failed = async (rows: { username: string; address?: string; secondsAgo?: number }[]) =>
  await db.insert(loginFailures).values(
    rows.map(({ username, address = HERE, secondsAgo = 0 }) => ({
      username,
      address,
      at: sql`now() - make_interval(secs => ${secondsAgo})`,
    })),
  )

const refused = (res: Awaited<ReturnType<typeof login>>) => {
  expect(res.status).toBe(429)
  expect(expectContract(ApiError, res.body).error.code).toBe('rate_limited')
}

describe('per address and username', () => {
  test('ten wrong passwords lock that username out from there, the right password included', async () => {
    await h.as('alice')
    await fail('alice', PER_ADDRESS_AND_USERNAME)
    refused(await login('alice', TEST_PASSWORD))
  })

  test('an account that does not exist counts the same, so the limit says nothing of who exists', async () => {
    await fail('ghost', PER_ADDRESS_AND_USERNAME)
    refused(await login('ghost', 'anything'))
  })

  test('another username from there, and the same one from elsewhere, still sign in', async () => {
    await h.as('alice')
    await h.as('bob')
    await fail('alice', PER_ADDRESS_AND_USERNAME)
    expect((await login('bob', TEST_PASSWORD)).status).toBe(200)
    expect((await login('alice', TEST_PASSWORD, ELSEWHERE)).status).toBe(200)
  })

  test('a success forgives its own address and username', async () => {
    await h.as('alice')
    await fail('alice', PER_ADDRESS_AND_USERNAME - 1)
    expect((await login('alice', TEST_PASSWORD)).status).toBe(200)
    const left = await db
      .select()
      .from(loginFailures)
      .where(and(eq(loginFailures.address, HERE), eq(loginFailures.username, 'alice')))
    expect(left).toHaveLength(0)
  })
})

describe('per address', () => {
  test('fifty failures across usernames lock every username out from there, and only there', async () => {
    await h.as('alice')
    await failed(Array.from({ length: PER_ADDRESS }, (_, i) => ({ username: `guess${i}` })))
    refused(await login('alice', TEST_PASSWORD))
    expect((await login('alice', TEST_PASSWORD, ELSEWHERE)).status).toBe(200)
  })
})

describe('the window', () => {
  test('failures older than it no longer count', async () => {
    await h.as('alice')
    const secondsAgo = WINDOW_S + 60
    await failed(
      Array.from({ length: PER_ADDRESS_AND_USERNAME }, () => ({ username: 'alice', secondsAgo })),
    )
    expect((await login('alice', TEST_PASSWORD)).status).toBe(200)
  })

  test('Retry-After is when enough of them age out: here, the oldest, a minute from now', async () => {
    await failed(
      Array.from({ length: PER_ADDRESS_AND_USERNAME }, (_, i) => ({
        username: 'alice',
        // The oldest a minute short of the window; the rest a second apart after it.
        secondsAgo: WINDOW_S - 60 - i,
      })),
    )
    const res = await h.api.auth.login.post(
      { username: 'alice', password: TEST_PASSWORD },
      { headers: { 'x-forwarded-for': HERE } },
    )
    expect(res.status).toBe(429)
    const retryAfter = Number(res.response.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThanOrEqual(55)
    expect(retryAfter).toBeLessThanOrEqual(61)
  })

  test('a new failure first prunes those that no longer count', async () => {
    await failed([{ username: 'alice', secondsAgo: WINDOW_S + 60 }])
    await fail('alice', 1)
    expect(await db.select().from(loginFailures)).toHaveLength(1)
  })
})

describe('the address counted', () => {
  test("is the client's from X-Forwarded-For, never one the client wrote ahead of it", async () => {
    await h.as('alice')
    const spoofed = (n: number) => `10.0.0.${n}, 192.0.2.${n}, ${HERE}, 172.18.0.1`
    for (let n = 1; n <= PER_ADDRESS_AND_USERNAME; n++) {
      expect((await login('alice', 'wrong', spoofed(n))).status).toBe(401)
    }
    refused(await login('alice', TEST_PASSWORD, `${HERE}, 172.18.0.1`))
  })

  test("is shown to the curator, so a proxy's own address is noticed", async () => {
    const carol = await h.as('carol')
    await h.curator(carol)
    await login('carol', TEST_PASSWORD, `${ELSEWHERE}, 172.18.0.1`)
    const status = expectContract(PlatformStatus, (await carol.wire('/admin/status')).body)
    expect(status.lastLoginAddress).toBe(ELSEWHERE)
  })
})
