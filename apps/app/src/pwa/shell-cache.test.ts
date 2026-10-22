import { describe, expect, test } from 'bun:test'
import {
  type Shell,
  type ShellStore,
  buildAssetsOf,
  precache,
  respond,
  routeOf,
} from './shell-cache.ts'

/**
 * What the installed app keeps on this device so it opens without the network: the app shell —
 * the one document and the bundle it names. A fake cache and a fake network; the service worker
 * wiring them to the browser is driven for real by the e2e journey.
 */

const ORIGIN = 'https://gym.example'

const page = (bundle: string) =>
  `<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest"></head>` +
  `<body><script src="/_expo/static/js/web/${bundle}.js" defer></script></body></html>`

/** A network that serves one deployment, and can be cut. */
function network(initial: string) {
  const state = { bundle: initial, up: true, fetched: [] as string[] }
  const fetch = async (path: string): Promise<Response> => {
    state.fetched.push(path)
    if (!state.up) throw new TypeError('Load failed')
    if (path.startsWith('/_expo/static/')) {
      return path.includes(state.bundle)
        ? new Response(`// ${state.bundle}`)
        : new Response('Not found', { status: 404 })
    }
    return new Response(page(state.bundle), { headers: { 'content-type': 'text/html' } })
  }
  return { state, fetch }
}

function store(): ShellStore & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    match: async (key) => {
      const body = entries.get(key)
      return body === undefined ? undefined : new Response(body)
    },
    put: async (key, response) => {
      entries.set(key, await response.text())
    },
    keys: async () => [...entries.keys()],
    delete: async (key) => entries.delete(key),
  }
}

function device(bundle: string) {
  const net = network(bundle)
  const cache = store()
  const shell: Shell = { store: async () => cache, fetch: net.fetch }
  return { net, cache, shell }
}

const bundleOf = (b: string) => `/_expo/static/js/web/${b}.js`

describe('which requests the shell answers', () => {
  const req = (path: string, mode: RequestMode = 'no-cors', method = 'GET', origin = ORIGIN) => ({
    url: `${origin}${path}`,
    method,
    mode,
  })

  test('every page of the app is the one document', () => {
    expect(routeOf(req('/', 'navigate'), ORIGIN)).toBe('shell')
    expect(routeOf(req('/today?x=1', 'navigate'), ORIGIN)).toBe('shell')
  })

  test('build output is content-hashed, so a copy is as good as the network', () => {
    expect(routeOf(req(bundleOf('entry-abc')), ORIGIN)).toBe('build')
    expect(routeOf(req('/assets/icon.png'), ORIGIN)).toBe('build')
  })

  /** Reads of training data are not the shell's: a stale answer there is a wrong one. */
  test('the API, a write, another origin and anything else go to the network', () => {
    expect(routeOf(req('/api/sessions'), ORIGIN)).toBe('network')
    expect(routeOf(req('/api/media/x', 'navigate'), ORIGIN)).toBe('network')
    expect(routeOf(req('/', 'navigate', 'POST'), ORIGIN)).toBe('network')
    expect(routeOf(req('/', 'navigate', 'GET', 'https://youtube.com'), ORIGIN)).toBe('network')
    expect(routeOf(req('/manifest.webmanifest'), ORIGIN)).toBe('network')
  })
})

test('the bundle a document names, and nothing else it links', () => {
  expect(buildAssetsOf(page('entry-abc'))).toEqual([bundleOf('entry-abc')])
})

