import { join } from 'node:path'
import type { User } from '@cedo/contract'
import { type ApiClient, createApi } from '../src/api/client.ts'
import { transport } from '../src/api/transport.ts'
import { type StaticServer, serveExport } from './server.ts'

/**
 * The end-to-end harness. See docs/10-testing.md for what belongs here and what does not.
 *
 * These are NOT behaviour tests — behaviour is proven in the API suite. They answer three
 * questions: does every route render, does anything explode, and what does it look like.
 *
 * The API is started as a SUBPROCESS rather than imported. `apps/app` may never import from
 * `apps/api`, not even a type, and a test helper is not an exemption — the two meet over HTTP here
 * exactly as they do in production. See docs/01-architecture.md.
 */

const ROOT = join(import.meta.dir, '..', '..', '..')
const DIST = join(ROOT, 'apps', 'app', 'dist')
const ARTIFACTS = join(ROOT, '.artifacts')

const TEST_DATABASE_URL =
  Bun.env['E2E_DATABASE_URL'] ??
  (Bun.env['TEST_DATABASE_URL'] ?? 'postgres://cedo:cedo@localhost:55433/cedo_test').replace(
    /\/[^/]*$/u,
    '/cedo_test_e2e',
  )

/**
 * Inherited variables that would silently redirect the API to a different database.
 *
 * `port` is optional because the database-preparation step never listens, and `env.ts` refuses to
 * boot on PORT=0 — correctly, since 0 is not a port anyone can be told to connect to.
 */
function childEnv(port?: number): Record<string, string> {
  const inherited = { ...process.env } as Record<string, string>
  delete inherited['BUN_TEST_WORKER_ID']
  delete inherited['CEDO_PERF']
  return {
    ...inherited,
    NODE_ENV: 'test',
    TEST_DATABASE_URL,
    ...(port === undefined ? {} : { PORT: String(port) }),
    UPLOAD_DIR: join(ARTIFACTS, 'e2e-uploads'),
  }
}

/**
 * Bind to port 0, read what the OS gave us, release it. A short race, but the alternative is a
 * hardcoded port that collides with whatever else the machine is running.
 */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
  // `port` is optional in the types because a unix-socket server has none; this one is TCP.
  const port = Number(probe.url.port)
  probe.stop(true)
  await Bun.sleep(0)
  if (!Number.isInteger(port) || port === 0)
    throw new Error('Could not reserve a port for the API.')
  return port
}

async function waitForHealth(url: string, process: Bun.Subprocess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`The API exited with ${process.exitCode} before becoming healthy.`)
    }
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {
      // Not listening yet. The deadline is the only thing that ends this loop.
    }
    await Bun.sleep(200)
  }
  throw new Error(`The API at ${url} did not become healthy within 30s.`)
}

/** The API process the run shares. */
export interface ApiServer {
  readonly url: string
  stop: () => void
}

let shared: Promise<ApiServer> | undefined

/**
 * How long a journey may take. Bun's default is five seconds, which is less than the API needs to
 * migrate and seed — so without this the FIRST test fails on a timeout and bun then reaps the API
 * as a dangling process, making every later test fail with a connection refused. The real cause
 * scrolls away and the symptom points at the proxy.
 */
export const E2E_TIMEOUT_MS = 60_000
export const E2E_STARTUP_TIMEOUT_MS = 120_000

/** Releases the shared API. Call from `afterAll`, so bun never has to reap it. */
export async function stopSharedApi(): Promise<void> {
  if (shared === undefined) return
  const api = await shared
  api.stop()
  shared = undefined
}

/**
 * One API for the whole run. Starting it per test would pay migrations and seeding each time, and
 * seeding is deliberately idempotent rather than fast.
 */
