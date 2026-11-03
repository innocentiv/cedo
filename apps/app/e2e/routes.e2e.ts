import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  E2E_STARTUP_TIMEOUT_MS,
  E2E_TIMEOUT_MS,
  sharedApi,
  stopSharedApi,
  withApp,
} from './harness.ts'
import { auth, unique } from './screens/auth.ts'

/**
 * Every route renders, and nothing explodes.
 *
 * There are almost no assertions here on purpose. `withApp` fails the run on ANY console error and
 * always writes a screenshot, so a broken render, a failed request, an unhandled rejection or a
 * `ContractDriftError` fails this file without anyone having predicted it.
 * See docs/10-testing.md.
 */

/**
 * Every route a signed-in user can reach without an id. Detail routes need real data and are
 * covered by the journeys in `journeys.e2e.ts` instead.
 */
const ROUTES: readonly (readonly [string, string])[] = [
  ['/today', 'today-screen'],
  ['/workouts', 'workouts-screen'],
  ['/exercises', 'exercises-screen'],
  ['/exercises/new', 'exercise-new-screen'],
  ['/progress', 'progress-screen'],
  // Reachable by its address even with nobody sharing: it says so.
  ['/athletes', 'athletes-screen'],
  ['/settings', 'settings-screen'],
  ['/settings/groups', 'groups-screen'],
  ['/settings/tokens', 'tokens-screen'],
  ['/settings/connect', 'connect-screen'],
]

// Started here rather than lazily inside the first test, so migrating and seeding is not charged
// to whichever journey happens to run first.
beforeAll(async () => {
  await sharedApi()
}, E2E_STARTUP_TIMEOUT_MS)

afterAll(async () => {
  await stopSharedApi()
})

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
      await auth(page).register(unique('e2e'))
      // Headed by the day itself (#61): the tab says Today. Its form, not a date — the page tells
      // the day by the device's clock, and the test process runs in UTC.
      expect(await page.text('today-heading')).toMatch(
        /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day \d{1,2} [A-Z][a-z]+$/u,
      )
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'every signed-in route renders without a console error',
  async () => {
    await withApp('route-sweep', async (page) => {
      await auth(page).register(unique('sweep'))
      for (const [route, id] of ROUTES) {
        await page.goto(route)
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
        await auth(page).register(unique('tab'))
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
      await auth(page).register(unique('out'))
      await page.goto('/settings')
      await page.waitFor('sign-out')
      await page.click('[data-testid="sign-out"]')
      await page.waitFor('login-screen')
    })
  },
  E2E_TIMEOUT_MS,
)
