import { Platform } from 'react-native'
import { createApi } from './client.ts'
import { transport } from './transport.ts'

/**
 * The app's adapter for the client: where the API is, the session's credential, and what happens
 * when the server stops honouring it. The client itself depends on `@cedo/contract` and nothing
 * else from this repo — never on `apps/api`, not even for a type. See
 * docs/adr/0015-no-eden-treaty.md.
 */

/**
 * Same-origin on web: Caddy proxies `/api` to the API container, so nothing about the deployment
 * host is baked into the bundle and the same image works on any NAS at any hostname.
 *
 * Native has no such proxy and must be told where the server is. `EXPO_PUBLIC_` is Expo's inlining
 * prefix, so this is resolved at bundle time.
 */
function resolveBaseUrl(): string {
  // DOT access, deliberately: Expo substitutes `EXPO_PUBLIC_*` only for static member access, and
  // `process.env['NAME']` silently stays undefined in a built app. See expo-env.d.ts.
  const configured = process.env.EXPO_PUBLIC_API_URL
  if (configured !== undefined && configured !== '') return configured.replace(/\/$/u, '')
  if (Platform.OS === 'web') return '/api'
  throw new Error(
    'EXPO_PUBLIC_API_URL must be set for native builds — there is no same-origin proxy outside the browser.',
  )
}

let baseUrl: string | undefined

/** Lazy so importing this module on native without the variable set does not crash at load. */
function base(): string {
  baseUrl ??= resolveBaseUrl()
  return baseUrl
}

/**
 * Resolves an API-root-relative path — `Media.url`, `Media.thumbnailUrl` — into something a browser
 * or a native image loader can actually fetch.
 *
 * Needed because those fields are relative to the API, not to the site: rendering them straight into
 * an `<img src>` asks the web origin for `/media/…`, and Caddy answers with the SPA's index.html.
 * That is a 200 with `text/html`, so the image is simply blank and no error handler ever runs.
 * An absolute URL (a YouTube link) is returned unchanged.
 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//u.test(path)) return path
  return `${base()}${path.startsWith('/') ? path : `/${path}`}`
}

/** Set by the auth provider. A module-level holder so every call site does not thread it through. */
let bearer: string | null = null

export function setAuthToken(token: string | null): void {
  bearer = token
}

/**
 * Called when the API rejects the credential we are holding.
 *
 * A token can be revoked or expire mid-session — from the settings screen on another device, or
 * simply by sitting unopened for a month. Without this the app keeps a token the server has
 * forgotten and every screen fills with "Authentication required" and no way out. The auth provider
 * registers a handler that signs out and returns to the login screen.
 */
let onUnauthenticated: (() => void) | null = null

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler
}

/** Every call the app makes, as the signed-in user. */
export const api = createApi(
  transport({
    baseUrl: base,
    token: () => bearer,
    onUnauthenticated: () => {
      onUnauthenticated?.()
    },
  }),
)

export { ApiError, ContractDriftError } from './errors.ts'
