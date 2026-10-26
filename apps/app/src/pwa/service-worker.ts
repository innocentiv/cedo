import { alertOf } from './rest-alert.ts'
import { SHELL_CACHE, type Shell, precache, respond, routeOf } from './shell-cache.ts'

/**
 * The service worker: `shell-cache.ts` wired to the browser. Bundled on its own by the web export
 * into `dist/sw.js` — served from the root, so its scope is the whole app — and registered by
 * `register.ts`. Nothing here decides anything; the rules are in shell-cache.ts and tested there.
 */

/** The few worker globals used here. The app's types are the DOM's, which has no worker scope. */
interface ExtendableEvent extends Event {
  readonly waitUntil: (work: Promise<unknown>) => void
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request
  readonly respondWith: (response: Promise<Response>) => void
}
interface PushEvent extends ExtendableEvent {
  readonly data: { readonly json: () => unknown } | null
}
interface NotificationEvent extends ExtendableEvent {
  readonly notification: { readonly data: unknown; readonly close: () => void }
}
interface WindowClient {
  readonly url: string
  readonly focus: () => Promise<WindowClient>
  readonly navigate: (url: string) => Promise<WindowClient | null>
}
interface WorkerScope {
  readonly location: Location
  readonly skipWaiting: () => Promise<void>
  readonly clients: {
    readonly claim: () => Promise<void>
    readonly matchAll: (options: { type: 'window' }) => Promise<readonly WindowClient[]>
    readonly openWindow: (url: string) => Promise<WindowClient | null>
  }
  readonly registration: {
    readonly showNotification: (
      title: string,
      options: { body: string; data: unknown; tag: string; icon: string },
    ) => Promise<void>
  }
  readonly addEventListener: {
    (type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void
    (type: 'fetch', listener: (event: FetchEvent) => void): void
    (type: 'push', listener: (event: PushEvent) => void): void
    (type: 'notificationclick', listener: (event: NotificationEvent) => void): void
  }
}

// The one cast: under the DOM's types `globalThis` is a window. Bundled alone as `sw.js`, it is the
// worker scope — the interfaces above are the part of it this file uses.
const worker = globalThis as unknown as WorkerScope

const shell: Shell = {
  store: async () => {
    const cache = await caches.open(SHELL_CACHE)
    return {
      match: async (path) => await cache.match(path),
      put: async (path, response) => {
        await cache.put(path, response)
      },
      keys: async () =>
        (await cache.keys()).map((request) => {
          const url = new URL(request.url)
          return url.pathname + url.search
        }),
      delete: async (path) => await cache.delete(path),
    }
  },
  fetch: async (path) => await fetch(path),
}

worker.addEventListener('install', (event) => {
  // Straight to active: the shell it keeps is refreshed on every opening, so there is no old
  // worker whose pages a new one would break.
  event.waitUntil(precache(shell).then(async () => await worker.skipWaiting()))
})

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const stale = (await caches.keys()).filter((name) => name !== SHELL_CACHE)
      await Promise.all(stale.map(async (name) => await caches.delete(name)))
      await worker.clients.claim()
    })(),
  )
})

worker.addEventListener('fetch', (event) => {
  const route = routeOf(event.request, worker.location.origin)
  if (route === 'network') return
  // By path and query: kept build output is matched exactly as it was asked for.
  const url = new URL(event.request.url)
  const answer = respond(route, url.pathname + url.search, shell)
  event.respondWith(answer.response)
  event.waitUntil(answer.done)
})

/**
 * A rest is over (#38): said as the server wrote it — every push shown, as iOS requires of a web
 * app — one at a time, a newer replacing an older (`tag`).
 */
worker.addEventListener('push', (event) => {
  const alert = alertOf(event.data?.json() ?? null) ?? {
    title: 'Rest over',
    body: 'Time for the next set.',
    url: '/',
  }
  event.waitUntil(
    worker.registration.showNotification(alert.title, {
      body: alert.body,
      data: alert.url,
      tag: 'rest',
      icon: '/icons/icon-192.png',
    }),
  )
})

/** Tapped: the session it is of — in the app already open, or opened. */
worker.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = typeof event.notification.data === 'string' ? event.notification.data : '/'
  event.waitUntil(
    (async () => {
      const [open] = await worker.clients.matchAll({ type: 'window' })
      if (open === undefined) {
        await worker.clients.openWindow(url)
        return
      }
      await open.focus()
      await open.navigate(url)
    })(),
  )
})
