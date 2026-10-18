import { afterAll, beforeAll, expect, test } from 'bun:test'
import { ExerciseCreate, type TrackingMode, WorkoutPlanInput } from '@cedo/contract'
import {
  E2E_STARTUP_TIMEOUT_MS,
  E2E_TIMEOUT_MS,
  type Page,
  sharedApi,
  signUp,
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

/**
 * Builds a one-day plan around a seeded bench press and opens it in the editor. From the shared
 * library, so no exercise has to be created first.
 */
async function openNewPlan(page: Page, exercise = 'Bench'): Promise<string> {
  await page.goto('/workouts')
  await page.waitFor('workouts-screen')
  await page.fill('workout-name', 'Push Day')
  await page.click('[data-testid="create-workout"]')

  await page.waitFor('plan-edit-screen')
  await page.click('[data-testid="add-day"]')
  await page.waitFor('plan-day-0')
  await page.click('[data-testid="add-entry-0"]')

  await page.waitFor('exercise-picker')
  await page.fill('picker-search', exercise)
  const picked = await page.waitForSelector('[data-testid^="picker-row-"]')
  await page.click(`[data-testid="${picked}"]`)
  await page.waitFor('plan-entry-0-0')
  return picked.replace('picker-row-', '')
}

/** Saves the plan in the editor and starts its first day. */
async function saveAndStart(page: Page): Promise<void> {
  await page.click('[data-testid="save-plan"]')
  // Saving returns to wherever the editor was opened from — the list, since a new plan goes
  // straight into the editor. Open the plan itself to start a day.
  await page.waitFor('workouts-screen')
  await page.click('[data-testid^="workout-row-"]')
  await page.waitFor('workout-detail-screen')
  await page.click('[data-testid="start-day-0"]')
  await page.waitFor('session-screen')
}

/**
 * The rendered lines of every logged set, newest last. `innerText`, not `textContent`: the latter
 * runs "Set 1" into "8 × 60 kg" as "Set 18 × 60 kg", and a `toContain('8 × 60 kg')` over that also
 * passes for 88 reps — the very bug the assertion existed to catch.
 */
async function loggedLines(page: Page): Promise<string[]> {
  const text = await page.evaluate(
    `[...document.querySelectorAll('[data-testid^="logged-set-"]')].map((e) => e.innerText).join('\\n')`,
  )
  return typeof text === 'string' ? text.split('\n').map((line) => line.trim()) : []
}

/**
 * A screen's text once it satisfies `done`, polled for at most `withinMs` — far inside the 30-second
 * `staleTime`, so it cannot pass by waiting the cache out. For a background refetch, which has no
 * event to wait on: a fixed sleep either races it or wastes the run.
 */
async function textOnceSettled(
  page: Page,
  testId: string,
  done: (text: string) => boolean,
  withinMs = 3000,
): Promise<string> {
  const deadline = Date.now() + withinMs
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- polling: each read must follow the last.
    const text = (await page.text(testId)) ?? ''
    if (done(text) || Date.now() > deadline) return text
    // oxlint-disable-next-line no-await-in-loop -- polling: each read must follow the last.
    await Bun.sleep(100)
  }
}

/**
 * Types one key at a time, the way a thumb does, into whatever has focus. Never re-click a field
 * that is already focused to continue typing: the click moves the caret to where it landed.
 */
async function typeKeys(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    if (key === 'Backspace') await page.press(key)
    else await page.type(key)
  }
}

