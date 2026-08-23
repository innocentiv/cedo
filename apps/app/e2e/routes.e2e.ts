import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  E2E_STARTUP_TIMEOUT_MS,
  E2E_TIMEOUT_MS,
  type Page,
  sharedApi,
  stopSharedApi,
  withApp,
} from './harness.ts'

/**
 * Every route renders, and nothing explodes.
 *
 * There are almost no assertions here on purpose. `withApp` fails the run on ANY console error and
 * always writes a screenshot, so a broken render, a failed request, an unhandled rejection or a
 * `ContractDriftError` fails this file without anyone having predicted it.
 * See docs/10-testing.md.
 */

const PASSWORD = 'e2e-password'

// Started here rather than lazily inside the first test, so migrating and seeding is not charged
// to whichever journey happens to run first.
beforeAll(async () => {
  await sharedApi()
}, E2E_STARTUP_TIMEOUT_MS)

afterAll(async () => {
  await stopSharedApi()
})

async function register(page: Page, username: string): Promise<void> {
  await page.goto('/register')
  await page.waitFor('register-username')
  await page.fill('register-username', username)
  await page.fill('register-display-name', username)
  await page.fill('register-password', PASSWORD)
  await page.click('[data-testid="register-submit"]')
  await page.waitFor('today-screen')
}

test(
  'an anonymous visitor lands on the login screen',
  async () => {
    await withApp('anonymous-login', async (page) => {
      await page.goto('/')
      await page.waitFor('login-screen')
      expect(await page.exists('error-boundary')).toBe(false)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'registering signs you in and lands on Today',
  async () => {
    await withApp('register', async (page) => {
      await register(page, `e2e${Date.now().toString(36)}`)
      expect(await page.text('today-screen')).toContain('Today')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'every signed-in route renders without a console error',
  async () => {
    await withApp('route-sweep', async (page) => {
      await register(page, `sweep${Date.now().toString(36)}`)
      for (const route of ['/today', '/workouts', '/exercises', '/settings']) {
        await page.goto(route)
        const id = `${route.slice(1)}-screen`
        await page.waitFor(id)
        expect(await page.exists('error-boundary')).toBe(false)
      }
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'the shell is a sidebar at tablet width',
  async () => {
    await withApp(
      'tablet-shell',
      async (page) => {
        await register(page, `tab${Date.now().toString(36)}`)
        await page.goto('/today')
        await page.waitFor('shell-tablet')
      },
      { layout: 'tablet' },
    )
  },
  E2E_TIMEOUT_MS,
)

test(
  'signing out returns to login',
  async () => {
    await withApp('sign-out', async (page) => {
      await register(page, `out${Date.now().toString(36)}`)
      await page.goto('/settings')
      await page.waitFor('sign-out')
      await page.click('[data-testid="sign-out"]')
      await page.waitFor('login-screen')
    })
  },
  E2E_TIMEOUT_MS,
)
