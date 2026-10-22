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
interface WorkerScope {
  readonly location: Location
  readonly skipWaiting: () => Promise<void>
  readonly clients: { readonly claim: () => Promise<void> }
  readonly addEventListener: {
    (type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void
    (type: 'fetch', listener: (event: FetchEvent) => void): void
  }
}

const worker = globalThis as unknown as WorkerScope

const shell: Shell = {
  store: async () => {
    const cache = await caches.open(SHELL_CACHE)
    return {
      match: async (path) => await cache.match(path),
      put: async (path, response) => {
        await cache.put(path, response)
      },
      keys: async () => (await cache.keys()).map((request) => new URL(request.url).pathname),
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
  const url = new URL(event.request.url)
  const answer = respond(route, route === 'shell' ? url.pathname + url.search : url.pathname, shell)
  event.respondWith(answer.response)
  event.waitUntil(answer.done)
})
