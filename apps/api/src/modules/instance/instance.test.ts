import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq, sql } from 'drizzle-orm'
import { ApiError, AuthResult, Instance, Me } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupMembers, instanceSettings, users } from '../../db/schema.ts'
import { expectContract } from '../../test/contract.ts'
import { TEST_PASSWORD, type TestApi, makeApi } from '../../test/harness.ts'
import { callTool, mintPat, textOf } from '../../test/mcp-wire.ts'
import { VERSION } from '../../version.ts'
import * as AuthService from '../auth/service.ts'

/** Sign-up as an instance setting, and a fresh instance's first account as its curator (#71). */

let h: TestApi
beforeEach(async () => {
  h = await makeApi()
})

const register = async (username: string) =>
  await h.wire('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: TEST_PASSWORD, displayName: username }),
  })

const instance = async () => expectContract(Instance, (await h.wire('/instance')).body)

const patch = async (wire: TestApi['wire'], signUp: string) =>
  await wire('/instance', { method: 'PATCH', body: JSON.stringify({ signUp }) })

/** Editors of the shared library, other than the system user that seeds it. */
const curators = async () =>
  await db
    .select({ username: users.username })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, h.groupId), eq(groupMembers.role, 'editor')))
    .then((rows) => rows.map((r) => r.username).filter((name) => name !== 'cedo'))

describe('GET /instance', () => {
  test('says, to anyone, that it is cedo, its version, and whether it takes accounts', async () => {
    expect(await instance()).toEqual({ product: 'cedo', version: VERSION, signUp: 'open' })
  })

  test("a fresh instance takes its first account, so it reads open; a curator's close, closed", async () => {
    await h.signUp('first')
    expect((await instance()).signUp).toBe('open')
    await h.signUp('closed')
    expect((await instance()).signUp).toBe('closed')
  })

  test('an instance that cannot say whether it takes accounts does not', async () => {
    await db.delete(instanceSettings)
    expect((await instance()).signUp).toBe('closed')
    expect((await register('mallory')).status).toBe(403)
  })
})

describe('registration while sign-up is closed', () => {
  test('is refused with sign_up_closed, and writes nothing', async () => {
    await h.signUp('closed')
    const res = await register('mallory')
    expect(res.status).toBe(403)
    expect(expectContract(ApiError, res.body).error.code).toBe('sign_up_closed')

    await h.signUp('open')
    expect((await register('mallory')).status).toBe(200)
  })
})

describe("a fresh instance's first account", () => {
  test('curates it, and sign-up closes behind them', async () => {
    await h.signUp('first')
    const res = await register('ada')
    expect(res.status).toBe(200)
    expect(await curators()).toEqual(['ada'])
    expect((await instance()).signUp).toBe('closed')
    expect((await register('bob')).status).toBe(403)
  })

  test('is told so by /auth/me', async () => {
    await h.signUp('first')
    const { token } = expectContract(AuthResult, (await register('ada')).body)
    const me = await h.wire('/auth/me', { headers: { authorization: `Bearer ${token}` } })
    expect(expectContract(Me, me.body).curator).toBe(true)
  })

  /**
   * Registrations at once on a fresh instance take turns at its row: without the lock each reads
   * `first`, and every one of them becomes a curator. Driven through the service, with the pool
   * warmed, so they truly overlap (CLAUDE.md, working notes).
   */
  test('is exactly one, however many register at once', async () => {
    await h.signUp('first')
    await Promise.all(Array.from({ length: 30 }, async () => await db.execute(sql`select 1`)))
    const tries = await Promise.allSettled(
      Array.from(
        { length: 30 },
        async (_, i) =>
          await AuthService.register({
            username: `racer${i}`,
            password: TEST_PASSWORD,
            displayName: `Racer ${i}`,
          }),
      ),
    )
    expect(tries.filter((t) => t.status === 'fulfilled')).toHaveLength(1)
    expect(await curators()).toHaveLength(1)
  })

  test('is not a later account on an instance already in use, curator or not', async () => {
    await register('alice')
    expect(await curators()).toEqual([])
  })
})

describe('Me.curator', () => {
  test('is false for a reader of the library, true for its editor', async () => {
    const alice = await h.as('alice')
    const me = async () => expectContract(Me, (await alice.wire('/auth/me')).body).curator
    expect(await me()).toBe(false)
    await h.curator(alice)
    expect(await me()).toBe(true)
  })
})

describe('PATCH /instance', () => {
  test('the curator opens and closes sign-up', async () => {
    const carol = await h.as('carol')
    await h.curator(carol)

    const closed = await patch(carol.wire, 'closed')
    expect(closed.status).toBe(200)
    expect(expectContract(Instance, closed.body).signUp).toBe('closed')
    expect((await register('dave')).status).toBe(403)

    expect(expectContract(Instance, (await patch(carol.wire, 'open')).body).signUp).toBe('open')
    expect((await register('dave')).status).toBe(200)
  })

  test('anyone else is told there is nothing there, and nothing changes', async () => {
    const alice = await h.as('alice')
    const res = await patch(alice.wire, 'closed')
    expect(res.status).toBe(404)
    expect((await instance()).signUp).toBe('open')
    expect((await patch(h.wire, 'closed')).status).toBe(401)
  })

  test('takes only open or closed: first is how an instance starts, never a choice', async () => {
    const carol = await h.as('carol')
    await h.curator(carol)
    expect((await patch(carol.wire, 'first')).status).toBe(422)
  })
})

describe('instance_sign_up_set', () => {
  test("the curator's AI opens and closes sign-up through the same rule", async () => {
    const carol = await h.as('carol')
    await h.curator(carol)
    const pat = await mintPat(carol)

    const { body } = await callTool(pat, 'instance_sign_up_set', { signUp: 'closed' })
    expect(body.result?.isError).toBeFalsy()
    expect(textOf(body)).toContain('Sign-up is closed')
    expect((await instance()).signUp).toBe('closed')
  })

  test('refuses anyone else, and changes nothing', async () => {
    const alice = await h.as('alice')
    const pat = await mintPat(alice)
    const { body } = await callTool(pat, 'instance_sign_up_set', { signUp: 'closed' })
    expect(body.result?.isError).toBe(true)
    expect(textOf(body)).toContain('curator access')
    expect((await instance()).signUp).toBe('open')
  })
})

/**
 * The migration starts the row from what the instance already is (0021). Its statement, read from
 * the file, run against each case: what the live instance gets on deploy.
 */
describe('migration 0021 starts sign-up from the instance as it is', () => {
  const statement = async () => {
    const file = await Bun.file(
      new URL('../../../drizzle/0021_instance_sign_up.sql', import.meta.url),
    ).text()
    const insert = file.split('--> statement-breakpoint').at(-1)
    if (insert === undefined) throw new Error('0021 has no INSERT')
    return insert
  }
  const startedAs = async () => {
    await db.delete(instanceSettings)
    await db.execute(sql.raw(await statement()))
    const [row] = await db.select({ signUp: instanceSettings.signUp }).from(instanceSettings)
    return row?.signUp
  }

  test('with no account but the system user: first', async () => {
    expect(await startedAs()).toBe('first')
  })

  test('with accounts and no curator: open, as it was, since nobody could reopen it', async () => {
    await h.as('alice')
    expect(await startedAs()).toBe('open')
  })

  test('with a curator: closed, since they can reopen it', async () => {
    await h.curator(await h.as('alice'))
    expect(await startedAs()).toBe('closed')
  })
})
