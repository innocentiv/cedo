import { describe, expect, spyOn, test } from 'bun:test'
import type { Me } from '@cedo/contract'
import { ApiError, NetworkError } from '../api/errors.ts'
import { type SessionAuth, type TokenStore, createSession } from './session.ts'

/**
 * Who is signed in, without React and without a network: a fake keychain and a fake API. These are
 * the rules that lived in effects and two module-level variables, two of them fixed in c97961b with
 * no test — "not reproducible in the web harness without test hooks in production code".
 */

const me = (username: string): Me => ({
  user: {
    id: crypto.randomUUID(),
    username,
    displayName: username,
    createdAt: new Date().toISOString(),
    weightUnit: 'kg',
    birthYear: null,
  },
  groups: [],
})

const rejected = () => new ApiError(401, 'unauthenticated', 'Authentication required', null)

/** A keychain holding `token`, recording what is written to it. */
function aStore(token: string | null = null): TokenStore & { held: () => string | null } {
  let held = token
  return {
    held: () => held,
    read: async () => held,
    write: async (next) => {
      held = next
    },
    clear: async () => {
      held = null
    },
  }
}

/**
 * An API that knows `who` by their token — and, refusing one, reports it as the transport does:
 * `rejected(token)` first, then the error.
 */
function anAuth(
  who: Record<string, Me>,
  token: () => string | null,
  onRejected: (sent: string) => Promise<void>,
): SessionAuth {
  const known = async (): Promise<Me> => {
    const sent = token()
    const found = who[sent ?? '']
    if (found !== undefined) return found
    if (sent !== null) await onRejected(sent)
    throw rejected()
  }
  return {
    me: known,
    logout: async () => null,
    updateMe: async ({ weightUnit, birthYear }) => {
      const { user, ...found } = await known()
      return {
        ...found,
        user: {
          ...user,
          weightUnit: weightUnit ?? user.weightUnit,
          birthYear: birthYear === undefined ? user.birthYear : birthYear,
        },
      }
    },
  }
}

function aSession(store: TokenStore, who: Record<string, Me> = {}) {
  const session = createSession({
    store,
    auth: () => anAuth(who, session.token, session.rejected),
  })
  return session
}

/** A promise settled from outside: an answer still in flight until the test says otherwise. */
function inFlight<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle: (value: T) => void = () => null
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/** Runs `run`, and returns what it said on the console — the spy restored however it ends. */
async function errorsDuring(run: () => Promise<void>): Promise<unknown[][]> {
  const errors = spyOn(console, 'error').mockImplementation(() => null)
  try {
    await run()
    return [...errors.mock.calls]
  } finally {
    errors.mockRestore()
  }
}