export async function sharedApi(): Promise<ApiServer> {
  shared ??= (async () => {
    const prepare = Bun.spawn(['bun', 'run', 'apps/api/src/db/prepare-test-db.ts'], {
      cwd: ROOT,
      env: childEnv(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if ((await prepare.exited) !== 0) {
      throw new Error(
        `Could not prepare the e2e database:\n${await new Response(prepare.stderr).text()}`,
      )
    }

    const port = await freePort()
    const server = Bun.spawn(['bun', 'run', 'apps/api/src/index.ts'], {
      cwd: ROOT,
      env: childEnv(port),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const url = `http://127.0.0.1:${port}`
    await waitForHealth(url, server)

    return { url, stop: () => server.kill() }
  })()
  return await shared
}

/**
 * The API as whoever holds `token` — or as nobody — called from the TEST process with the app's own
 * client: every response parsed by the contract, and awaited, so a fixture has finished when it
 * returns. Fixtures used to be `fetch`es evaluated inside the page: untyped, ids spliced into
 * template strings, and one of them fired and forgotten, behind a sleep.
 */
async function clientAs(token: string | null): Promise<ApiClient> {
  const { url } = await sharedApi()
  return createApi(transport({ baseUrl: () => url, token: () => token }))
}

/** A second person — a coach, a training partner — signed up over HTTP, with a client acting as them. */
export async function signUp(
  username: string,
): Promise<{ readonly user: User; readonly api: ApiClient }> {
  const created = await (
    await clientAs(null)
  ).auth.register({ username, displayName: username, password: `${username}-password` })
  return { user: created.user, api: await clientAs(created.token) }
}

/** How long a wait may take before it fails, unless it says otherwise. */
const WAIT_MS = 8000

/** A wait that ran out — told apart so a caller rewraps only that, never an error from the read. */
class WaitTimeout extends Error {}

/**
 * Reads `read` until `done` holds, and returns that value; fails after `withinMs` with the last
 * value seen. The one way to wait for something with no event of its own — a refetch, a re-render,
 * a row appearing. A fixed sleep either races it or wastes the run, so journeys never sleep.
 */
async function until<T, U extends T>(
  read: () => Promise<T>,
  done: (value: T) => value is U,
  withinMs?: number,
): Promise<U>
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  withinMs?: number,
): Promise<T>
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  withinMs = WAIT_MS,
): Promise<T> {
  const deadline = Date.now() + withinMs
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- polling: each read must follow the last.
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) {
      throw new WaitTimeout(`Still waiting after ${withinMs}ms; last saw ${JSON.stringify(value)}`)
    }
    // oxlint-disable-next-line no-await-in-loop -- polling: each read must follow the last.
    await Bun.sleep(100)
  }
}

export interface Page {
  /** Navigate to an app route and wait for it to settle. */
  readonly goto: (path: string) => Promise<void>
  readonly click: (selector: string) => Promise<void>
  readonly type: (text: string) => Promise<void>
  /** One key, such as `Backspace` — for emptying a field the way a thumb does, not by select-all. */
  readonly press: (key: string) => Promise<void>
  /**
   * Keys one at a time, the way a thumb types, into whatever has focus — a character, or
   * `Backspace`. Never re-click a focused field to continue: the click moves the caret to where it
   * landed.
   */
  readonly keys: (keys: readonly string[]) => Promise<void>
  readonly fill: (testId: string, text: string) => Promise<void>
  /** What an input holds right now — what the thumb sees, not what the app parsed. */
  readonly value: (testId: string) => Promise<unknown>
  readonly text: (testId: string) => Promise<string | null>
  readonly exists: (testId: string) => Promise<boolean>
  /**
   * Whether any element with this test id is SHOWN. Not `exists`: a tab keeps its stack mounted, so
   * a screen left behind — a form that saved, a session in another tab — is still in the page.
   */
  readonly shown: (testId: string) => Promise<boolean>
  /** Wait until a test id is present, or fail with what was on screen instead. */
  readonly waitFor: (testId: string, timeoutMs?: number) => Promise<void>
  /**
   * Wait for any element matching a CSS selector, and return its test id.
   *
   * Needed for anything whose id is not known ahead of time — a row in a list that has just been
   * fetched. Waiting is the point: without it a test reads the DOM before the query resolves and
   * fails for a reason that has nothing to do with what it is testing.
   */
  readonly waitForSelector: (css: string, timeoutMs?: number) => Promise<string>
  readonly until: typeof until
  readonly evaluate: (script: string) => Promise<unknown>
  /** The API as the page's signed-in user, from the test process — for setting up their data. */
  readonly client: () => Promise<ApiClient>
  /** Where the app is served — the site, through which `/api` is proxied. */
  readonly origin: string
  /**
   * Takes the site down, app and API alike, as a lost signal does: nothing answers from here on,
   * except what the page's service worker kept.
   */
  readonly cutNetwork: () => void
  readonly errors: readonly string[]
}

export interface RunOptions {
  readonly layout?: 'phone' | 'tablet'
  /**
   * Console errors this journey EXPECTS — a read it deliberately makes fail, such as a plan the
   * user has just lost access to. Each pattern must match at least one error, or the run fails:
   * an allowance that never fires is a test that no longer exercises what it claims to.
   */
  readonly allowErrors?: readonly RegExp[]
}

const SIZE = { phone: { width: 420, height: 900 }, tablet: { width: 1280, height: 900 } } as const

/**
 * Runs one journey.
 *
 * A screenshot is ALWAYS written, pass or fail, and any captured console error fails the run — so a
 * broken render, a failed fetch, an unhandled rejection or a `ContractDriftError` is caught without
 * a single hand-written assertion.
 */
export async function withApp(
  name: string,
  journey: (page: Page) => Promise<void>,
  options: RunOptions = {},
): Promise<void> {
  const api = await sharedApi()
  const site = serveExport(DIST, api.url)
  const size = SIZE[options.layout ?? 'phone']

  const errors: string[] = []
  const view = new Bun.WebView({
    ...size,
    console: (type: string, ...args: unknown[]) => {
      const line = args.map(String).join(' ')
      if (type === 'error') errors.push(line)
    },
  })

  const page = makePage(view, site, errors)

  try {
    await journey(page)
  } finally {
    await Bun.write(join(ARTIFACTS, `${name}.png`), await view.screenshot())
    view.close()
    site.stop()
  }

  const allowed = options.allowErrors ?? []
  const unexpected = errors.filter((e) => !allowed.some((pattern) => pattern.test(e)))
  if (unexpected.length > 0) {
    throw new Error(`Console errors during "${name}":\n  ${unexpected.join('\n  ')}`)
  }
  const unused = allowed.filter((pattern) => !errors.some((e) => pattern.test(e)))
  if (unused.length > 0) {
    throw new Error(`Expected console errors never happened during "${name}": ${unused.join(', ')}`)
  }
}

function makePage(view: Bun.WebView, site: StaticServer, errors: string[]): Page {
  const siteUrl = site.url
  const quote = (value: string) => JSON.stringify(value)
  const selector = (testId: string) => `[data-testid=${quote(testId)}]`

  /**
   * Scrolls a target into view before touching it.
   *
   * WebView refuses to click something that is not on screen ("not actionable"), and a real form is
   * taller than a 420x900 phone — so without this a test fails on the geometry of the viewport
   * rather than on anything about the app.
   */
  const reveal = async (css: string): Promise<void> => {
    await view.evaluate(
      `document.querySelector(${quote(css)})?.scrollIntoView({ block: 'center' })`,
    )
    await Bun.sleep(120)
  }

  const page: Page = {
    goto: async (path) => {
      await view.navigate(`${siteUrl}${path}`)
      // The router hydrates and the first queries resolve; there is no load event for that.
      await Bun.sleep(700)
    },
    click: async (css) => {
      await reveal(css)
      await view.click(css)
      await Bun.sleep(250)
    },
    type: async (text) => {
      await view.type(text)
    },
    press: async (key) => {
      await view.press(key)
    },
    keys: async (keys) => {
      for (const key of keys) {
        // oxlint-disable-next-line no-await-in-loop -- one key at a time is what is under test.
        if (key === 'Backspace') await view.press(key)
        // oxlint-disable-next-line no-await-in-loop -- one key at a time is what is under test.
        else await view.type(key)
      }
    },
    value: async (testId) =>
      await view.evaluate(`document.querySelector(${quote(selector(testId))}).value`),
    fill: async (testId, text) => {
      await reveal(selector(testId))
      await view.click(selector(testId))
      // Selected first, so `fill` REPLACES rather than appends. A prefilled field is the normal
      // case here — prescribed reps, a target weight — and appending silently logs 88 for 8.
      await view.evaluate(
        `(() => { const el = document.activeElement; if (el && 'select' in el) el.select() })()`,
      )
      await view.type(text)
    },
    text: async (testId) => {
      const value = await view.evaluate(
        `document.querySelector(${quote(selector(testId))})?.textContent ?? null`,
      )
      return typeof value === 'string' ? value : null
    },
    exists: async (testId) =>
      (await view.evaluate(`!!document.querySelector(${quote(selector(testId))})`)) === true,
    shown: async (testId) =>
      (await view.evaluate(
        `[...document.querySelectorAll(${quote(selector(testId))})].some((e) => e.offsetParent != null)`,
      )) === true,
    until,
    waitFor: async (testId, timeoutMs = WAIT_MS) => {
      try {
        await until(
          async () => await page.exists(testId),
          (shown) => shown,
          timeoutMs,
        )
      } catch (error) {
        if (!(error instanceof WaitTimeout)) throw error
        const seen = await view
          .evaluate(
            `Array.from(document.querySelectorAll('[data-testid]')).map(e => e.getAttribute('data-testid')).join(', ')`,
          )
          .catch(() => '(the page could not be read)')
        throw new Error(
          `Timed out waiting for "${testId}". On screen: ${String(seen)}\n` +
            (errors.length > 0 ? `Console errors so far:\n  ${errors.join('\n  ')}` : ''),
          { cause: error },
        )
      }
    },
    waitForSelector: async (css, timeoutMs = WAIT_MS) => {
      const read = `document.querySelector(${quote(css)})?.getAttribute('data-testid') ?? null`
      try {
        return await until(
          async () => await view.evaluate(read),
          (id): id is string => typeof id === 'string',
          timeoutMs,
        )
      } catch (error) {
        if (!(error instanceof WaitTimeout)) throw error
        throw new Error(`Timed out waiting for an element matching ${css}.`, { cause: error })
      }
    },
    evaluate: async (script) => await view.evaluate(script),
    client: async () => {
      // The key `src/auth/token-storage.ts` writes on web — not imported, because that module
      // brings `react-native` with it. Read, never written: the app owns its session.
      const token = await view.evaluate(`localStorage.getItem('cedo.session')`)
      if (typeof token !== 'string') throw new Error('No signed-in session in the page')
      return await clientAs(token)
    },
    origin: siteUrl,
    cutNetwork: () => {
      site.stop()
    },
    get errors() {
      return errors
    },
  }
  return page
}
