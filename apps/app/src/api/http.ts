import { Platform } from 'react-native'
import { createApi } from './client.ts'
import { transport } from './transport.ts'
import { createServerChoice, startUp as startUpOn } from '../auth/server.ts'
import { createSession } from '../auth/session.ts'
import { serverStore, tokenStore } from '../auth/token-storage.ts'

/**
 * The app's adapter for the client: where the API is, the session's credential, and what happens
 * when the server stops honouring it. The client itself depends on `@cedo/contract` and nothing
 * else from this repo — never on `apps/api`, not even for a type. See
 * docs/adr/0015-no-eden-treaty.md.
 */

/**
 * Which server the native app talks to: the one its person typed and the app checked, kept in the
 * keychain beside the sign-in (#78, `../auth/server.ts`). The session is forgotten on this device —
 * the token in memory as in the keychain — before another server is kept, so a token goes only to
 * the server that issued it. The web app's is the page's own.
 */
export const server = createServerChoice({
  store: serverStore,
  fetcher: fetch,
  forgetSignIn: async () => {
    await session.forget()
  },
  served: Platform.OS === 'web',
})

/**
 * Same-origin on web: Caddy proxies `/api` to the API container, so nothing about the deployment
 * host is baked into the bundle and the same image works on any NAS at any hostname. On native,
 * the server chosen — read at every request, since it can be changed. One build serves every
 * instance (ADR-0032).
 */
function base(): string {
  if (Platform.OS === 'web') return '/api'
  const chosen = server.base()
  if (chosen === null) throw new Error('No server is chosen yet: the server screen comes first.')
  return chosen
}

/** At startup: which server first, then who is signed in on it (`../auth/server.ts`). */
export async function startUp(): Promise<void> {
  await startUpOn(server, session.restore)
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

/**
 * The API's root as an absolute URL — what a client outside this app must be told, an AI's MCP
 * client above all. On web the base is `/api`, so it is this page's origin's; on native it is
 * already absolute. Never baked in at build time, so the address is right on any host.
 */
export function apiRoot(): string {
  return new URL(base(), typeof location === 'undefined' ? undefined : location.origin).href
}

/**
 * Who is signed in: the one session, which every request sends the token of. A credential the
 * server rejects mid-session — revoked on another device, or expired after a month unopened —
 * signs it out, rather than leaving every screen with "Authentication required" and no way back to
 * the login form. Its rules are in ../auth/session.ts.
 */
export const session = createSession({ store: tokenStore, auth: () => api.auth })

/** Every call the app makes, as the signed-in user. */
export const api = createApi(
  transport({
    baseUrl: base,
    token: session.token,
    onUnauthenticated: (sentToken) => {
      void session.rejected(sentToken)
    },
  }),
)

export { ApiError } from './errors.ts'
