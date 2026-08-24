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
 * The core loop, end to end: build an exercise, put it in a plan, run the plan, log a set.
 *
 * As with the route sweep, `withApp` fails on ANY console error and always writes a screenshot, so
 * these assert only the few things a passing render cannot imply. See docs/10-testing.md.
 */

const PASSWORD = 'e2e-password'
let seq = 0
const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq += 1)}`

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
  'creating an exercise puts it in the library',
  async () => {
    await withApp('create-exercise', async (page) => {
      await register(page, unique('mk'))

      await page.goto('/exercises/new')
      await page.waitFor('exercise-new-screen')
      await page.fill('exercise-name', 'Cable Face Pull')
      // The contract requires loads summing to 100; the form shows the running total.
      await page.click('[data-testid="muscle-option-deltoid_posterior"]')
      await page.fill('muscle-load-deltoid_posterior', '100')
      expect(await page.text('muscle-total')).toContain('100%')
      await page.click('[data-testid="exercise-new-screen-save"]')

      await page.goto('/exercises')
      await page.waitFor('exercise-list')
      expect(await page.text('exercise-list')).toContain('Cable Face Pull')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a muscle load that does not sum to 100 is refused, with the message from the contract',
  async () => {
    await withApp('exercise-validation', async (page) => {
      await register(page, unique('val'))

      await page.goto('/exercises/new')
      await page.waitFor('exercise-new-screen')
      await page.fill('exercise-name', 'Half A Movement')
      await page.click('[data-testid="muscle-option-biceps_brachii"]')
      await page.fill('muscle-load-biceps_brachii', '40')
      await page.click('[data-testid="exercise-new-screen-save"]')

      await page.waitFor('exercise-new-screen-error')
      // The API, the MCP tools and this form all reject it with the same sentence.
      expect(await page.text('exercise-new-screen-error')).toBeTruthy()
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a plan can be built, started, and a set logged against it',
  async () => {
    await withApp('log-a-set', async (page) => {
      await register(page, unique('log'))

      // A plan, from the seeded shared library so no exercise has to be created first.
      await page.goto('/workouts')
      await page.waitFor('workouts-screen')
      await page.fill('workout-name', 'Push Day')
      await page.click('[data-testid="create-workout"]')

      await page.waitFor('plan-edit-screen')
      await page.click('[data-testid="add-day"]')
      await page.waitFor('plan-day-0')
      await page.click('[data-testid="add-entry-0"]')

      await page.waitFor('exercise-picker')
      await page.fill('picker-search', 'Bench')
      const picked = await page.waitForSelector('[data-testid^="picker-row-"]')
      await page.click(`[data-testid="${picked}"]`)

      await page.waitFor('plan-entry-0-0')
      await page.click('[data-testid="save-plan"]')

      // Saving returns to wherever the editor was opened from — the list, since a new plan goes
      // straight into the editor. Open the plan itself to start a day.
      await page.waitFor('workouts-screen')
      await page.click('[data-testid^="workout-row-"]')
      await page.waitFor('workout-detail-screen')
      await page.click('[data-testid="start-day-0"]')

      await page.waitFor('session-screen')
      await page.fill('log-entry-0-weight', '60')
      await page.fill('log-entry-0-reps', '8')
      await page.click('[data-testid="log-entry-0-log"]')

      await page.waitFor('session-logs')
      // The prescribed value is REPLACED, not appended to: 8 reps, not 88.
      expect(await page.text('session-logs')).toContain('8 × 60 kg')

      await page.click('[data-testid="finish-session"]')
      await page.waitFor('workout-detail-screen')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'an access token is shown once, and appears in the list',
  async () => {
    await withApp('access-token', async (page) => {
      await register(page, unique('tok'))

      await page.goto('/settings/tokens')
      await page.waitFor('tokens-screen')
      await page.fill('token-name', 'claude')
      await page.click('[data-testid="create-token"]')

      await page.waitFor('token-secret')
      const secret = await page.text('token-secret')
      expect(secret).toBeTruthy()
      await page.waitFor('token-list')
      expect(await page.text('token-list')).toContain('claude')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a credential revoked mid-session returns you to the login screen',
  async () => {
    await withApp('revoked-token', async (page) => {
      await register(page, unique('rev'))

      /**
       * Revoke the session SERVER-side while the app keeps holding the token, which is what happens
       * when you sign out on another device or a token expires. Then navigate WITHOUT a reload, so
       * the next request carries a credential the server has forgotten.
       *
       * A page reload would prove nothing: the restore-on-startup path already handles a bad stored
       * token, and it is not the path this guards.
       */
      await page.evaluate(
        `fetch('/api/auth/logout', {
           method: 'POST',
           headers: { authorization: 'Bearer ' + localStorage.getItem('cedo.session') },
         })`,
      )
      await page.click('[data-testid="nav-workouts"]')

      await page.waitFor('login-screen')
      expect(await page.exists('error-boundary')).toBe(false)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a shared exercise can be duplicated and the copy edited',
  async () => {
    await withApp('duplicate-exercise', async (page) => {
      await register(page, unique('dup'))

      // The seeded library belongs to the shared `cedo` group, where a new user is a READER — so
      // this is the path the ACL is designed around: copy it, then edit the copy.
      await page.goto('/exercises')
      await page.waitFor('exercise-list')
      const row = await page.waitForSelector('[data-testid^="exercise-row-"]')
      await page.click(`[data-testid="${row}"]`)

      await page.waitFor('exercise-detail-screen')
      await page.waitFor('duplicate-exercise')
      await page.click('[data-testid="duplicate-exercise"]')

      // Lands straight in the editor for the copy, which is the whole point of duplicating.
      await page.waitFor('exercise-edit-screen')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a video link can be attached to an exercise',
  async () => {
    await withApp('attach-media', async (page) => {
      await register(page, unique('med'))

      await page.goto('/exercises/new')
      await page.waitFor('exercise-new-screen')
      await page.fill('exercise-name', 'Face Pull With Video')
      await page.click('[data-testid="muscle-option-deltoid_posterior"]')
      await page.fill('muscle-load-deltoid_posterior', '100')

      await page.fill('media-url', 'https://www.youtube.com/watch?v=rep-etition')
      await page.click('[data-testid="attach-media"]')
      await page.waitForSelector('[data-testid^="media-row-"]')

      await page.click('[data-testid="exercise-new-screen-save"]')
      await page.goto('/exercises')
      await page.waitFor('exercise-list')
      expect(await page.text('exercise-list')).toContain('Face Pull With Video')
    })
  },
  E2E_TIMEOUT_MS,
)
