import { Instance } from '@cedo/contract'

/**
 * Which server this device talks to, and every rule about it (#78, ADR-0032) — outside React, so
 * each is unit-tested with a fake fetch and a fake keychain (server.test.ts), as the session's are.
 * The native app is one build for every instance: a person types the address of theirs, and it is
 * kept, with their sign-in, until they change it. The web app needs none of this: it is served by
 * its server, and calls `/api` on the same origin.
 */

/** Where a server's API is: `https://cedo.example.com/api`. */
export type Base = string

export type AddressProblem = 'empty' | 'malformed' | 'insecure'

/**
 * A host plain HTTP may be sent to: an IP address, a `.local` name, or this device. iOS allows
 * exactly those under `NSAllowsLocalNetworking`; anywhere else a token would cross the network in
 * clear text, so the app asks for HTTPS (ADR-0032).
 */
function local(hostname: string): boolean {
  return (
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname.startsWith('[') ||
    hostname.endsWith('.local') ||
    hostname === 'localhost'
  )
}

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu

/**
 * The address a person opens in a browser, made the API root. With no scheme it is HTTPS, but on a
 * local address plain HTTP — which is what an instance serves out of the box on the home network.
 * Its path is kept, so an instance served under one still works; what follows the path is dropped.
 */
export function readAddress(
  typed: string,
): { readonly base: Base } | { readonly problem: AddressProblem } {
  const trimmed = typed.trim()
  if (trimmed === '') return { problem: 'empty' }
  let url: URL
  try {
    url = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return { problem: 'malformed' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { problem: 'malformed' }
  if (!SCHEME.test(trimmed) && local(url.hostname)) url.protocol = 'http:'
  if (url.protocol === 'http:' && !local(url.hostname)) return { problem: 'insecure' }
  const path = url.pathname.replace(/\/+$/u, '')
  return { base: `${url.protocol}//${url.host}${path.endsWith('/api') ? path : `${path}/api`}` }
}

/** The server as a person knows it: `cedo.example.com`, `192.168.1.20:8080`. */
export const hostOf = (base: Base): string => new URL(base).host

const PRIVATE_IPV4 = [/^10\./u, /^192\.168\./u, /^172\.(?:1[6-9]|2\d|3[01])\./u, /^169\.254\./u]

/**
 * On the Wi-Fi's own network, where iOS asks before the app may connect: "can't reach" then says
 * where to allow it. Not this device, and not a VPN's address, which iOS does not count as local
 * (TN3179).
 */
export function onLocalNetwork(base: Base): boolean {
  const { hostname } = new URL(base)
  if (hostname.startsWith('[')) return /^\[f[cde]/iu.test(hostname)
  return hostname.endsWith('.local') || PRIVATE_IPV4.some((range) => range.test(hostname))
}

/** What the check asks with: `fetch`, or a fake. */
export type Fetcher = (
  url: string,
  init: { readonly signal: AbortSignal; readonly headers: Readonly<Record<string, string>> },
) => Promise<Response>

export type ServerCheck =
  | { readonly kind: 'cedo'; readonly instance: Instance }
  | { readonly kind: 'unreachable'; readonly onLocalNetwork: boolean }
  | { readonly kind: 'not-cedo' }
  /** It sent the request to another host, which is not followed: the person may enter that one. */
  | { readonly kind: 'elsewhere'; readonly host: string }

/** Long enough for a phone waking its radio, short enough that a wrong address is said soon. */
export const CHECK_TIMEOUT_MS = 8000

/**
 * Is it a cedo server? One unauthenticated `GET /instance`, the answer read by the contract's own
 * schema, which names the product (ADR-0029). Nothing answering is kept apart from something else
 * answering, as Jellyfin's app keeps them.
 */
export async function checkServer(
  base: Base,
  fetcher: Fetcher,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<ServerCheck> {
  const unreachable = { kind: 'unreachable', onLocalNetwork: onLocalNetwork(base) } as const
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetcher(`${base}/instance`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (response.url !== '' && hostOf(response.url) !== hostOf(base)) {
      return { kind: 'elsewhere', host: hostOf(response.url) }
    }
    // A proxy answering for an API that is down is the server unreachable, not another product.
    if (response.status >= 500) return unreachable
    if (!response.ok) return { kind: 'not-cedo' }
    const parsed = Instance.safeParse(await response.json().catch(() => null))
    return parsed.success ? { kind: 'cedo', instance: parsed.data } : { kind: 'not-cedo' }
  } catch {
    return unreachable
  } finally {
    clearTimeout(timer)
  }
}

/** The numbers of a version: `0.10.2` → [0, 10, 2]; null when it is not numbers. */
function numbers(version: string): number[] | null {
  return /^\d+(?:\.\d+)*$/u.test(version) ? version.split('.').map(Number) : null
}

export type VersionNotice = {
  readonly app: string
  readonly server: string
  /** The older side; `either` when the numbers cannot say. */
  readonly update: 'app' | 'server' | 'either'
} | null

/**
 * The app and its server, when they are not the same version: said, never refused (ADR-0032). The
 * server checks every request against the contract, so an older app cannot write what it does not
 * accept; refusing would stop someone logging between an upgrade and the app's.
 */
export function versionNotice(app: string, server: string): VersionNotice {
  if (app === server) return null
  const [mine, theirs] = [numbers(app), numbers(server)]
  if (mine === null || theirs === null) return { app, server, update: 'either' }
  for (let i = 0; i < Math.max(mine.length, theirs.length); i += 1) {
    const difference = (mine[i] ?? 0) - (theirs[i] ?? 0)
    if (difference !== 0) return { app, server, update: difference < 0 ? 'app' : 'server' }
  }
  return { app, server, update: 'either' }
}

/** Where the chosen server is kept between launches: the keychain, beside the sign-in. */
export interface ServerStore {
  readonly read: () => Promise<Base | null>
  readonly write: (base: Base) => Promise<void>
  readonly clear: () => Promise<void>
}

export interface ServerSnapshot {
  /** `loading` until the keychain is read; `none` until a server is chosen. */
  readonly status: 'loading' | 'none' | 'chosen'
  readonly base: Base | null
}

export interface ServerChoice {
  /** The same object until something changes — for `useSyncExternalStore`. */
  readonly snapshot: () => ServerSnapshot
  readonly subscribe: (listener: () => void) => () => void
  /** Where to send requests now, if anywhere. */
  readonly base: () => Base | null
  /** At startup, before the sign-in is restored: the server kept, if any. */
  readonly restore: () => Promise<void>
  /** A server checked and chosen. */
  readonly choose: (base: Base) => Promise<void>
}

/**
 * `forgetSignIn` clears the token kept. It runs before another server is kept, so a token is sent
 * only to the server that issued it, even if the app dies between the two writes; and when none is
 * kept, since a token kept without its server — from a build that named none — is nobody's to send.
 */
export function createServerChoice({
  store,
  forgetSignIn,
}: {
  readonly store: ServerStore
  readonly forgetSignIn: () => Promise<void>
}): ServerChoice {
  let state: ServerSnapshot = { status: 'loading', base: null }
  const listeners = new Set<() => void>()
  const set = (next: ServerSnapshot): void => {
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
    base: () => state.base,
    restore: async () => {
      // A keychain that throws must not strand the app on the boot spinner: it asks again.
      const kept = await store.read().catch((error: unknown) => {
        console.error(error)
        return null
      })
      if (kept === null) {
        await forgetSignIn()
        set({ status: 'none', base: null })
        return
      }
      set({ status: 'chosen', base: kept })
    },
    choose: async (base) => {
      await forgetSignIn()
      await store.write(base)
      set({ status: 'chosen', base })
    },
  }
}
