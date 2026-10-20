import type { Me, WeightUnit } from '@cedo/contract'
import { ApiError } from '../api/errors.ts'

/**
 * Who is signed in on this device, and every rule about it — outside React, so each is unit-tested
 * with a fake keychain and a fake API (session.test.ts). See the amendment to ADR-0017.
 *
 * `status` is a three-state, not a boolean: on first paint the stored token has not been read yet,
 * and a router that treats "unknown" as "signed out" bounces a returning user to the login screen
 * for one frame before bouncing them back. See docs/08-frontend.md.
 */
export type AuthStatus = 'loading' | 'signed-in' | 'signed-out'

export interface SessionSnapshot {
  readonly status: AuthStatus
  readonly me: Me | null
}

/** Where the token is kept between launches: the OS keychain on native, `localStorage` on web. */
export interface TokenStore {
  readonly read: () => Promise<string | null>
  readonly write: (token: string) => Promise<void>
  readonly clear: () => Promise<void>
}

/** The calls the session makes, as whoever holds its token. */
export interface SessionAuth {
  readonly me: () => Promise<Me>
  readonly logout: () => Promise<unknown>
  readonly updateMe: (patch: { readonly weightUnit: WeightUnit }) => Promise<Me>
}

export interface Session {
  /** The same object until something changes — for `useSyncExternalStore`. */
  readonly snapshot: () => SessionSnapshot
  readonly subscribe: (listener: () => void) => () => void
  /** The credential to send now, if any. */
  readonly token: () => string | null
  /** At startup: the stored token, if the server still knows it. */
  readonly restore: () => Promise<void>
  /** A token just minted — by signing in, or by registering. */
  readonly adopt: (token: string) => Promise<void>
  readonly signOut: () => Promise<void>
  /** Saved to the account, so it follows them to every device — and to what the AI writes them. */
  readonly setWeightUnit: (unit: WeightUnit) => Promise<void>
  /**
   * The server refused `sentToken`. Signed out only if it is still the token in use: a slow
   * request made with the previous person's token, answering after a new sign-in, used to sign the
   * new person straight out.
   */
  readonly rejected: (sentToken: string) => Promise<void>
}

const SIGNED_OUT: SessionSnapshot = { status: 'signed-out', me: null }

/** What a session holds, and the one way each part of it changes. */
interface Held {
  readonly snapshot: () => SessionSnapshot
  readonly subscribe: (listener: () => void) => () => void
  readonly token: () => string | null
  /**
   * Bumped by every change of who is signed in, so an answer arriving for an earlier one — a
   * restore still reading, a sign-in or an update still in flight — finds it has been overtaken,
   * and changes nothing.
   */
  readonly generation: () => number
  /** A new generation, the token untouched: a restore beginning overtakes any before it. */
  readonly begin: () => number
  readonly set: (next: SessionSnapshot) => void
  /** Holds `token` from now on — a new generation, overtaking anything still in flight. */
  readonly take: (token: string) => void
  /** Drops the local session: an explicit sign-out, a rejected credential, a failed restore. */
  readonly forget: () => Promise<void>
}

function hold(store: TokenStore): Held {
  let state: SessionSnapshot = { status: 'loading', me: null }
  let current: string | null = null
  let generation = 0
  const listeners = new Set<() => void>()
  const set = (next: SessionSnapshot): void => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    token: () => current,
    generation: () => generation,
    begin: () => {
      generation += 1
      return generation
    },
    set,
    take: (token) => {
      generation += 1
      current = token
    },
    forget: async () => {
      // No token is sent from now on; the keychain is cleared before the screens say signed out,
      // so a sign-in that follows cannot find the old token still there. One that will not let go
      // (native) is said, not thrown: the session ends either way — it used to strand the boot
      // spinner on a failed restore.
      generation += 1
      const forgetting = generation
      current = null
      await store.clear().catch((error: unknown) => {
        console.error(error)
      })
      if (forgetting === generation) set(SIGNED_OUT)
    },
  }
}

async function restoreFrom(held: Held, store: TokenStore, auth: () => SessionAuth): Promise<void> {
  const started = held.begin()
  const overtaken = () => started !== held.generation()
  // A keychain that throws (native) must not strand the app on the boot spinner forever.
  const stored = await store.read().catch((error: unknown) => {
    console.error(error)
    return null
  })
  if (overtaken()) return
  if (stored === null) {
    held.set(SIGNED_OUT)
    return
  }
  held.take(stored)
  const reading = held.generation()
  try {
    const identity = await auth().me()
    if (reading === held.generation()) held.set({ status: 'signed-in', me: identity })
  } catch (error) {
    if (reading !== held.generation()) return
    // Reopened weeks later, an expired token is the ordinary case: cleared without a word.
    if (!(error instanceof ApiError) || error.code !== 'unauthenticated') console.error(error)
    await held.forget()
  }
}

/**
 * `auth` is read lazily: the API sends this session's token, so the two are made from each other.
 */
export function createSession({
  store,
  auth,
}: {
  readonly store: TokenStore
  readonly auth: () => SessionAuth
}): Session {
  const held = hold(store)
  return {
    snapshot: held.snapshot,
    subscribe: held.subscribe,
    token: held.token,
    restore: async () => {
      await restoreFrom(held, store, auth)
    },
    adopt: async (token) => {
      held.take(token)
      const adopting = held.generation()
      await store.write(token)
      const identity = await auth().me()
      // Signed out — or in as someone else — while this was in flight: it is not theirs any more.
      if (adopting === held.generation()) held.set({ status: 'signed-in', me: identity })
    },
    signOut: async () => {
      // Best effort: a network failure must not trap someone in a shell they cannot use.
      await auth()
        .logout()
        .catch(() => null)
      await held.forget()
    },
    setWeightUnit: async (weightUnit) => {
      const updating = held.generation()
      const updated = await auth().updateMe({ weightUnit })
      // The answer is the previous person's if someone else signed in while it was in flight.
      if (updating === held.generation()) held.set({ status: 'signed-in', me: updated })
    },
    rejected: async (sentToken) => {
      if (sentToken === held.token()) await held.forget()
    },
  }
}
