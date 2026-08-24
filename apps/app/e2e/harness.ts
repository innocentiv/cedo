import { join } from 'node:path'
import { serveExport } from './server.ts'

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

export interface Api {
  readonly url: string
  stop: () => void
}

let shared: Promise<Api> | undefined

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
export async function sharedApi(): Promise<Api> {
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

export interface Page {
  /** Navigate to an app route and wait for it to settle. */
  readonly goto: (path: string) => Promise<void>
  readonly click: (selector: string) => Promise<void>
  readonly type: (text: string) => Promise<void>
  readonly fill: (testId: string, text: string) => Promise<void>
  readonly text: (testId: string) => Promise<string | null>
  readonly exists: (testId: string) => Promise<boolean>
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
  readonly evaluate: (script: string) => Promise<unknown>
  readonly errors: readonly string[]
}

export interface RunOptions {
  readonly layout?: 'phone' | 'tablet'
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

  const page = makePage(view, site.url, errors)

  try {
    await journey(page)
  } finally {
    await Bun.write(join(ARTIFACTS, `${name}.png`), await view.screenshot())
    view.close()
    site.stop()
  }

  if (errors.length > 0) {
    throw new Error(`Console errors during "${name}":\n  ${errors.join('\n  ')}`)
  }
}

function makePage(view: Bun.WebView, siteUrl: string, errors: string[]): Page {
  const quote = (value: string) => JSON.stringify(value)
  const selector = (testId: string) => `[data-testid=${quote(testId)}]`

  const page: Page = {
    goto: async (path) => {
      await view.navigate(`${siteUrl}${path}`)
      // The router hydrates and the first queries resolve; there is no load event for that.
      await Bun.sleep(700)
    },
    click: async (css) => {
      await view.click(css)
      await Bun.sleep(250)
    },
    type: async (text) => {
      await view.type(text)
    },
    fill: async (testId, text) => {
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
    waitFor: async (testId, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (await page.exists(testId)) return
        await Bun.sleep(150)
      }
      const seen = await view.evaluate(
        `Array.from(document.querySelectorAll('[data-testid]')).map(e => e.getAttribute('data-testid')).join(', ')`,
      )
      throw new Error(
        `Timed out waiting for "${testId}". On screen: ${String(seen)}\n` +
          (errors.length > 0 ? `Console errors so far:\n  ${errors.join('\n  ')}` : ''),
      )
    },
    waitForSelector: async (css, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs
      const read = `document.querySelector(${quote(css)})?.getAttribute('data-testid') ?? null`
      while (Date.now() < deadline) {
        const found = await view.evaluate(read)
        if (typeof found === 'string') return found
        await Bun.sleep(150)
      }
      throw new Error(`Timed out waiting for an element matching ${css}.`)
    },
    evaluate: async (script) => await view.evaluate(script),
    get errors() {
      return errors
    },
  }
  return page
}
