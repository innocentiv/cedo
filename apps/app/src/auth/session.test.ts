import { describe, expect, spyOn, test } from 'bun:test'
import type { Me } from '@cedo/contract'
import { ApiError } from '../api/errors.ts'
import { type SessionAuth, type TokenStore, createSession } from './session.ts'

/**
 * Who is signed in, without React and without a network: a fake keychain and a fake API. These are
 * the rules that lived in effects and two module-level variables, two of them fixed in 52260d8 with
 * no test — "not reproducible in the web harness without test hooks in production code".
 */

const me = (username: string): Me => ({
  user: {
    id: crypto.randomUUID(),
    username,
    displayName: username,
    createdAt: new Date().toISOString(),
    weightUnit: 'kg',
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

/** An API that knows `who` by their token. */
function anAuth(who: Record<string, Me>, token: () => string | null): SessionAuth {
  return {
    me: async () => {
      const known = who[token() ?? '']
      if (known === undefined) throw rejected()
      return known
    },
    logout: async () => null,
    updateMe: async ({ weightUnit }) => {
      const known = who[token() ?? '']
      if (known === undefined) throw rejected()
      return { ...known, user: { ...known.user, weightUnit } }
    },
  }
}

function aSession(store: TokenStore, who: Record<string, Me> = {}) {
  const session = createSession({ store, auth: () => anAuth(who, session.token) })
  return session
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
    const errors = spyOn(console, 'error').mockImplementation(() => null)
    const session = aSession(store)
    await session.restore()
    expect(session.snapshot().status).toBe('signed-out')
    expect(store.held()).toBeNull()
    expect(session.token()).toBeNull()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  /** Regression (52260d8): an unguarded read left the app on the boot spinner forever. */
  test('with a keychain that throws, signed out — and said', async () => {
    const store = {
      ...aStore(),
      read: async () => await Promise.reject(new Error('keychain locked')),
    }
    const errors = spyOn(console, 'error').mockImplementation(() => null)
    const session = aSession(store)
    await session.restore()
    expect(session.snapshot().status).toBe('signed-out')
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
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
        ...anAuth({ a: me('alice') }, session.token),
        logout: async () => await Promise.reject(new Error('offline')),
      }),
    })
    await session.adopt('a')
    await session.signOut()
    expect(session.snapshot()).toEqual({ status: 'signed-out', me: null })
    expect(store.held()).toBeNull()
    expect(session.token()).toBeNull()
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

describe('a credential the server rejects', () => {
  test('signs out and clears, when it is the one in use', async () => {
    const store = aStore()
    const session = aSession(store, { a: me('alice') })
    await session.adopt('a')
    session.rejected('a')
    expect(session.snapshot().status).toBe('signed-out')
    expect(store.held()).toBeNull()
  })

  /** Regression (52260d8): a slow request with the previous user's token signed the next one out. */
  test("is ignored when it was the previous person's", async () => {
    const bob = me('bob')
    const session = aSession(aStore(), { a: me('alice'), b: bob })
    await session.adopt('a')
    await session.signOut()
    await session.adopt('b')
    session.rejected('a')
    expect(session.snapshot()).toEqual({ status: 'signed-in', me: bob })
  })
})
