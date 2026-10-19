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
import { auth, unique } from './screens/auth.ts'

/**
 * The core loop, end to end: build an exercise, put it in a plan, run the plan, log a set.
 *
 * As with the route sweep, `withApp` fails on ANY console error and always writes a screenshot, so
 * these assert only the few things a passing render cannot imply. See docs/10-testing.md.
 */

beforeAll(async () => {
  await sharedApi()
}, E2E_STARTUP_TIMEOUT_MS)

afterAll(async () => {
  await stopSharedApi()
})

test(
  'creating an exercise puts it in the library',
  async () => {
    await withApp('create-exercise', async (page) => {
      await auth(page).register(unique('mk'))

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
      await auth(page).register(unique('val'))

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

/** Every logged-set row on screen. */
const LOGGED_SET = '[data-testid^="logged-set-"]'

/** The logged-set rows, in order, by test id. */
async function loggedIds(page: Page): Promise<string[]> {
  const ids = await page.evaluate(
    `[...document.querySelectorAll('${LOGGED_SET}')].map((e) => e.dataset.testid)`,
  )
  if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) {
    throw new Error(`Could not read the logged sets: ${JSON.stringify(ids)}`)
  }
  return ids
}

/**
 * A screen's text once it satisfies `done` — within 3 seconds, far inside the 30-second
 * `staleTime`, so a refetch the app never made cannot pass by waiting the cache out.
 */
async function settledText(
  page: Page,
  testId: string,
  done: (text: string) => boolean,
): Promise<string> {
  return await page.until(async () => (await page.text(testId)) ?? '', done, 3000)
}

/**
 * The rendered lines of every logged set, newest last. `innerText`, not `textContent`: the latter
 * runs "Set 1" into "8 × 60 kg" as "Set 18 × 60 kg", and a `toContain('8 × 60 kg')` over that also
 * passes for 88 reps — the very bug the assertion existed to catch.
 */
async function loggedLines(page: Page): Promise<string[]> {
  const text = await page.evaluate(
    `[...document.querySelectorAll('${LOGGED_SET}')].map((e) => e.innerText).join('\\n')`,
  )
  return typeof text === 'string' ? text.split('\n').map((line) => line.trim()) : []
}

test(
  'a plan can be built, started, and a set logged against it',
  async () => {
    await withApp('log-a-set', async (page) => {
      await auth(page).register(unique('log'))
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
      await auth(page).register(unique('dec'))
      await openNewPlan(page)
      await saveAndStart(page)

      // `fill` would insert "62.5" in one event and never pass through the half-typed "62." that
      // used to collapse to 62 under the cursor, turning the next "5" into 625 kg.
      await page.fill('log-entry-0-weight', '6')
      await page.keys(['2', '.', '5'])
      await page.click('[data-testid="log-entry-0-log"]')
      await page.waitFor('session-logs')

      // A comma is the decimal separator on an Italian, German or French keypad.
      await page.fill('log-entry-0-weight', '7')
      await page.keys(['0', ',', '5'])
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
      await auth(page).register(unique('hist'))
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
      const history = await settledText(
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
      await auth(page).register(unique('ren'))
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
      const plan = await settledText(page, 'workout-detail-screen', (text) => text.includes(after))
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
        await auth(page).register(athlete)

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
        // The squat logged against the lost plan still counts: the session goes on as one without a
        // plan, not with "0 done" above "set 1" and a second "set 1" to come.
        await page.waitFor(`adhoc-${squat.id}-done`)
        expect(await page.text(`adhoc-${squat.id}-done`)).toBe('1 done')
        await page.fill(`adhoc-${squat.id}-weight`, '100')
        await page.fill(`adhoc-${squat.id}-reps`, '5')
        await page.click(`[data-testid="adhoc-${squat.id}-log"]`)
        await page.until(
          async () => await loggedLines(page),
          (lines) => lines.includes('Barbell Back Squat · set 2'),
        )
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
      await auth(page).register(unique('undo'))
      await openNewPlan(page)
      await saveAndStart(page)

      const rows = async () => (await loggedIds(page)).length
      /** Logs a set, and waits until it is a row — the next set is numbered from the refreshed logs. */
      const log = async (expected: number) => {
        await page.fill('log-entry-0-weight', '60')
        await page.click('[data-testid="log-entry-0-log"]')
        await page.until(rows, (n) => n === expected)
      }
      await log(1)
      await log(2)
      await log(3)

      // Undo set 2 — the second row — then log once more.
      const second = (await loggedIds(page))[1]
      if (second === undefined) throw new Error('expected three logged rows')
      await page.click(`[data-testid="${second}"]`)
      await page.until(rows, (n) => n === 2)
      await log(3)

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
      await auth(page).register(unique('lib'))

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

/**
 * A number pad has no `:`, so a duration is typed as on a timer: the last two digits are seconds.
 * Key by key, never `fill` — the field rewrites its own text as it grows ("13" becomes "1:30"), and
 * only one keystroke at a time passes through that.
 */
test(
  'a duration is typed on a number pad, timer-style, and reads back as a clock',
  async () => {
    await withApp('clock-duration', async (page) => {
      await auth(page).register(unique('clock'))
      await openNewPlan(page, 'Plank')

      // A new entry prescribes 30 seconds: shown as a clock, and typed over as one.
      expect(await page.value('plan-entry-0-0-duration')).toBe('0:30')
      await page.click('[data-testid="plan-entry-0-0-duration"]')
      await page.keys(['1', '3', '0'])
      expect(await page.value('plan-entry-0-0-duration')).toBe('1:30')
      // A real backspace takes the last digit back, regrouping what is left: 13 seconds.
      await page.keys(['Backspace'])
      expect(await page.value('plan-entry-0-0-duration')).toBe('13')
      await page.keys(['0'])
      expect(await page.value('plan-entry-0-0-duration')).toBe('1:30')

      await saveAndStart(page)
      expect(await page.text('log-entry-0-target')).toBe('Prescribed 1:30')

      await page.click('[data-testid="log-entry-0-duration"]')
      await page.keys(['4', '5'])
      await page.click('[data-testid="log-entry-0-log"]')
      await page.until(
        async () => await loggedLines(page),
        (lines) => lines.includes('0:45'),
      )
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * A person who reads pounds types and reads pounds everywhere, while every weight is still stored in
 * grams — key by key, through a half-typed "132." as a thumb would. Chosen in Settings, then the app
 * is RELOADED (`openNewPlan` navigates): the choice lives on the account, so it comes back from the
 * server. Switched back WITHOUT a reload at the end: every weight on screen follows at once.
 */
test(
  'someone who reads pounds plans and logs in pounds, and it is stored in grams',
  async () => {
    await withApp('weight-in-pounds', async (page) => {
      await auth(page).register(unique('lb'))
      const mine = await page.client()
      const chooseUnit = async (unit: 'kg' | 'lb') => {
        await page.click('[data-testid="nav-settings"]')
        await page.waitFor('settings-screen')
        await page.click(`[data-testid="weight-unit-${unit}"]`)
        await page.until(
          async () => (await mine.auth.me()).user.weightUnit,
          (saved) => saved === unit,
        )
      }
      await chooseUnit('lb')

      await openNewPlan(page)
      await page.click('[data-testid="plan-entry-0-0-weight"]')
      await page.keys(['1', '3', '2', '.', '5'])
      expect(await page.value('plan-entry-0-0-weight')).toBe('132.5')
      // A new rule adds 5 lb for someone who reads pounds — not the 5.51 that 2.5 kg would be.
      await page.click('[data-testid="plan-entry-0-0-progression-linear"]')
      expect(await page.text('plan-entry-0-0-progression-summary')).toBe('Linear, +5 lb')

      await saveAndStart(page)
      expect(await page.text('log-entry-0-target')).toBe('Prescribed 8 × 132.5 lb')
      await page.click('[data-testid="log-entry-0-log"]')
      await page.until(
        async () => await loggedLines(page),
        (lines) => lines.includes('8 × 132.5 lb'),
      )
      const [latest] = (await mine.sessions.list({ limit: 1 })).items
      if (latest === undefined) throw new Error('The session was not listed')
      expect((await mine.sessions.get(latest.id)).logs.map((l) => l.weightG)).toEqual([60_101])

      // Back to kilograms with no reload: the open session (the tab kept its stack) follows at once.
      await chooseUnit('kg')
      await page.click('[data-testid="nav-today"]')
      await page.until(
        async () => await loggedLines(page),
        (lines) => lines.includes('8 × 60.1 kg'),
      )
      expect(await page.text('log-entry-0-target')).toBe('Prescribed 8 × 60.1 kg')
      expect(await page.value('log-entry-0-weight')).toBe('60.1')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'emptying a field and typing a new number does not keep a digit of the old one',
  async () => {
    await withApp('retype-a-field', async (page) => {
      await auth(page).register(unique('retype'))
      await openNewPlan(page)

      // Sets cannot be fewer than one, and the editor used to snap an emptied field back to "1" —
      // so backspace then "4" made 14 sets.
      // A first tap selects the whole field; Backspace empties it, the second is a no-op.
      await page.click('[data-testid="plan-entry-0-0-sets"]')
      await page.keys(['Backspace', 'Backspace', '4'])
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
      await auth(page).register(unique('lim'))
      await openNewPlan(page)
      const saveDisabled = async () =>
        await page.evaluate(
          `document.querySelector('[data-testid="save-plan"]').getAttribute('aria-disabled')`,
        )

      // 5 warm-ups, then 20 working sets: an entry may hold 20 sets IN TOTAL, so the working
      // sets get the 15 that are left. The editor used to accept 25 and the save refused them.
      // A numeric field selects its text on focus, so wherever the click lands, Backspace empties
      // it.
      await page.click('[data-testid="plan-entry-0-0-warmups"]')
      await page.keys(['Backspace', '5'])
      await page.click('[data-testid="plan-entry-0-0-sets"]')
      await page.keys(['Backspace', '2', '0'])
      await page.click('[data-testid="day-name-0"]')
      expect(await page.value('plan-entry-0-0-sets')).toBe('15')
      expect(await saveDisabled()).not.toBe('true')

      // A draft the schema would refuse says so in the footer, and cannot be saved. The name field
      // is a plain text input: the click left the caret wherever it landed, so go to the end and
      // delete "Day 1" key by key.
      await page.press('End')
      await page.keys(['Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace'])
      await page.waitFor('plan-issues')
      expect(await page.text('plan-issues')).toBe('Day 1, name: Cannot be empty')
      expect(await saveDisabled()).toBe('true')

      await page.keys(['L', 'e', 'g', 's'])
      // Read once the render has caught up with the last key, not in the same tick.
      await page.until(
        async () => await page.exists('plan-issues'),
        (shown) => !shown,
      )
      expect(await saveDisabled()).not.toBe('true')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'an access token is shown once, and appears in the list',
  async () => {
    await withApp('access-token', async (page) => {
      await auth(page).register(unique('tok'))

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
      await auth(page).register(unique('rev'))

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

      await auth(page).onLoginScreen()
      expect(await page.exists('error-boundary')).toBe(false)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a shared exercise can be duplicated and the copy edited',
  async () => {
    await withApp('duplicate-exercise', async (page) => {
      await auth(page).register(unique('dup'))

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
      await auth(page).register(unique('med'))

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
      await auth(page).register(unique('chip'))

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
      await auth(page).register(unique('adhoc'))
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
      await page.waitForSelector(LOGGED_SET)

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
      await auth(page).register(unique('back'))

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
