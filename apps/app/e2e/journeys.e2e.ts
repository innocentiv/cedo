import { afterAll, beforeAll, expect, test } from 'bun:test'
import { ExerciseCreate, type TrackingMode, WorkoutPlanInput } from '@cedo/contract'
import {
  E2E_STARTUP_TIMEOUT_MS,
  E2E_TIMEOUT_MS,
  sharedApi,
  signUp,
  stopSharedApi,
  withApp,
} from './harness.ts'
import { screens, unique } from './screens/index.ts'

/**
 * The core loop, end to end: build an exercise, put it in a plan, run the plan, log a set.
 *
 * As with the route sweep, `withApp` fails on ANY console error and always writes a screenshot, so
 * these assert only the few things a passing render cannot imply. See docs/10-testing.md.
 *
 * A journey drives the app only through its screens (`e2e/screens/`): it says what a person does
 * and asserts what they see, and never names a test id. `journeys.test.ts` holds it to that.
 */

beforeAll(async () => {
  await sharedApi()
}, E2E_STARTUP_TIMEOUT_MS)

afterAll(async () => {
  await stopSharedApi()
})

/** Within 3 seconds: far inside the 30-second `staleTime`, so a refetch the app never made cannot
 * pass by waiting the cache out. */
const BEFORE_STALE_MS = 3000

