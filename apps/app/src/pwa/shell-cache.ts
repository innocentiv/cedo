/**
 * The installed app's shell, kept on this device so it opens instantly and without a signal: the one
 * document (the web build is `output: "single"`) and the bundle it names. Behaviour only the app can
 * own — no server sees this cache — so it is a plain module, unit-tested beside it with a fake cache
 * and a fake network; `service-worker.ts` wires it to the browser. See docs/08-frontend.md.
 *
 * Only the shell. Training data is never answered from here: a stale read of a session is a wrong
 * one, and logging without a signal is its own problem (#9).
 */

/** Renamed only if what is kept changes shape: activating drops every other cache. */
export const SHELL_CACHE = 'cedo-shell-v1'

/** Every page of the app is this one document. */
const SHELL_KEY = '/'

/** Content-hashed build output, as the Caddyfile names it: a kept copy is as good as the network. */
const BUILD_PREFIXES = ['/_expo/static/', '/assets/'] as const

/** The bundle generations: the document's, and the one before, which an open page may still ask for. */
const BUNDLE_PREFIX = '/_expo/static/'

export type Route = 'shell' | 'build' | 'network'

/** What the shell keeps, by path. The service worker's adapter is a `Cache`; the test's, a map. */
export interface ShellStore {
  readonly match: (path: string) => Promise<Response | undefined>
  readonly put: (path: string, response: Response) => Promise<void>
  readonly keys: () => Promise<string[]>
  readonly delete: (path: string) => Promise<boolean>
}

export interface Shell {
  readonly store: () => Promise<ShellStore>
  readonly fetch: (path: string) => Promise<Response>
}

/** A request's answer, and the keeping that may outlive it — what the worker must wait for. */
export interface Answer {
  readonly response: Promise<Response>
  readonly done: Promise<void>
}

const isBuild = (path: string) => BUILD_PREFIXES.some((prefix) => path.startsWith(prefix))

export function routeOf(
  request: { readonly url: string; readonly method: string; readonly mode: RequestMode },
  origin: string,
): Route {
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== origin) return 'network'
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return 'network'
  if (isBuild(url.pathname)) return 'build'
  return request.mode === 'navigate' ? 'shell' : 'network'
}

/** The build output a document loads: its `src` and `href` attributes under a build prefix. */
export function buildAssetsOf(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/gu)].flatMap(([, path]) =>
    path !== undefined && isBuild(path) ? [path] : [],
  )
}

/** On install: the document and its bundle, so the first opening without a signal works. */
export async function precache(shell: Shell): Promise<void> {
  await keepShell(await shell.fetch(SHELL_KEY), shell)
}

/**
 * The shell from what was kept, at once, while the network's copy replaces it for the next opening
 * — stale-while-revalidate, so a new deployment arrives one opening later and never blocks one.
 * Build output from what was kept, or fetched once and kept.
 */
export function respond(route: Exclude<Route, 'network'>, path: string, shell: Shell): Answer {
  if (route === 'build') {
    const response = fromBuild(path, shell)
    return { response, done: response.then(ignore, ignore) }
  }
  const fetched = shell.fetch(path)
  // Copied the moment it arrives: on a first opening the page reads the original straight away.
  const toKeep = fetched.then((response) => response.clone())
  // A cache that cannot be read is no reason to fail an opening the network can answer.
  const kept = shell
    .store()
    .then(async (store) => await store.match(SHELL_KEY))
    .catch(ignore)
  // What this page is served, read from a copy before the page reads the original.
  const served = kept.then(async (copy) =>
    copy === undefined ? [] : buildAssetsOf(await copy.clone().text()),
  )
  // Keeping is best effort: the next opening tries again.
  const done = Promise.all([toKeep, served])
    .then(async ([response, names]) => await keepShell(response, shell, names))
    .catch(ignore)
  return { response: kept.then(async (copy) => copy ?? (await fetched)), done }
}

const ignore = (): void => undefined

async function fromBuild(path: string, shell: Shell): Promise<Response> {
  const store = await shell.store()
  const kept = await store.match(path)
  if (kept !== undefined) return kept
  const response = await shell.fetch(path)
  if (response.ok) await store.put(path, response.clone())
  return response
}

/**
 * Keeps a document only once its bundle is kept, so what is kept always boots — and never an error
 * page: a proxy's 502 while the app restarts is not the app. Then drops every bundle named neither
 * by this document, nor by the one it replaces, nor by the one the opening was `served` — which,
 * with two openings at once, is not the one it replaces.
 */
async function keepShell(
  response: Response,
  shell: Shell,
  served: readonly string[] = [],
): Promise<void> {
  if (!response.ok) return
  const store = await shell.store()
  const html = await response.clone().text()
  const assets = buildAssetsOf(html)
  const fetched = await Promise.all(assets.map(async (path) => await fromBuild(path, shell)))
  if (fetched.some((asset) => !asset.ok)) return

  const before = await store.match(SHELL_KEY)
  const named = new Set([
    ...assets,
    ...served,
    ...(before === undefined ? [] : buildAssetsOf(await before.text())),
  ])
  await store.put(SHELL_KEY, response)
  const stale = (await store.keys()).filter(
    (key) => key.startsWith(BUNDLE_PREFIX) && !named.has(key),
  )
  await Promise.all(stale.map(async (key) => await store.delete(key)))
}