test(
  'a plan can be built, started, and a set logged against it',
  async () => {
    await withApp('log-a-set', async (page) => {
      await register(page, unique('log'))
      await openNewPlan(page)
      await saveAndStart(page)

      await page.fill('log-entry-0-weight', '60')
      await page.fill('log-entry-0-reps', '8')
      await page.click('[data-testid="log-entry-0-log"]')

      await page.waitFor('session-logs')
      // The prescribed value is REPLACED, not appended to: 8 reps, not 88. An exact line, because
      // a substring match cannot tell the two apart.
      expect(await loggedLines(page)).toContain('8 × 60 kg')

      await page.click('[data-testid="finish-session"]')
      await page.waitFor('workout-detail-screen')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a decimal weight typed key by key is logged exactly — with a point or a comma',
  async () => {
    await withApp('log-a-decimal', async (page) => {
      await register(page, unique('dec'))
      await openNewPlan(page)
      await saveAndStart(page)

      // `fill` would insert "62.5" in one event and never pass through the half-typed "62." that
      // used to collapse to 62 under the cursor, turning the next "5" into 625 kg.
      await page.fill('log-entry-0-weight', '6')
      await typeKeys(page, ['2', '.', '5'])
      await page.click('[data-testid="log-entry-0-log"]')
      await page.waitFor('session-logs')

      // A comma is the decimal separator on an Italian, German or French keypad.
      await page.fill('log-entry-0-weight', '7')
      await typeKeys(page, ['0', ',', '5'])
      await page.click('[data-testid="log-entry-0-log"]')

      const lines = await loggedLines(page)
      expect(lines.some((l) => l.endsWith('× 62.5 kg'))).toBe(true)
      expect(lines.some((l) => l.endsWith('× 70.5 kg'))).toBe(true)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  "a logged set shows in the exercise's history straight away, not 30 seconds later",
  async () => {
    await withApp('history-after-log', async (page) => {
      await register(page, unique('hist'))
      const exerciseId = await openNewPlan(page)
      await page.click('[data-testid="save-plan"]')
      await page.waitFor('workouts-screen')

      // Seen once before logging, so the (empty) history is cached.
      await page.goto(`/exercises/${exerciseId}`)
      await page.waitFor('exercise-history')
      expect(await page.text('exercise-history')).toContain('Nothing logged yet')

      // Tabs, not `goto`: a navigation reloads the page and would empty the cache under test.
      await page.click('[data-testid="nav-workouts"]')
      await page.waitFor('workouts-screen')
      await page.click('[data-testid^="workout-row-"]')
      await page.waitFor('workout-detail-screen')
      await page.click('[data-testid="start-day-0"]')
      await page.waitFor('session-screen')
      await page.fill('log-entry-0-weight', '60')
      await page.click('[data-testid="log-entry-0-log"]')
      await page.waitFor('session-logs')

      // The tab keeps its stack, so this returns to the very detail screen seen above — still
      // mounted, holding the history it fetched before the set existed.
      await page.click('[data-testid="nav-exercises"]')
      await page.waitFor('exercise-detail-screen')
      const history = await textOnceSettled(
        page,
        'exercise-history',
        (text) => !text.includes('Nothing logged yet'),
      )
      expect(history).not.toContain('Nothing logged yet')
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Regression: a write invalidated only its own resource, so a plan — which carries each entry's
 * whole exercise — kept the old name for the 30-second `staleTime` after the exercise was renamed.
 * The same missing link left progression and an open session stale. See `READS` in the contract.
 */
test(
  'renaming an exercise shows in a plan already open, not 30 seconds later',
  async () => {
    await withApp('rename-in-plan', async (page) => {
      await register(page, unique('ren'))
      const before = unique('Cable Fly ')
      const after = unique('Pec Deck ')

      await page.goto('/exercises/new')
      await page.waitFor('exercise-new-screen')
      await page.fill('exercise-name', before)
      await page.click('[data-testid="muscle-option-pectoralis_major"]')
      await page.fill('muscle-load-pectoralis_major', '100')
      await page.click('[data-testid="exercise-new-screen-save"]')
      // Saving goes back to where the form was opened from: Today, where registering lands.
      await page.waitFor('today-screen')

      await openNewPlan(page, before)
      await page.click('[data-testid="save-plan"]')
      await page.waitFor('workouts-screen')
      await page.click('[data-testid^="workout-row-"]')
      await page.waitFor('workout-detail-screen')
      expect(await page.text('workout-detail-screen')).toContain(before)

      // Tabs, not `goto`: a navigation reloads the page and would empty the cache under test.
      await page.click('[data-testid="nav-exercises"]')
      await page.waitFor('exercises-screen')
      await page.fill('exercise-search', before)
      const row = await page.waitForSelector('[data-testid^="exercise-row-"]')
      await page.click(`[data-testid="${row}"]`)
      await page.waitFor('exercise-detail-screen')
      await page.click('[data-testid="edit-exercise"]')
      await page.waitFor('exercise-edit-screen')
      await page.fill('exercise-name', after)
      await page.click('[data-testid="exercise-edit-screen-save"]')
      await page.waitFor('exercise-detail-screen')

      // The tab keeps its stack: back to the very plan seen above, cached before the rename.
      await page.click('[data-testid="nav-workouts"]')
      await page.waitFor('workout-detail-screen')
      const plan = await textOnceSettled(page, 'workout-detail-screen', (text) =>
        text.includes(after),
      )
      expect(plan).toContain(after)
      expect(plan).not.toContain(before)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'losing access to a group plan does not hide your own session, or the way to finish it',
  async () => {
    const athlete = unique('ath')
    await withApp(
      'session-after-losing-plan',
      async (page) => {
        await register(page, athlete)

        // A coach shares a plan through a group with the athlete in it.
        const coach = await signUp(`${athlete}c`)
        const squad = await coach.api.groups.create({ name: 'Squad' })
        await coach.api.groups.addMember(squad.id, { username: athlete, role: 'reader' })
        const [squat] = (await coach.api.exercises.list({ q: 'Back Squat', limit: 1 })).items
        if (squat === undefined) throw new Error('The seeded library has no Back Squat')
        const plan = await coach.api.workouts.create({ name: 'Coached', notes: null })
        await coach.api.workouts.replacePlan(
          plan.id,
          WorkoutPlanInput.parse({
            days: [
              { name: 'Legs', entries: [{ exerciseId: squat.id, sets: [{ targetReps: 5 }] }] },
            ],
          }),
        )
        await coach.api.workouts.transfer(plan.id, { toGroupId: squad.id })
        const { user: me } = await (await page.client()).auth.me()

        // The athlete trains from it.
        await page.goto('/workouts')
        await page.click('[data-testid^="workout-row-"]')
        await page.waitFor('workout-detail-screen')
        await page.click('[data-testid="start-day-0"]')
        await page.waitFor('session-screen')
        await page.fill('log-entry-0-weight', '100')
        await page.click('[data-testid="log-entry-0-log"]')
        await page.waitFor('session-logs')
        const sessionPath = String(await page.evaluate('location.pathname'))

        // …and is then removed from the group — finished when this returns, so nothing to wait out.
        await coach.api.groups.removeMember(squad.id, me.id)

        await page.goto(sessionPath)
        await page.waitFor('session-logs')
        expect(await page.exists('finish-session')).toBe(true)
        expect(await page.text('session-screen')).toContain('unavailable')
      },
      { allowErrors: [/No such workout/u] },
    )
  },
  E2E_TIMEOUT_MS,
)

test(
  'undoing a set in the middle and logging again does not reuse its number',
  async () => {
    await withApp('undo-then-log', async (page) => {
      await register(page, unique('undo'))
      await openNewPlan(page)
      await saveAndStart(page)

      const log = async () => {
        await page.fill('log-entry-0-weight', '60')
        await page.click('[data-testid="log-entry-0-log"]')
        await Bun.sleep(300)
      }
      await log()
      await log()
      await log()

      // Undo set 2 — the second row — then log once more.
      const rows = await page.evaluate(
        `[...document.querySelectorAll('[data-testid^="logged-set-"]')].map((e) => e.dataset.testid)`,
      )
      const second = Array.isArray(rows) ? rows[1] : undefined
      if (typeof second !== 'string') throw new Error('expected three logged rows')
      await page.click(`[data-testid="${second}"]`)
      await Bun.sleep(300)
      await log()

      // A count would have numbered the new set 3, beside the existing set 3. Rows read
      // "Barbell Bench Press · set 1": the number is what follows the name.
      const sets = (await loggedLines(page)).flatMap(
        (line) => / · (set \d+)$/u.exec(line)?.[1] ?? [],
      )
      expect(sets).toEqual(['set 1', 'set 3', 'set 4'])
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'the plan editor knows an exercise that is not in the first page of the library',
  async () => {
    await withApp('editor-beyond-first-page', async (page) => {
      await register(page, unique('lib'))

      // 45 seeded + 60 of these puts "Zz Hold" well past the first 100 by name, where the editor
      // used to look exercises up. Created as the page's own user.
      const mine = await page.client()
      const anExercise = (name: string, tracking: TrackingMode, muscle: string) =>
        ExerciseCreate.parse({ name, tracking, muscles: [{ muscle, loadPct: 100 }] })
      for (let i = 0; i < 60; i += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one at a time: the API is shared by the run.
        await mine.exercises.create(
          anExercise(`Filler ${String(i).padStart(2, '0')}`, 'weight_reps', 'quadriceps'),
        )
      }
      await mine.exercises.create(anExercise('Zz Hold', 'duration', 'rectus_abdominis'))

      await page.goto('/workouts')
      await page.waitFor('workouts-screen')
      await page.fill('workout-name', 'Core')
      await page.click('[data-testid="create-workout"]')
      await page.waitFor('plan-edit-screen')
      await page.click('[data-testid="add-day"]')
      await page.click('[data-testid="add-entry-0"]')
      await page.waitFor('exercise-picker')
      await page.fill('picker-search', 'Zz Hold')
      const picked = await page.waitForSelector('[data-testid^="picker-row-"]')
      await page.click(`[data-testid="${picked}"]`)
      await page.waitFor('plan-entry-0-0')

      expect(await page.text('plan-entry-0-0')).toContain('Zz Hold')
      // A duration exercise: Seconds, not weight and reps.
      expect(await page.exists('plan-entry-0-0-duration')).toBe(true)
      expect(await page.exists('plan-entry-0-0-weight')).toBe(false)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'emptying a field and typing a new number does not keep a digit of the old one',
  async () => {
    await withApp('retype-a-field', async (page) => {
      await register(page, unique('retype'))
      await openNewPlan(page)

      // Sets cannot be fewer than one, and the editor used to snap an emptied field back to "1" —
      // so backspace then "4" made 14 sets.
      // A first tap selects the whole field; Backspace empties it, the second is a no-op.
      await page.click('[data-testid="plan-entry-0-0-sets"]')
      await typeKeys(page, ['Backspace', 'Backspace', '4'])
      await page.click('[data-testid="save-plan"]')
      await page.waitFor('workouts-screen')
      await page.click('[data-testid^="workout-row-"]')
      await page.waitFor('workout-detail-screen')

      // "4 sets · …", and not "14 sets · …" — hence the digit boundary.
      expect(await page.text('workout-detail-screen')).toMatch(/(?:^|\D)4 sets · /u)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'the plan editor stops where the schema would, and says why before saving',
  async () => {
    await withApp('plan-limits', async (page) => {
      await register(page, unique('lim'))
      await openNewPlan(page)
      const valueOf = async (testId: string) =>
        await page.evaluate(`document.querySelector('[data-testid="${testId}"]').value`)
      const saveDisabled = async () =>
        await page.evaluate(
          `document.querySelector('[data-testid="save-plan"]').getAttribute('aria-disabled')`,
        )

      // 5 warm-ups, then 20 working sets: an entry may hold 20 sets IN TOTAL, so the working
      // sets get the 15 that are left. The editor used to accept 25 and the save refused them.
      // A numeric field selects its text on focus, so wherever the click lands, Backspace empties
      // it.
      await page.click('[data-testid="plan-entry-0-0-warmups"]')
      await typeKeys(page, ['Backspace', '5'])
      await page.click('[data-testid="plan-entry-0-0-sets"]')
      await typeKeys(page, ['Backspace', '2', '0'])
      await page.click('[data-testid="day-name-0"]')
      expect(await valueOf('plan-entry-0-0-sets')).toBe('15')
      expect(await saveDisabled()).not.toBe('true')

      // A draft the schema would refuse says so in the footer, and cannot be saved. The name field
      // is a plain text input: the click left the caret wherever it landed, so go to the end and
      // delete "Day 1" key by key.
      await page.press('End')
      await typeKeys(page, ['Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace'])
      await page.waitFor('plan-issues')
      expect(await page.text('plan-issues')).toBe('Day 1, name: Cannot be empty')
      expect(await saveDisabled()).toBe('true')

      await typeKeys(page, ['L', 'e', 'g', 's'])
      // Read once the render has caught up with the last key, not in the same tick.
      for (let tries = 0; tries < 40 && (await page.exists('plan-issues')); tries += 1) {
        await Bun.sleep(50)
      }
      expect(await page.exists('plan-issues')).toBe(false)
      expect(await saveDisabled()).not.toBe('true')
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
      await (await page.client()).auth.logout()
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

test(
  'an empty list still leaves its filter chips one row tall',
  async () => {
    await withApp('empty-list-chips', async (page) => {
      await register(page, unique('chip'))

      // "Mine" is empty for a new account: the seeded library belongs to the shared group.
      await page.goto('/exercises')
      await page.waitFor('exercise-scope')
      await page.click('[data-testid="exercise-scope-mine"]')
      await page.waitFor('exercises-empty')

      /**
       * Regression: `Chips` was a horizontal ScrollView, which carries no intrinsic height. With an
       * empty list under it there was space going spare, so three chips took the whole screen.
       */
      const height = await page.evaluate(
        `document.querySelector('[data-testid="exercise-scope"]').getBoundingClientRect().height`,
      )
      expect(typeof height).toBe('number')
      expect(height as number).toBeLessThan(80)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a session without a plan comes back after a reload, logger and all',
  async () => {
    await withApp('adhoc-after-reload', async (page) => {
      await register(page, unique('adhoc'))
      await page.goto('/today')
      await page.waitFor('start-adhoc')
      await page.click('[data-testid="start-adhoc"]')
      await page.waitFor('session-adhoc')

      await page.click('[data-testid="adhoc-add-exercise"]')
      await page.waitFor('exercise-picker')
      await page.fill('picker-search', 'Bench')
      const picked = await page.waitForSelector('[data-testid^="picker-row-"]')
      const exerciseId = picked.replace('picker-row-', '')
      await page.click(`[data-testid="${picked}"]`)
      await page.waitFor(`adhoc-${exerciseId}`)
      await page.fill(`adhoc-${exerciseId}-weight`, '60')
      await page.fill(`adhoc-${exerciseId}-reps`, '8')
      await page.click(`[data-testid="adhoc-${exerciseId}-log"]`)
      await page.waitForSelector('[data-testid^="logged-set-"]')

      // The exercises picked were local state, so a reload used to show an empty session with
      // no way to log the next set until the exercise was picked again. The log names it now.
      await page.goto(String(await page.evaluate('location.pathname')))
      await page.waitFor(`adhoc-${exerciseId}`)
      const lines = (await loggedLines(page)).filter((line) => line.includes(' · set '))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^.*Bench.* · set 1$/u)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'finishing a session reached directly still leaves somewhere to go',
  async () => {
    await withApp('finish-without-history', async (page) => {
      await register(page, unique('back'))

      // Start a session, then navigate to it by URL — a reload, a shared link, or simply coming
      // back to the tab. The router's history is empty, so `router.back()` warned
      // "The action 'GO_BACK' was not handled by any navigator" and did nothing, stranding the user
      // on a finished session.
      await page.goto('/today')
      await page.waitFor('start-adhoc')
      await page.click('[data-testid="start-adhoc"]')
      await page.waitFor('session-screen')

      const sessionPath = String(await page.evaluate('location.pathname'))
      await page.goto(sessionPath)
      await page.waitFor('finish-session')
      await page.click('[data-testid="finish-session"]')

      await page.waitFor('today-screen')
    })
  },
  E2E_TIMEOUT_MS,
)