describe('opening the app', () => {
  test('installing keeps the document and its bundle', async () => {
    const { cache, shell } = device('entry-1')
    await precache(shell)
    expect([...cache.entries.keys()].toSorted()).toEqual(['/', bundleOf('entry-1')].toSorted())
  })

  test('without a signal, it opens from what was kept', async () => {
    const { net, shell } = device('entry-1')
    await precache(shell)
    net.state.up = false

    const opened = respond('shell', '/today', shell)
    expect(await (await opened.response).text()).toContain(bundleOf('entry-1'))
    await opened.done
    const bundle = respond('build', bundleOf('entry-1'), shell)
    expect(await (await bundle.response).text()).toBe('// entry-1')
  })

  /** Instantly, from the copy — and the network's answer is kept for the next time. */
  test('a new deployment is picked up one opening later, its bundle ready', async () => {
    const { net, cache, shell } = device('entry-1')
    await precache(shell)
    net.state.bundle = 'entry-2'

    const opened = respond('shell', '/', shell)
    expect(await (await opened.response).text()).toContain('entry-1')
    await opened.done
    expect(cache.entries.get('/')).toContain('entry-2')
    expect(cache.entries.has(bundleOf('entry-2'))).toBe(true)
  })

  /**
   * The page still open on the old document asks for the old bundle after the new one is kept —
   * the image no longer serves it. So the generation before is kept too, and only the one before
   * that goes.
   */
  test('keeps the bundle of the document before, and drops the one before that', async () => {
    const { net, cache, shell } = device('entry-1')
    await precache(shell)
    for (const next of ['entry-2', 'entry-3']) {
      net.state.bundle = next
      // oxlint-disable-next-line no-await-in-loop -- one deployment after another.
      await respond('shell', '/', shell).done
    }
    expect(cache.entries.has(bundleOf('entry-1'))).toBe(false)
    expect(cache.entries.has(bundleOf('entry-2'))).toBe(true)
    expect(cache.entries.has(bundleOf('entry-3'))).toBe(true)
  })

  /**
   * Two openings at once — two tabs — both served the kept document, each refresh finishing after
   * another deployment: the second's "before" is the first's new document, not what either page was
   * served. Dropping that bundle leaves both pages asking for a file the image no longer has.
   */
  test('two openings at once never drop the bundle either was served', async () => {
    const { net, cache, shell } = device('entry-1')
    await precache(shell)
    const answers: ((bundle: string) => void)[] = []
    const slow: Shell = {
      ...shell,
      fetch: async (path) =>
        path === '/'
          ? await new Promise<Response>((resolve) => {
              answers.push((bundle) => {
                resolve(new Response(page(bundle)))
              })
            })
          : await net.fetch(path),
    }
    const first = respond('shell', '/', slow)
    const second = respond('shell', '/', slow)
    expect(await (await first.response).text()).toContain('entry-1')
    expect(await (await second.response).text()).toContain('entry-1')

    net.state.bundle = 'entry-2'
    answers[0]?.('entry-2')
    await first.done
    net.state.bundle = 'entry-3'
    answers[1]?.('entry-3')
    await second.done
    expect(cache.entries.has(bundleOf('entry-1'))).toBe(true)
  })

  /** A cache that cannot be read is no reason to fail an opening the network can answer. */
  test('a cache that cannot be read falls back to the network', async () => {
    const { shell } = device('entry-1')
    const broken: Shell = {
      ...shell,
      store: async () => await Promise.reject(new Error('QuotaExceededError')),
    }
    const opened = respond('shell', '/', broken)
    expect(await (await opened.response).text()).toContain('entry-1')
  })

  test('the first opening, with nothing kept, is the network’s, and is kept', async () => {
    const { cache, shell } = device('entry-1')
    const opened = respond('shell', '/', shell)
    expect(await (await opened.response).text()).toContain('entry-1')
    await opened.done
    expect(cache.entries.get('/')).toContain('entry-1')
  })

  /** A proxy's 502 while the app container restarts is not the app. */
  test('an error page never replaces the document kept', async () => {
    const { cache, shell } = device('entry-1')
    await precache(shell)
    const failing: Shell = {
      ...shell,
      fetch: async () => new Response('Bad gateway', { status: 502 }),
    }
    await respond('shell', '/', failing).done
    expect(cache.entries.get('/')).toContain('entry-1')
  })

  /** Mid-deployment, the new document can be served before its bundle is: keep the one that boots. */
  test('a document whose bundle cannot be fetched never replaces the one kept', async () => {
    const { cache, shell } = device('entry-1')
    await precache(shell)
    const halfDeployed: Shell = {
      ...shell,
      fetch: async (path) =>
        path.startsWith('/_expo/static/')
          ? new Response('Not found', { status: 404 })
          : new Response(page('entry-2')),
    }
    await respond('shell', '/', halfDeployed).done
    expect(cache.entries.get('/')).toContain('entry-1')
  })

  test('build output is fetched once, and a missing file is not kept', async () => {
    const { net, cache, shell } = device('entry-1')
    await respond('build', '/assets/icon.png', shell).done
    await respond('build', '/assets/icon.png', shell).done
    expect(net.state.fetched.filter((p) => p === '/assets/icon.png')).toHaveLength(1)
    const missing = respond('build', bundleOf('entry-gone'), shell)
    expect((await missing.response).status).toBe(404)
    expect(cache.entries.has(bundleOf('entry-gone'))).toBe(false)
  })
})