describe('restoring a session at startup', () => {
  test('with nothing stored, signed out', async () => {
    const session = aSession(aStore())
    expect(session.snapshot().status).toBe('loading')
    await session.restore()
    expect(session.snapshot()).toEqual({ status: 'signed-out', me: null })
  })

  test('with a token the server knows, signed in as them', async () => {
    const alice = me('alice')
    const session = aSession(aStore('a'), { a: alice })
    await session.restore()
    expect(session.snapshot()).toEqual({ status: 'signed-in', me: alice })
    expect(session.token()).toBe('a')
  })

  /** Reopened weeks later: an expired token is the ordinary case, cleared without a word. */
  test('with a token the server has forgotten, signed out and cleared — quietly', async () => {
    const store = aStore('stale')
    const session = aSession(store)
    expect(await errorsDuring(session.restore)).toEqual([])
    expect(session.snapshot().status).toBe('signed-out')
    expect(store.held()).toBeNull()
    expect(session.token()).toBeNull()
  })

  /**
   * The installed app opened with no signal, or with the server down behind its proxy: nobody
   * refused the token, so it is kept — signing out would leave someone at the gym needing a
   * password, and a signal, to get back in. Said as unreachable, and restored again on request.
   */
  test('with no signal, kept and unreachable — quietly — and signed in once it answers', async () => {
    const alice = me('alice')
    const store = aStore('a')
    const server = {
      answer: async (): Promise<Me> => await Promise.reject(new NetworkError('/auth/me')),
    }
    const session = createSession({
      store,
      auth: () => ({ ...anAuth({ a: alice }, session.token, session.rejected), me: server.answer }),
    })

    expect(await errorsDuring(session.restore)).toEqual([])
    expect(session.snapshot()).toEqual({ status: 'unreachable', me: null })
    expect(store.held()).toBe('a')
    expect(session.token()).toBe('a')

    server.answer = async () => alice
    await session.restore()
    expect(session.snapshot()).toEqual({ status: 'signed-in', me: alice })
  })

  /** A server error is the server's: the token kept — and said, so a broken `/auth/me` is seen. */
  test('with the server failing, kept and unreachable — and said', async () => {
    const store = aStore('a')
    const session = createSession({
      store,
      auth: () => ({
        ...anAuth({}, session.token, session.rejected),
        me: async () =>
          await Promise.reject(new ApiError(502, 'internal', '/auth/me failed with 502', null)),
      }),
    })
    expect(await errorsDuring(session.restore)).not.toEqual([])
    expect(session.snapshot().status).toBe('unreachable')
    expect(store.held()).toBe('a')
  })

  /** A bug in the client is not a lost signal: said, and not mistaken for one. */
  test('with a TypeError of its own, signed out — and said', async () => {
    const session = createSession({
      store: aStore('a'),
      auth: () => ({
        ...anAuth({}, session.token, session.rejected),
        me: async () => await Promise.reject(new TypeError('me is not a function')),
      }),
    })
    expect(await errorsDuring(session.restore)).not.toEqual([])
    expect(session.snapshot().status).toBe('signed-out')
  })

  /** Regression (c97961b): an unguarded read left the app on the boot spinner forever. */
  test('with a keychain that throws, signed out — and said', async () => {
    const store = {
      ...aStore(),
      read: async () => await Promise.reject(new Error('keychain locked')),
    }
    const session = aSession(store)
    expect(await errorsDuring(session.restore)).not.toEqual([])
    expect(session.snapshot().status).toBe('signed-out')
  })

  /** Overtaken while asking the server who the stored token is: the answer is the old person's. */
  test('overtaken by a sign-in while asking who it is, changes nothing', async () => {
    const asking = inFlight<Me>()
    const asked = inFlight<null>()
    const bob = me('bob')
    const session = createSession({
      store: aStore('a'),
      auth: () => ({
        me: async () => {
          if (session.token() !== 'a') return bob
          asked.settle(null)
          return await asking.promise
        },
        logout: async () => null,
        updateMe: async () => bob,
      }),
    })
    const restoring = session.restore()
    // Past the keychain: the server is being asked who 'a' is.
    await asked.promise
    await session.adopt('b')
    asking.settle(me('alice'))
    await restoring
    expect(session.snapshot()).toEqual({ status: 'signed-in', me: bob })
  })

  test('signed out while it was still reading, stays signed out', async () => {
    const reading = inFlight<string | null>()
    const session = aSession(
      { ...aStore(), read: async () => await reading.promise },
      { a: me('alice') },
    )
    const restoring = session.restore()
    await session.signOut()
    reading.settle('a')
    await restoring
    expect(session.snapshot()).toEqual({ status: 'signed-out', me: null })
    expect(session.token()).toBeNull()
  })

  /** While the keychain is still being read, there is no credential to send — not even an empty one. */
  test('sends no token before one is read', async () => {
    let release: ((token: string | null) => void) | undefined
    const store = {
      ...aStore(),
      read: async () =>
        await new Promise<string | null>((resolve) => {
          release = resolve
        }),
    }
    const session = aSession(store)
    const restoring = session.restore()
    expect(session.token()).toBeNull()
    release?.(null)
    await restoring
  })

  /** A slow restore must not undo a sign-in that happened while it was still reading. */
  test('finishing after a sign-in, changes nothing', async () => {
    let release: ((token: string) => void) | undefined
    const store = {
      ...aStore(),
      read: async () =>
        await new Promise<string>((resolve) => {
          release = resolve
        }),
    }
    const alice = me('alice')
    const bob = me('bob')
    const session = aSession(store, { a: alice, b: bob })
    const restoring = session.restore()
    await session.adopt('b')
    release?.('a')
    await restoring
    expect(session.snapshot()).toEqual({ status: 'signed-in', me: bob })
    expect(session.token()).toBe('b')
  })
})

