import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  E2E_STARTUP_TIMEOUT_MS,
  E2E_TIMEOUT_MS,
  sharedApi,
  stopSharedApi,
  withApp,
} from './harness.ts'

/**
 * The harness, tested. Every other e2e test leans on one guarantee — "any console error fails the
 * run" — and a guarantee nobody has watched fail is the worst kind of green: delete the capture
 * shim, or stop a failed read from reaching the console, and every journey still passes while
 * proving nothing. See docs/adr/0017-webview-for-ui-verification.md.
 */

beforeAll(async () => {
  await sharedApi()
}, E2E_STARTUP_TIMEOUT_MS)

afterAll(async () => {
  await stopSharedApi()
})

test(
  'an uncaught exception in the page fails the run',
  async () => {
    // Thrown from a timer, so it is uncaught: only the capture shim can turn it into a console error.
    const run = withApp('harness-uncaught', async (page) => {
      await page.goto('/login')
      await page.evaluate(`setTimeout(() => { throw new Error('shim-probe') }, 0)`)
      await Bun.sleep(300)
    })
    await expect(run).rejects.toThrow('shim-probe')
  },
  E2E_TIMEOUT_MS,
)

test(
  'a read that fails fails the run, though the screen only shows a notice',
  async () => {
    // A screen renders a failed query as an inline notice, and TanStack Query logs nothing, so the
    // route sweep used to pass over a screen whose every request was failing.
    const run = withApp('harness-failed-read', async (page) => {
      await page.goto('/register')
      await page.waitFor('register-username')
      await page.fill('register-username', `probe${Date.now().toString(36)}`)
      await page.fill('register-display-name', 'Probe')
      await page.fill('register-password', 'probe-password')
      await page.click('[data-testid="register-submit"]')
      await page.waitFor('today-screen')
      await page.goto(`/exercises/${crypto.randomUUID()}`)
      await Bun.sleep(500)
    })
    await expect(run).rejects.toThrow('No such exercise')
  },
  E2E_TIMEOUT_MS,
)