test(
  'creating an exercise puts it in the library',
  async () => {
    await withApp('create-exercise', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('mk'))

      const form = await app.library.newExercise()
      await form.name('Cable Face Pull')
      // The contract requires loads summing to 100; the form shows the running total.
      await form.load('deltoid_posterior', '100')
      expect(await form.total()).toContain('100%')
      await form.save()

      expect(await app.library.listText()).toContain('Cable Face Pull')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a muscle load that does not sum to 100 is refused, with the message from the contract',
  async () => {
    await withApp('exercise-validation', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('val'))

      const form = await app.library.newExercise()
      await form.name('Half A Movement')
      await form.load('biceps_brachii', '40')
      // The API, the MCP tools and this form all reject it with the same sentence.
      expect(await form.saveRefused()).toBeTruthy()
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a plan can be built, started, and a set logged against it',
  async () => {
    await withApp('log-a-set', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('log'))
      await app.planEditor.create()
      await app.planEditor.saveAndStart()

      const bench = app.session.entry(0)
      await bench.fill('weight', '60')
      await bench.fill('reps', '8')
      await bench.log()

      // The prescribed value is REPLACED, not appended to: 8 reps, not 88. An exact line, because
      // a substring match cannot tell the two apart.
      expect(await app.session.loggedLines()).toContain('8 × 60 kg')

      await app.session.finish()
      await app.workouts.shown()
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a decimal weight typed key by key is logged exactly — with a point or a comma',
  async () => {
    await withApp('log-a-decimal', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('dec'))
      await app.planEditor.create()
      await app.planEditor.saveAndStart()
      const bench = app.session.entry(0)

      // `fill` would insert "62.5" in one event and never pass through the half-typed "62." that
      // used to collapse to 62 under the cursor, turning the next "5" into 625 kg.
      await bench.fill('weight', '6')
      await page.keys(['2', '.', '5'])
      await bench.log()

      // A comma is the decimal separator on an Italian, German or French keypad.
      await bench.fill('weight', '7')
      await page.keys(['0', ',', '5'])
      await bench.log()

      const lines = await app.session.loggedLines()
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
      const app = screens(page)
      await app.auth.register(unique('hist'))
      const exerciseId = await app.planEditor.create()
      await app.planEditor.save()

      // Seen once before logging, so the (empty) history is cached.
      await page.goto(`/exercises/${exerciseId}`)
      expect(await app.exercise.historyText()).toContain('Nothing logged yet')

      // Tabs, not `goto`: a navigation reloads the page and would empty the cache under test.
      await app.nav.tab('workouts')
      await app.workouts.openFirst()
      await app.workouts.startDay(0)
      await app.session.entry(0).fill('weight', '60')
      await app.session.entry(0).log()

      // The tab keeps its stack, so this returns to the very detail screen seen above — still
      // mounted, holding the history it fetched before the set existed.
      await app.nav.tab('exercises')
      await app.exercise.shown()
      const history = await page.until(
        async () => await app.exercise.historyText(),
        (text) => !text.includes('Nothing logged yet'),
        BEFORE_STALE_MS,
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
      const app = screens(page)
      await app.auth.register(unique('ren'))
      const before = unique('Cable Fly ')
      const after = unique('Pec Deck ')

      await app.library.create(before, 'pectoralis_major')
      // Saving goes back to where the form was opened from: Today, where registering lands.
      await app.nav.onToday()

      await app.planEditor.create(before)
      await app.planEditor.save()
      await app.workouts.openFirst()
      expect(await app.workouts.detailText()).toContain(before)

      // Tabs, not `goto`: a navigation reloads the page and would empty the cache under test.
      await app.nav.tab('exercises')
      const exercise = await app.library.find(before)
      const form = await exercise.edit()
      await form.name(after)
      await form.save()
      await exercise.shown()

      // The tab keeps its stack: back to the very plan seen above, cached before the rename.
      await app.nav.tab('workouts')
      await app.workouts.shown()
      const plan = await page.until(
        async () => await app.workouts.detailText(),
        (text) => text.includes(after),
        BEFORE_STALE_MS,
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
    // No console error allowed: the screen reads the plan's reach from the session, and never
    // fetches the lost plan itself — a fetch that once failed into the wrong series.
    await withApp('session-after-losing-plan', async (page) => {
      const app = screens(page)
      await app.auth.register(athlete)

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
          days: [{ name: 'Legs', entries: [{ exerciseId: squat.id, sets: [{ targetReps: 5 }] }] }],
        }),
      )
      await coach.api.workouts.transfer(plan.id, { toGroupId: squad.id })
      const { user: me } = await (await page.client()).auth.me()

      // The athlete trains from it.
      await page.goto('/workouts')
      await app.workouts.openFirst()
      await app.workouts.startDay(0)
      await app.session.entry(0).fill('weight', '100')
      await app.session.entry(0).log()

      // …and is then removed from the group — finished when this returns, so nothing to wait out.
      await coach.api.groups.removeMember(squad.id, me.id)

      await app.session.reopen()
      await app.session.logsShown()
      expect(await app.session.canFinish()).toBe(true)
      expect(await app.session.text()).toContain('unavailable')
      // The squat logged against the lost plan still counts: the session goes on as one without a
      // plan, not with "0 done" above "set 1" and a second "set 1" to come.
      const squats = app.session.adhoc(squat.id)
      expect(await squats.done()).toBe('1 done')
      await squats.fill('weight', '100')
      await squats.fill('reps', '5')
      await squats.log()
      await page.until(
        async () => await app.session.loggedLines(),
        (lines) => lines.includes('Barbell Back Squat · set 2'),
      )
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'undoing a set in the middle and logging again does not reuse its number',
  async () => {
    await withApp('undo-then-log', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('undo'))
      await app.planEditor.create()
      await app.planEditor.saveAndStart()

      const bench = app.session.entry(0)
      const rows = async () => (await app.session.loggedIds()).length
      /** Logs a set, and waits until there are exactly `expected` rows. */
      const log = async (expected: number) => {
        await bench.fill('weight', '60')
        await bench.log()
        await page.until(rows, (n) => n === expected)
      }
      await log(1)
      await log(2)
      await log(3)

      // Undo set 2 — the second row — then log once more.
      const second = (await app.session.loggedIds())[1]
      if (second === undefined) throw new Error('expected three logged rows')
      await app.session.undo(second)
      await page.until(rows, (n) => n === 2)
      await log(3)

      // A count would have numbered the new set 3, beside the existing set 3. Rows read
      // "Barbell Bench Press · set 1": the number is what follows the name.
      const sets = (await app.session.loggedLines()).flatMap(
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
      const app = screens(page)
      await app.auth.register(unique('lib'))

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

      await app.planEditor.create('Zz Hold', 'Core')
      const entry = app.planEditor.entry(0, 0)
      expect(await entry.text()).toContain('Zz Hold')
      // A duration exercise: Seconds, not weight and reps.
      expect(await entry.has('duration')).toBe(true)
      expect(await entry.has('weight')).toBe(false)
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
      const app = screens(page)
      await app.auth.register(unique('clock'))
      await app.planEditor.create('Plank')
      const plank = app.planEditor.entry(0, 0)

      // A new entry prescribes 30 seconds: shown as a clock, and typed over as one.
      expect(await plank.value('duration')).toBe('0:30')
      await plank.focus('duration')
      await page.keys(['1', '3', '0'])
      expect(await plank.value('duration')).toBe('1:30')
      // A real backspace takes the last digit back, regrouping what is left: 13 seconds.
      await page.keys(['Backspace'])
      expect(await plank.value('duration')).toBe('13')
      await page.keys(['0'])
      expect(await plank.value('duration')).toBe('1:30')

      await app.planEditor.saveAndStart()
      const logger = app.session.entry(0)
      expect(await logger.target()).toBe('Prescribed 1:30')

      await logger.focus('duration')
      await page.keys(['4', '5'])
      await logger.log()
      await page.until(
        async () => await app.session.loggedLines(),
        (lines) => lines.includes('0:45'),
      )
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * A person who reads pounds types and reads pounds everywhere, while every weight is still stored in
 * grams — key by key, through a half-typed "132." as a thumb would. Chosen in Settings, then the app
 * is RELOADED (`planEditor.create` navigates): the choice lives on the account, so it comes back
 * from the server. Switched back WITHOUT a reload at the end: every weight on screen follows at once.
 */
test(
  'someone who reads pounds plans and logs in pounds, and it is stored in grams',
  async () => {
    await withApp('weight-in-pounds', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('lb'))
      await app.settings.chooseUnit('lb')

      await app.planEditor.create()
      const planned = app.planEditor.entry(0, 0)
      await planned.focus('weight')
      await page.keys(['1', '3', '2', '.', '5'])
      expect(await planned.value('weight')).toBe('132.5')
      // A new rule adds 5 lb for someone who reads pounds — not the 5.51 that 2.5 kg would be.
      await planned.progression('linear')
      expect(await planned.progressionSummary()).toBe('Linear, +5 lb')

      await app.planEditor.saveAndStart()
      const bench = app.session.entry(0)
      expect(await bench.target()).toBe('Prescribed 8 × 132.5 lb')
      await bench.log()
      await page.until(
        async () => await app.session.loggedLines(),
        (lines) => lines.includes('8 × 132.5 lb'),
      )
      const mine = await page.client()
      const [latest] = (await mine.sessions.list({ limit: 1 })).items
      if (latest === undefined) throw new Error('The session was not listed')
      expect((await mine.sessions.get(latest.id)).logs.map((l) => l.weightG)).toEqual([60_101])

      // Back to kilograms with no reload: the open session (the tab kept its stack) follows at once.
      await app.settings.chooseUnit('kg')
      await app.nav.tab('today')
      await page.until(
        async () => await app.session.loggedLines(),
        (lines) => lines.includes('8 × 60.1 kg'),
      )
      expect(await bench.target()).toBe('Prescribed 8 × 60.1 kg')
      expect(await bench.value('weight')).toBe('60.1')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'emptying a field and typing a new number does not keep a digit of the old one',
  async () => {
    await withApp('retype-a-field', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('retype'))
      await app.planEditor.create()

      // Sets cannot be fewer than one, and the editor used to snap an emptied field back to "1" —
      // so backspace then "4" made 14 sets.
      // A first tap selects the whole field; Backspace empties it, the second is a no-op.
      await app.planEditor.entry(0, 0).focus('sets')
      await page.keys(['Backspace', 'Backspace', '4'])
      await app.planEditor.save()
      await app.workouts.openFirst()

      // "4 sets · …", and not "14 sets · …" — hence the digit boundary.
      expect(await app.workouts.detailText()).toMatch(/(?:^|\D)4 sets · /u)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'the plan editor stops where the schema would, and says why before saving',
  async () => {
    await withApp('plan-limits', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('lim'))
      await app.planEditor.create()
      const entry = app.planEditor.entry(0, 0)

      // 5 warm-ups, then 20 working sets: an entry may hold 20 sets IN TOTAL, so the working
      // sets get the 15 that are left. The editor used to accept 25 and the save refused them.
      // A numeric field selects its text on focus, so wherever the click lands, Backspace empties
      // it.
      await entry.focus('warmups')
      await page.keys(['Backspace', '5'])
      await entry.focus('sets')
      await page.keys(['Backspace', '2', '0'])
      await app.planEditor.focusDayName(0)
      expect(await entry.value('sets')).toBe('15')
      expect(await app.planEditor.canSave()).toBe(true)

      // A draft the schema would refuse says so in the footer, and cannot be saved. The name field
      // is a plain text input: the tap left the caret wherever it landed, so go to the end and
      // delete "Day 1" key by key.
      await page.press('End')
      await page.keys(['Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace'])
      const issues = await page.until(
        async () => await app.planEditor.issues(),
        (shown) => shown !== null,
      )
      expect(issues).toBe('Day 1, name: Cannot be empty')
      expect(await app.planEditor.canSave()).toBe(false)

      await page.keys(['L', 'e', 'g', 's'])
      // Read once the render has caught up with the last key, not in the same tick.
      await page.until(
        async () => await app.planEditor.issues(),
        (shown) => shown === null,
      )
      expect(await app.planEditor.canSave()).toBe(true)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'an access token is shown once, and appears in the list',
  async () => {
    await withApp('access-token', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('tok'))

      expect(await app.settings.createToken('claude')).toBeTruthy()
      expect(await app.settings.tokenListText()).toContain('claude')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a credential revoked mid-session returns you to the login screen',
  async () => {
    await withApp('revoked-token', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('rev'))

      /**
       * Revoke the session SERVER-side while the app keeps holding the token, which is what happens
       * when you sign out on another device or a token expires. Then navigate WITHOUT a reload, so
       * the next request carries a credential the server has forgotten.
       *
       * A page reload would prove nothing: the restore-on-startup path already handles a bad stored
       * token, and it is not the path this guards.
       */
      await (await page.client()).auth.logout()
      await app.nav.tab('workouts')

      await app.auth.onLoginScreen()
      expect(await app.nav.crashed()).toBe(false)
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a shared exercise can be duplicated and the copy edited',
  async () => {
    await withApp('duplicate-exercise', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('dup'))

      // The seeded library belongs to the shared `cedo` group, where a new user is a READER — so
      // this is the path the ACL is designed around: copy it, then edit the copy. Duplicating lands
      // straight in the editor for the copy, which is the whole point.
      const shared = await app.library.openFirst()
      await shared.duplicate()
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a video link can be attached to an exercise',
  async () => {
    await withApp('attach-media', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('med'))

      const form = await app.library.newExercise()
      await form.name('Face Pull With Video')
      await form.load('deltoid_posterior', '100')
      await form.attachVideo('https://www.youtube.com/watch?v=rep-etition')
      await form.save()

      expect(await app.library.listText()).toContain('Face Pull With Video')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'an empty list still leaves its filter chips one row tall',
  async () => {
    await withApp('empty-list-chips', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('chip'))

      // "Mine" is empty for a new account: the seeded library belongs to the shared group.
      await app.library.scope('mine')
      await app.library.emptyShown()

      /**
       * Regression: `Chips` was a horizontal ScrollView, which carries no intrinsic height. With an
       * empty list under it there was space going spare, so three chips took the whole screen.
       */
      const height = await app.library.scopeHeight()
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
      const app = screens(page)
      await app.auth.register(unique('adhoc'))
      await app.session.startAdhoc()

      const exerciseId = await app.session.addExercise('Bench')
      const bench = app.session.adhoc(exerciseId)
      await bench.fill('weight', '60')
      await bench.fill('reps', '8')
      await bench.log()

      // The exercises picked were local state, so a reload used to show an empty session with
      // no way to log the next set until the exercise was picked again. The log names it now.
      await app.session.reopen()
      await bench.shown()
      const lines = (await app.session.loggedLines()).filter((line) => line.includes(' · set '))
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
      const app = screens(page)
      await app.auth.register(unique('back'))

      // Start a session, then navigate to it by URL — a reload, a shared link, or simply coming
      // back to the tab. The router's history is empty, so `router.back()` warned
      // "The action 'GO_BACK' was not handled by any navigator" and did nothing, stranding the user
      // on a finished session.
      await app.session.startAdhoc()
      await app.session.reopen()
      await app.session.finish()

      await app.nav.onToday()
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * An unavailable exercise: the plan is still yours, one of its exercises no longer is. Its logger
 * offered weight-and-reps fields — to a plank — and a Log button the server refused; its editor
 * offered the same fields, and a Save the server refused. See GLOSSARY.md, "Unavailable exercise".
 */
test(
  'an exercise lost from your own plan reads as measured, and cannot be logged or saved',
  async () => {
    const athlete = unique('una')
    await withApp('unavailable-exercise', async (page) => {
      const app = screens(page)
      await app.auth.register(athlete)

      // A coach's group shares a timed plank with the athlete, who builds a plan around it.
      const coach = await signUp(`${athlete}c`)
      const squad = await coach.api.groups.create({ name: 'Squad' })
      await coach.api.groups.addMember(squad.id, { username: athlete, role: 'reader' })
      const plank = await coach.api.exercises.create(
        ExerciseCreate.parse({
          name: 'Coached Plank',
          tracking: 'duration',
          muscles: [{ muscle: 'rectus_abdominis', loadPct: 100 }],
        }),
      )
      await coach.api.exercises.transfer(plank.id, { toGroupId: squad.id })
      const mine = await page.client()
      const [bench] = (await mine.exercises.list({ q: 'Bench', limit: 1 })).items
      if (bench === undefined) throw new Error('The seeded library has no bench press')
      const plan = await mine.workouts.create({ name: 'Mine', notes: null })
      await mine.workouts.replacePlan(
        plan.id,
        WorkoutPlanInput.parse({
          days: [
            {
              name: 'Day 1',
              entries: [
                { exerciseId: plank.id, sets: [{ targetDurationS: 60 }] },
                { exerciseId: bench.id, sets: [{ targetReps: 8, targetWeightG: 60_000 }] },
              ],
            },
          ],
        }),
      )

      // …and leaves the group. The plan is still theirs; the plank is not.
      const { user: me } = await mine.auth.me()
      await coach.api.groups.removeMember(squad.id, me.id)

      await page.goto('/workouts')
      await app.workouts.openFirst()
      await app.workouts.startDay(0)
      const lost = app.session.entry(0)
      await lost.shown()
      expect(await lost.unavailable()).toBe(true)
      expect(await lost.canLog()).toBe(false)
      // As measured: a minute, which is what was prescribed whatever the exercise was.
      expect(await lost.target()).toBe('Prescribed 1:00')
      expect(await app.session.entry(1).canLog()).toBe(true)

      await app.planEditor.open(plan.id)
      const entry = app.planEditor.entry(0, 0)
      expect(await entry.unavailable()).toBe(true)
      expect(await entry.target()).toBe('1 set · 1:00')
      const issues = await page.until(
        async () => await app.planEditor.issues(),
        (shown) => shown !== null,
      )
      expect(issues).toBe('Day 1, exercise 1: Unavailable exercise — remove it to save')
      expect(await app.planEditor.canSave()).toBe(false)

      await entry.remove()
      await page.until(
        async () => await app.planEditor.issues(),
        (shown) => shown === null,
      )
      expect(await app.planEditor.canSave()).toBe(true)
      await app.planEditor.save()
      const saved = await mine.workouts.get(plan.id)
      expect(saved.days[0]?.entries.map((e) => e.exerciseId)).toEqual([bench.id])
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * One session in progress at a time. A plan used to offer Start beside a session already in
 * progress, and the API opened a second one; Today then resumed whichever it found first.
 */
test(
  'a session in progress is resumed from its plan, not started twice',
  async () => {
    await withApp('resume-from-plan', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('res'))
      await app.planEditor.create()
      await app.planEditor.saveAndStart()
      await app.session.entry(0).fill('weight', '60')
      await app.session.entry(0).log()

      await page.goto('/workouts')
      await app.workouts.openFirst()
      await app.workouts.inProgressShown()
      expect(await app.workouts.canStart(0)).toBe(false)

      // Back into the very session: its set is there.
      await app.workouts.resume()
      await page.until(
        async () => await app.session.loggedLines(),
        (lines) => lines.includes('8 × 60 kg'),
      )
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * A write refused because what it names is gone or out of reach says the screen's picture is
 * stale. The athlete is removed from the group mid-session, on the coach's device: the screen still
 * shows the plan, the next set against it is refused — and the session used to keep showing the plan
 * for the cache's whole window, inviting the same refused set again.
 */
test(
  'a set refused against a plan lost mid-session shows the plan as unavailable at once',
  async () => {
    const athlete = unique('lost')
    await withApp('refused-set-refreshes', async (page) => {
      const app = screens(page)
      await app.auth.register(athlete)

      const coach = await signUp(`${athlete}c`)
      const squad = await coach.api.groups.create({ name: 'Squad' })
      await coach.api.groups.addMember(squad.id, { username: athlete, role: 'reader' })
      const [squat] = (await coach.api.exercises.list({ q: 'Back Squat', limit: 1 })).items
      if (squat === undefined) throw new Error('The seeded library has no Back Squat')
      const plan = await coach.api.workouts.create({ name: 'Coached', notes: null })
      await coach.api.workouts.replacePlan(
        plan.id,
        WorkoutPlanInput.parse({
          days: [{ name: 'Legs', entries: [{ exerciseId: squat.id, sets: [{ targetReps: 5 }] }] }],
        }),
      )
      await coach.api.workouts.transfer(plan.id, { toGroupId: squad.id })
      const { user: me } = await (await page.client()).auth.me()

      await page.goto('/workouts')
      await app.workouts.openFirst()
      await app.workouts.startDay(0)
      await app.session.entry(0).fill('weight', '100')

      // Removed on the coach's device: nothing on this screen has changed.
      await coach.api.groups.removeMember(squad.id, me.id)
      await app.session.entry(0).attemptLog()
      expect(await app.session.error()).toContain('No such entry')

      await page.until(
        async () => await app.session.planUnavailable(),
        (shown) => shown,
        BEFORE_STALE_MS,
      )
    })
  },
  E2E_TIMEOUT_MS,
)