describe('signing in and out', () => {
  test('adopting a token stores it, and signs in as its owner', async () => {
    const store = aStore()
    const alice = me('alice')
    const session = aSession(store, { a: alice })
    await session.adopt('a')
    expect(store.held()).toBe('a')
    expect(session.snapshot()).toEqual({ status: 'signed-in', me: alice })
  })

  /** Best effort: a network failure must not trap someone in a shell they cannot use. */
  test('signing out ends the local session even when the server cannot be told', async () => {
    const store = aStore()
    const session = createSession({
      store,
      auth: () => ({
        ...anAuth({ a: me('alice') }, session.token, session.rejected),
        logout: async () => await Promise.reject(new Error('offline')),
      }),
    })
    await session.adopt('a')
    await session.signOut()
    expect(session.snapshot()).toEqual({ status: 'signed-out', me: null })
    expect(store.held()).toBeNull()
    expect(session.token()).toBeNull()
  })

  test('a change to the account is who they are from then on', async () => {
    const session = aSession(aStore(), { a: me('alice') })
    await session.adopt('a')
    await session.update({ birthYear: 1990 })
    expect(session.snapshot().me?.user).toMatchObject({ username: 'alice', birthYear: 1990 })
  })

  test('tells whoever subscribed, each time it changes', async () => {
    const session = aSession(aStore(), { a: me('alice') })
    const seen: string[] = []
    const stop = session.subscribe(() => seen.push(session.snapshot().status))
    await session.adopt('a')
    await session.signOut()
    stop()
    await session.adopt('a')
    expect(seen).toEqual(['signed-in', 'signed-out'])
  })
})

describe('an answer for someone no longer signed in', () => {
  test('signing in, then out before the server answered: still signed out', async () => {
    const asking = inFlight<Me>()
    const session = createSession({
      store: aStore(),
      auth: () => ({
        me: async () => await asking.promise,
        logout: async () => null,
        updateMe: async () => me('x'),
      }),
    })
    const signingIn = session.adopt('a')
    await session.signOut()
    asking.settle(me('alice'))
    await signingIn
    expect(session.snapshot()).toEqual({ status: 'signed-out', me: null })
    expect(session.token()).toBeNull()
  })

  test("a weight unit answered for the previous person does not rewrite the next one's", async () => {
    const saving = inFlight<Me>()
    const alice = me('alice')
    const bob = me('bob')
    const session = createSession({
      store: aStore(),
      auth: () => ({
        me: async () => (session.token() === 'a' ? alice : bob),
        logout: async () => null,
        updateMe: async () => await saving.promise,
      }),
    })
    await session.adopt('a')
    const updating = session.update({ weightUnit: 'lb' })
    await session.signOut()
    await session.adopt('b')
    saving.settle({ ...alice, user: { ...alice.user, weightUnit: 'lb' } })
    await updating
    expect(session.snapshot()).toEqual({ status: 'signed-in', me: bob })
  })
})

describe('forgetting', () => {
  /** A keychain whose clear is in flight until the test settles it, saying when it began. */
  function aSlowKeychain() {
    const clearing = inFlight<null>()
    const began = inFlight<null>()
    const store = {
      ...aStore(),
      clear: async () => {
        began.settle(null)
        await clearing.promise
      },
    }
    return { store, began: began.promise, finish: () => clearing.settle(null) }
  }

  /** A sign-in that follows must not find the old token still in the keychain. */
  test('says signed out only once the keychain is clear', async () => {
    const keychain = aSlowKeychain()
    const session = aSession(keychain.store, { a: me('alice') })
    await session.adopt('a')
    const signingOut = session.signOut()
    await keychain.began
    expect(session.token()).toBeNull()
    expect(session.snapshot().status).toBe('signed-in')
    keychain.finish()
    await signingOut
    expect(session.snapshot().status).toBe('signed-out')
  })

  test('a sign-in while the keychain was clearing is not undone', async () => {
    const keychain = aSlowKeychain()
    const bob = me('bob')
    const session = aSession(keychain.store, { a: me('alice'), b: bob })
    await session.adopt('a')
    const signingOut = session.signOut()
    await keychain.began
    await session.adopt('b')
    keychain.finish()
    await signingOut
    expect(session.snapshot()).toEqual({ status: 'signed-in', me: bob })
  })
})

describe('a credential the server rejects', () => {
  test('signs out and clears, when it is the one in use', async () => {
    const store = aStore()
    const session = aSession(store, { a: me('alice') })
    await session.adopt('a')
    await session.rejected('a')
    expect(session.snapshot().status).toBe('signed-out')
    expect(store.held()).toBeNull()
  })

  /** Regression (c97961b): a slow request with the previous user's token signed the next one out. */
  test("is ignored when it was the previous person's", async () => {
    const bob = me('bob')
    const session = aSession(aStore(), { a: me('alice'), b: bob })
    await session.adopt('a')
    await session.signOut()
    await session.adopt('b')
    await session.rejected('a')
    expect(session.snapshot()).toEqual({ status: 'signed-in', me: bob })
  })
})
