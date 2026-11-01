import { afterAll, beforeAll, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  ExerciseCreate,
  LogSetInput,
  McpClientConfig,
  type TrackingMode,
  WorkoutPlanInput,
  ageLine,
  ageThisYear,
  calendarDayOf,
  formatCalendarDay,
  kgToG,
  planInputFrom,
} from '@cedo/contract'
import {
  E2E_STARTUP_TIMEOUT_MS,
  E2E_TIMEOUT_MS,
  type Page,
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
      // What it needs (#33): nothing said is undescribed, "nothing" a claim of its own, and an
      // item chosen ends it.
      expect(await form.equipmentSummary()).toContain('Not described yet')
      await form.equipment('nothing')
      expect(await form.equipmentSummary()).toBe('Needs no equipment.')
      await form.equipment('high_pulley')
      expect(await form.equipmentSummary()).toBe('Needs all of what is chosen.')
      await form.save()

      expect(await app.library.listText()).toContain('Cable Face Pull')
      const detail = await app.library.find('Cable Face Pull')
      expect(await detail.equipment()).toBe('High pulley')

      // The last item dropped is undescribed again, not "needs nothing".
      const edit = await detail.edit()
      await edit.equipment('high_pulley')
      await edit.save()
      expect(await app.exercise.equipment()).toBe('Not described')
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Finding exercises (#27): the picker leads with what was logged lately, marks what the day already
 * has, and adds several at once.
 */
test(
  'the picker leads with what was logged lately, marks the day, and adds several at once',
  async () => {
    await withApp('picker-many', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('pick'))
      await app.planEditor.create('Bench')
      await app.planEditor.saveAndStart()
      await app.session.entry(0).log()
      await app.session.finish()
      // The workouts tab kept its stack: back to the workout's page, as it was left.
      await app.nav.tab('workouts')
      await app.workouts.shown()
      await app.planEditor.addTo(0)
      expect((await app.picker.recent())[0]).toContain('Bench')
      expect(await app.picker.row('Bench Press')).toContain('In this day')
      await app.picker.pickAll(['Back Squat', 'Romanian'])
      await page.until(
        async () => await app.planEditor.entries(0),
        (n) => n === 3,
      )
      await app.planEditor.saved()
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Progress (#28): the training review an AI reads, on the athlete's own tab — an exercise logged
 * at the same top set session after session said to have stalled.
 */
test(
  'Progress says how often you train, and what has stalled',
  async () => {
    await withApp('progress', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('prog'))
      const mine = await page.client()
      const [row] = (await mine.exercises.list({ q: 'Barbell Row', limit: 1 })).items
      if (row === undefined) throw new Error('The library has no row')
      for (let i = 0; i < 3; i += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one session at a time.
        const session = await mine.sessions.start({ workoutId: null, dayId: null })
        // oxlint-disable-next-line no-await-in-loop -- in order.
        await mine.sessions.logSet(
          session.id,
          LogSetInput.parse({ exerciseId: row.id, weightG: kgToG(80), reps: 5 }),
        )
        // oxlint-disable-next-line no-await-in-loop -- finished before the next can start.
        await mine.sessions.update(session.id, { endedAt: new Date().toISOString() })
      }

      await page.goto('/progress')
      await app.progress.shown()
      // Three sessions over the default eight weeks.
      expect(await app.progress.perWeek()).toBe('0.4')
      const attention = await app.progress.attention()
      expect(attention).toContain('Stalled')
      expect(attention).toContain('3 sessions at 5 × 80 kg')
      await app.progress.period('4')
      await page.until(
        async () => await app.progress.perWeek(),
        (said) => said === '0.8',
      )
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * The coach's view (#30), set up over HTTP: the page's user coaches an athlete who shares their
 * training with the squad — three finished sessions of rows at 80 kg, and one in progress.
 */
async function coachingSetUp(page: Page, coachName: string) {
  const athlete = await signUp(`${coachName}a`, 'Robin Vale')
  const mine = await page.client()
  const squad = await mine.groups.create({ name: 'Squad' })
  await mine.groups.addMember(squad.id, { username: athlete.user.username, role: 'reader' })
  await athlete.api.groups.setSharing(squad.id, { sharesTraining: true })
  const [row] = (await athlete.api.exercises.list({ q: 'Barbell Row', limit: 1 })).items
  if (row === undefined) throw new Error('The library has no row')
  const log = async (sessionId: string, exerciseId: string) =>
    await athlete.api.sessions.logSet(
      sessionId,
      LogSetInput.parse({ exerciseId, weightG: kgToG(80), reps: 5 }),
    )
  for (let i = 0; i < 3; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one session at a time.
    const session = await athlete.api.sessions.start({ workoutId: null, dayId: null })
    // oxlint-disable-next-line no-await-in-loop -- in order.
    await log(session.id, row.id)
    // oxlint-disable-next-line no-await-in-loop -- finished before the next can start.
    await athlete.api.sessions.update(session.id, { endedAt: new Date().toISOString() })
  }
  // In progress: a row, and a lift of their own the coach cannot see.
  const now = await athlete.api.sessions.start({ workoutId: null, dayId: null })
  await log(now.id, row.id)
  const own = await athlete.api.exercises.create(
    ExerciseCreate.parse({
      name: 'Robin Own Lift',
      muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
    }),
  )
  await log(now.id, own.id)
  return { athlete, squadId: squad.id, rowId: row.id, nowId: now.id }
}

/**
 * What you have to train with (#34): undescribed until said; ticked by group, a weighted item's
 * weights from where they usually start, a second pulley from the first's, a shortcut ticking
 * several — and read back as saved.
 */
test(
  'you say what you train with, and how your dumbbells go',
  async () => {
    await withApp('equipment', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('kit'))
      expect(await app.equipment.said()).toEqual(['Not described yet'])

      await app.equipment.open()
      await app.equipment.have('dumbbells')
      expect(await app.equipment.weights('dumbbells')).toEqual(['2.5', '2.5', ''])
      await app.equipment.type('dumbbells', 'minG', '2')
      await app.equipment.type('dumbbells', 'stepG', '2')
      await app.equipment.type('dumbbells', 'maxG', '30')

      await app.equipment.have('high_pulley')
      await app.equipment.type('high_pulley', 'stepG', '5')
      await app.equipment.have('low_pulley')
      expect(await app.equipment.weights('low_pulley')).toEqual(['2.5', '5', ''])
      await app.equipment.shortcut(1)
      // Half typed is not saved as not known, silently: the screen asks for the rest.
      await app.equipment.empty('high_pulley', 'stepG')
      expect(await app.equipment.saveRefused()).toBe(
        'High pulley: give a step and where it starts, or empty all three.',
      )
      await app.equipment.type('high_pulley', 'stepG', '5')
      await app.equipment.save()

      expect(await app.equipment.said()).toEqual(['5 items'])
      await app.equipment.open()
      expect(await app.equipment.ticked()).toEqual([
        'dumbbells',
        'flat_bench',
        'incline_bench',
        'high_pulley',
        'low_pulley',
      ])
      expect(await app.equipment.weights('dumbbells')).toEqual(['2', '2', '30'])
      const mine = await page.client()
      expect((await mine.equipment.get()).items[0]).toEqual({
        slug: 'dumbbells',
        weights: { stepG: 2000, minG: 2000, maxG: 30_000 },
      })
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Doable (#35): before you say what you train with, the library asks and offers everything; after,
 * only what you can do — everything a tap away, what you cannot do marked — and a plan keeps the
 * exercise you cannot do, marked, never removed.
 */
test(
  'the library offers what your equipment lets you do, and a plan marks what it does not',
  async () => {
    await withApp('doable', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('gym'))
      const mine = await page.client()
      const [squat] = (await mine.exercises.list({ q: 'Barbell Back Squat', limit: 1 })).items
      if (squat === undefined) throw new Error('The seeded library has no Back Squat')
      const plan = await mine.workouts.create({ name: 'Legs', notes: null })
      await mine.workouts.replacePlan(
        plan.id,
        WorkoutPlanInput.parse({
          days: [{ name: 'A', entries: [{ exerciseId: squat.id, sets: [{ targetReps: 5 }] }] }],
        }),
      )

      expect(await app.library.prompted()).toBe(true)
      expect(await app.library.shownText()).toContain('Barbell Back Squat')

      await mine.equipment.save({ items: [{ slug: 'dumbbells', weights: null }] })
      expect(await app.library.prompted()).toBe(false)
      const doable = await app.library.shownText()
      expect(doable).toContain('Goblet Squat')
      expect(doable).not.toContain('Barbell Back Squat')
      expect(doable).not.toContain('Missing equipment')

      await app.library.showing('all')
      await page.until(app.library.shownText, (text) => text.includes('Barbell Back Squat'))
      expect(await app.library.shownText()).toContain('Missing equipment')

      await app.planEditor.open(plan.id)
      expect(await app.planEditor.entry(0, 0).text()).toContain('Missing equipment')
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Weight steps (#36) — the problem #32 began with: dumbbells that go 2 kg at a time, and a plan of
 * 22.5 kg. The logger asks 22, says the plan's own weight it stands for, and − / + land on the
 * dumbbells there are, from a weight typed between two as well.
 */
test(
  'the logger asks what your dumbbells weigh, and − / + step as they do',
  async () => {
    await withApp('weight-steps', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('steps'))
      const mine = await page.client()
      await mine.equipment.save({
        items: [{ slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: 30_000 } }],
      })
      const [goblet] = (await mine.exercises.list({ q: 'Goblet Squat', limit: 1 })).items
      if (goblet === undefined) throw new Error('The seeded library has no Goblet Squat')
      const plan = await mine.workouts.create({ name: 'Legs', notes: null })
      const set = { targetReps: 8, targetWeightG: 22_500 }
      await mine.workouts.replacePlan(
        plan.id,
        WorkoutPlanInput.parse({
          days: [{ name: 'A', entries: [{ exerciseId: goblet.id, sets: [set, set, set] }] }],
        }),
      )

      await app.planEditor.open(plan.id)
      await app.workouts.startDay(0)
      const squat = app.session.entry(0)
      expect(await squat.target()).toBe('Prescribed 8 × 22 kg')
      expect(await squat.value('weight')).toBe('22')

      await squat.step('weight', 'more')
      expect(await squat.value('weight')).toBe('24')
      await squat.fill('weight', '21')
      await squat.step('weight', 'less')
      expect(await squat.value('weight')).toBe('20')
      await squat.fill('weight', '30')
      await squat.step('weight', 'more')
      expect(await squat.value('weight')).toBe('30')
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * A coach reads an athlete's training (#30): the tab offered only while someone shares with them,
 * the session they are in, their Progress, their history — and from a session, an exercise's. Read
 * again on coming back, never polled: a session finished meanwhile is no longer "Training now".
 */
test(
  "a coach reads an athlete's training, offered only while they share it",
  async () => {
    await withApp('coach-reads', async (page) => {
      const app = screens(page)
      const coachName = unique('coach')
      await app.auth.register(coachName)
      await app.nav.onToday()
      expect(await app.nav.offered('athletes')).toBe(false)
      const { athlete, squadId, rowId, nowId } = await coachingSetUp(page, coachName)

      await athlete.api.equipment.save({
        items: [{ slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: 30_000 } }],
      })

      await page.goto('/today')
      await app.nav.onToday()
      expect(await app.nav.offered('athletes')).toBe(true)
      await app.nav.tab('athletes')
      await app.athletes.open(athlete.user.id)
      // What they train with, to plan for their gym (#34) — read, never changed here.
      expect(await app.athletes.equipment()).toEqual(['Dumbbells: from 2 kg to 30 kg, by 2 kg'])
      expect(await app.athletes.trainingNow()).toContain('Without a plan')
      // The review counts the session they are in, as their own Progress does.
      expect(await app.progress.attention()).toContain('4 sessions at 5 × 80 kg')
      expect(await page.until(app.today.rows, (rows) => rows.length === 3)).toHaveLength(3)

      // Their session in progress: the sets so far, read-only — their own lift unnamed, unlinked.
      await app.athletes.openTrainingNow()
      await app.session.logsShown()
      expect(await app.session.logsText()).toContain('Unavailable exercise')
      expect(await app.athletes.historyLinks()).toEqual([rowId])

      // They finish it while it is open: coming back reads them again.
      await athlete.api.sessions.update(nowId, {
        endedAt: new Date().toISOString(),
        notes: 'Felt heavy',
      })
      await app.athletes.back()
      await page.until(app.athletes.inTraining, (training) => !training)
      await page.until(app.today.rows, (rows) => rows.length === 4)

      await app.today.open(0)
      expect(await app.athletes.notes()).toBe('Felt heavy')
      await app.athletes.historyOf(rowId)
      expect(await app.exercise.historyText()).toContain('5 × 80 kg')

      // Taken back while the coach reads: back on their page, it is theirs no more, nor the tab.
      await athlete.api.groups.setSharing(squadId, { sharesTraining: false })
      await app.athletes.backFromExercise()
      await app.athletes.back()
      await app.athletes.gone()
      await page.until(
        async () => await app.nav.offered('athletes'),
        (offered) => !offered,
      )
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Athlete notes (#41): what is known about someone, kept for planning their training. Written by
 * the athlete or their coach, read by both; only the author rewords one, and the athlete or the
 * author removes it. On your own Progress, and on an athlete's page.
 */
test(
  'an athlete and their coach keep notes for planning their training',
  async () => {
    await withApp('athlete-notes', async (page) => {
      const app = screens(page)
      const coachName = unique('coach')
      await app.auth.register(coachName)
      await app.nav.onToday()
      const { athlete } = await coachingSetUp(page, coachName)
      await athlete.api.notes.create(undefined, { text: 'I hate lunges' })

      // Theirs, on their page: read under their name, offered neither Edit nor Remove.
      await page.goto('/today')
      await app.nav.onToday()
      await app.nav.tab('athletes')
      await app.athletes.open(athlete.user.id)
      expect(
        await page.until(
          async () => await app.notes.read('athlete'),
          (n) => n.length === 1,
        ),
      ).toEqual([expect.stringMatching(/^Robin Vale · .+ \/ I hate lunges$/u)])
      expect(await app.notes.offers('athlete', 0)).toEqual({ edit: false, remove: false })

      // The coach's own, newest first: theirs to reword and remove.
      await app.notes.add('athlete', 'Left shoulder: no overhead pressing')
      const read = await page.until(
        async () => await app.notes.read('athlete'),
        (n) => n.length === 2,
      )
      expect(read[0]).toMatch(/^You · .+ \/ Left shoulder: no overhead pressing$/u)
      expect(await app.notes.offers('athlete', 0)).toEqual({ edit: true, remove: true })
      await app.notes.reword('athlete', 0, 'Left shoulder: no overhead pressing until December')
      expect(
        (
          await page.until(
            async () => await app.notes.read('athlete'),
            (n) => n[0]?.includes('edited') === true,
          )
        )[0],
      ).toContain('until December')

      // The athlete reads it under the coach's name, and may remove it but not reword it.
      const [theirs] = await athlete.api.notes.list()
      expect(theirs).toMatchObject({
        text: 'Left shoulder: no overhead pressing until December',
        canEdit: false,
        canDelete: true,
      })

      // Your own, on Progress: written, then removed when no longer true.
      await app.nav.tab('progress')
      await app.progress.shown()
      expect(
        await page.until(
          async () => await app.notes.none('progress'),
          (none) => none,
        ),
      ).toBe(true)
      await app.notes.add('progress', 'Away 10–17 November')
      expect(
        await page.until(
          async () => await app.notes.read('progress'),
          (n) => n.length === 1,
        ),
      ).toEqual([expect.stringMatching(/^You · .+ \/ Away 10–17 November$/u)])
      await app.notes.remove('progress', 0)
      expect(
        await page.until(
          async () => await app.notes.none('progress'),
          (none) => none,
        ),
      ).toBe(true)
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Bodyweight (#42): an athlete's, read and taken by their coach on their page beside the review —
 * its change measured over the same weeks — and the coach's own on Progress; and the year someone
 * was born, said in Settings.
 */
test(
  'an athlete and their coach keep a bodyweight, and the year they were born',
  async () => {
    await withApp('bodyweight', async (page) => {
      const app = screens(page)
      const coachName = unique('weigh')
      await app.auth.register(coachName)
      await app.nav.onToday()
      const { athlete } = await coachingSetUp(page, coachName)
      const today = calendarDayOf(new Date())
      const yesterday = calendarDayOf(new Date(Date.now() - 86_400_000))
      await athlete.api.weighIns.create(undefined, { day: yesterday, weightG: 83_000 })
      await athlete.api.auth.updateMe({ birthYear: 1990 })

      // Theirs, on their page: under their name, and not the coach's to remove.
      await page.goto('/today')
      await app.nav.onToday()
      await app.nav.tab('athletes')
      await app.athletes.open(athlete.user.id)
      expect(
        await page.until(
          async () => await app.bodyweight.read('athlete'),
          (lines) => lines.includes('83 kg'),
        ),
      ).toEqual(['83 kg', formatCalendarDay(yesterday), `${formatCalendarDay(yesterday)} · 83 kg`])
      expect(await app.bodyweight.removable('athlete', 0)).toBe(false)
      // Their age, as the review says it — never the year they were born.
      const age = ageLine(ageThisYear(1990, new Date()))
      expect(
        await page.until(
          async () => await app.athletes.about(),
          (about) => about.endsWith(age),
        ),
      ).toBe(`@${athlete.user.username} · through Squad · ${age}`)

      // Today's, taken by the coach: the latest, its change since yesterday, and the coach's own.
      await app.bodyweight.take('athlete', '82.4')
      expect(
        await page.until(
          async () => await app.bodyweight.read('athlete'),
          (lines) => lines[0] === '82.4 kg',
        ),
      ).toEqual([
        '82.4 kg',
        `${formatCalendarDay(today)} · −0.6 kg since ${formatCalendarDay(yesterday)}`,
        `${formatCalendarDay(today)} · 82.4 kg`,
        `${formatCalendarDay(yesterday)} · 83 kg`,
      ])
      expect(await app.bodyweight.removable('athlete', 0)).toBe(true)
      await page.screenshot('bodyweight-athlete')
      const { weighIns: theirs } = await athlete.api.weighIns.list(undefined, { weeks: 8 })
      expect(theirs[0]).toMatchObject({ day: today, weightG: 82_400, canDelete: true })

      // Your own, on Progress: taken, then removed.
      await app.nav.tab('progress')
      await app.progress.shown()
      expect(
        await page.until(
          async () => await app.bodyweight.read('progress'),
          (lines) => lines.includes('No weigh-ins yet.'),
        ),
      ).toEqual(['No weigh-ins yet.'])
      await app.bodyweight.take('progress', '90')
      await page.until(
        async () => await app.bodyweight.read('progress'),
        (lines) => lines[0] === '90 kg',
      )
      await page.screenshot('bodyweight-progress')
      await app.bodyweight.remove('progress', 0)
      await page.until(
        async () => await app.bodyweight.read('progress'),
        (lines) => lines.includes('No weigh-ins yet.'),
      )

      // The coach's own year of birth, said in Settings and kept to their account.
      await app.bodyweight.sayBirthYear('1990')
    })
  },
  E2E_TIMEOUT_MS,
)

/** On a desktop the athlete opens beside the list, as an exercise does in the library (#29). */
test(
  'on a desktop an athlete opens beside the athletes',
  async () => {
    await withApp(
      'coach-desk',
      async (page) => {
        const app = screens(page)
        const coachName = unique('desk')
        await app.auth.register(coachName)
        const { athlete } = await coachingSetUp(page, coachName)
        await page.goto('/today')
        await app.nav.onToday()
        await app.nav.tab('athletes')
        await app.athletes.open(athlete.user.id)
        expect(await app.athletes.trainingNow()).toContain('Without a plan')
        expect(await app.athletes.listed(athlete.user.id)).toBe(true)
      },
      { layout: 'desktop' },
    )
  },
  E2E_TIMEOUT_MS,
)

/**
 * A desktop (#29): the sidebar names the product and who is signed in, and an exercise chosen from
 * the library opens beside it — the list stays.
 */
test(
  'on a desktop the sidebar says whose it is, and an exercise opens beside the list',
  async () => {
    await withApp(
      'desktop-panes',
      async (page) => {
        const app = screens(page)
        const username = unique('desk')
        await app.auth.register(username)
        expect(await app.desk.name()).toBe('cedo')
        expect(await app.desk.account()).toContain(`@${username}`)
        await app.library.choose('Barbell Back Squat')
        const pane = await app.desk.pane()
        expect(pane).toContain('Barbell Back Squat')
        expect(pane).toContain('Quads')
        expect(await app.library.listShown()).toBe(true)
        // Its address keeps it open: a reload, and the exercise's own link, land on the pane.
        await app.desk.reload()
        expect(await app.desk.pane()).toContain('Barbell Back Squat')
        await app.desk.openByItsAddress()
        expect(await app.desk.pane()).toContain('Barbell Back Squat')
        expect(await app.library.listShown()).toBe(true)
      },
      { layout: 'desktop' },
    )
  },
  E2E_TIMEOUT_MS,
)

/** A new exercise starts from its muscles (#27): chosen, their loads split evenly to total 100. */
test(
  "a new exercise's muscles start as an even split, valid as they stand",
  async () => {
    await withApp('even-split', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('even'))
      const form = await app.library.newExercise()
      await form.name('Split Squat')
      await form.choose('quadriceps')
      await form.choose('gluteus_maximus')
      expect([await form.loadOf('quadriceps'), await form.loadOf('gluteus_maximus')]).toEqual([
        '50',
        '50',
      ])
      await form.choose('adductors')
      expect(await form.loadOf('quadriceps')).toBe('34')
      expect(await form.total()).toContain('100%')
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

      // The server numbers a series without reusing a number: a count would have given the new
      // set 3 again, beside the existing set 3.
      const mine = await page.client()
      const stored = (await mine.sessions.get(await app.session.id())).logs
      expect(stored.map((l) => l.setIndex)).toEqual([0, 2, 3])
      // The screen counts the working sets as the athlete reads them (#24): 1, 2, 3, no gap.
      const sets = (await app.session.loggedLines()).flatMap(
        (line) => / · (set \d+)$/u.exec(line)?.[1] ?? [],
      )
      expect(sets).toEqual(['set 1', 'set 2', 'set 3'])
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
 * An athlete shares their training with a coach's group, and keeps it private again (#11). The
 * switch is theirs, the group says who reads it, and a personal group offers no switch at all.
 */
test(
  "an athlete shares their training with a group's editors, and takes it back",
  async () => {
    const athlete = unique('share')
    await withApp('share-training', async (page) => {
      const app = screens(page)
      await app.auth.register(athlete)
      const coach = await signUp(`${athlete}c`)
      const squad = await coach.api.groups.create({ name: 'Squad' })
      await coach.api.groups.addMember(squad.id, { username: athlete, role: 'reader' })

      await app.groups.open()
      await app.groups.openGroup('Squad')
      expect(await app.groups.readers()).toEqual([])
      await app.groups.shareTraining('shared')
      await page.until(app.groups.readers, (readers) => readers.includes(coach.user.username))

      const mine = await page.client()
      const shared = (await mine.groups.list()).find((g) => g.id === squad.id)
      expect(shared?.sharesTraining).toBe(true)

      await app.groups.shareTraining('private')
      await page.until(app.groups.readers, (readers) => readers.length === 0)
      expect((await mine.groups.list()).find((g) => g.id === squad.id)?.sharesTraining).toBe(false)
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * A row goes further at the same pace (#14). Distance is metric for everyone, so a person who reads
 * pounds is offered 500 m, not a pound-shaped step — and the rule is saved as the editor said it.
 */
test(
  'a row is planned to go further at the same pace, in metres even for someone who reads pounds',
  async () => {
    await withApp('distance-progression', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('row'))
      await app.settings.chooseUnit('lb')

      await app.planEditor.create('Rowing Machine', 'Row Day')
      const planned = app.planEditor.entry(0, 0)
      await planned.progression('linear_distance')
      expect(await planned.progressionSummary()).toBe('Distance, +500 m at the same pace')
      await app.planEditor.saveAndStart()

      const mine = await page.client()
      const [latest] = (await mine.sessions.list({ limit: 1 })).items
      const started = latest === undefined ? null : await mine.sessions.get(latest.id)
      if (started?.workoutId == null) throw new Error('The session did not start from the plan')
      const plan = await mine.workouts.get(started.workoutId)
      expect(plan.days[0]?.entries[0]?.progression).toEqual({
        kind: 'linear_distance',
        incrementMm: 500_000,
        afterSuccesses: 1,
      })
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

      // Back to kilograms with no reload: the open session, returned to, follows at once.
      await app.settings.chooseUnit('kg')
      await app.nav.tab('today')
      await app.session.returnTo()
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

/**
 * A workout is edited in place (#26, ADR-0022): each change is saved as it is made — there is no
 * Save — and an entry moved to another day keeps its history, its id going with it.
 */
test(
  'a plan is saved as each change is made, and an entry moved to another day keeps its id',
  async () => {
    await withApp('plan-in-place', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('place'))
      await app.planEditor.create()
      const entry = app.planEditor.entry(0, 0)
      await entry.focus('sets')
      await page.keys(['Backspace', '4'])
      await app.planEditor.saved()

      const mine = await page.client()
      const [listed] = (await mine.workouts.list({})).items
      if (listed === undefined) throw new Error('The plan was not listed')
      const first = await mine.workouts.get(listed.id)
      expect(first.days[0]?.entries[0]?.sets.filter((s) => !s.isWarmup)).toHaveLength(4)
      const entryId = first.days[0]?.entries[0]?.id

      await app.planEditor.addDay()
      await app.planEditor.saved()
      await entry.moveToDay(1)
      await app.planEditor.saved()
      const moved = await mine.workouts.get(listed.id)
      expect(moved.days.map((d) => d.entries.length)).toEqual([0, 1])
      expect(moved.days[1]?.entries[0]?.id).toBe(entryId)
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Two copies of one plan, open at once (ADR-0022): a change made from the older is refused, and the
 * page reads the plan again and says so — it does not quietly overwrite what was saved elsewhere.
 */
test(
  'a change to a plan saved elsewhere since is refused, and the plan read again',
  async () => {
    await withApp('plan-conflict', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('both'))
      await app.planEditor.create()
      await app.planEditor.saved()
      const mine = await page.client()
      const [listed] = (await mine.workouts.list({})).items
      if (listed === undefined) throw new Error('The plan was not listed')

      // Elsewhere — another device — the day is renamed and saved.
      const there = await mine.workouts.get(listed.id)
      const plan = planInputFrom(there)
      const [day] = plan.days
      if (day === undefined) throw new Error('The plan has no day')
      await mine.workouts.replacePlan(listed.id, {
        days: [{ ...day, name: 'Theirs' }],
        version: there.version,
      })

      // Here, from the copy opened before it: refused, and the plan as saved there shown instead.
      await app.planEditor.entry(0, 0).focus('sets')
      await page.keys(['Backspace', '2'])
      const said = await page.until(
        async () => await app.planEditor.said(),
        (shown) => shown !== null,
      )
      expect(said).toContain('Changed elsewhere')
      const after = await mine.workouts.get(listed.id)
      expect(after.days[0]?.name).toBe('Theirs')
      expect(after.days[0]?.entries[0]?.sets.filter((s) => !s.isWarmup)).toHaveLength(3)
      expect(await app.planEditor.dayName(0)).toBe('Theirs')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'the plan editor stops where the schema would, and never offers a plan it refuses',
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
      // Reading the field opened its settings again (#26): back to the day's name.
      await app.planEditor.focusDayName(0)

      // A day may not be nameless, and the page never offers a plan that says otherwise (#26): a
      // name emptied and left is put back. The field is a plain text input — the tap left the
      // caret wherever it landed, so go to the end and delete "Day 1" key by key.
      await page.press('End')
      await page.keys(['Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace'])
      await app.planEditor.leaveField()
      expect(await app.planEditor.dayName(0)).toBe('Day 1')
      expect(await app.planEditor.issues()).toBeNull()

      // Renamed: kept as the field is left, not on every key.
      await app.planEditor.focusDayName(0)
      await page.press('End')
      await page.keys(['Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace'])
      await page.keys(['L', 'e', 'g', 's'])
      await app.planEditor.leaveField()
      await app.planEditor.saved()
      const mine = await page.client()
      const [listed] = (await mine.workouts.list({})).items
      expect((await mine.workouts.get(listed?.id ?? '')).days[0]?.name).toBe('Legs')
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
  'connecting an AI: the address and a token, ready to paste, and they reach the MCP server',
  async () => {
    await withApp('connect-ai', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('ai'))

      const shown = await app.settings.connectAi()
      // This page's origin, through the proxy — as Caddy serves it, never a build-time host.
      expect(shown.address).toBe(`${shown.origin}/api/mcp`)
      const server = McpClientConfig.parse(JSON.parse(shown.json ?? '')).mcpServers['cedo']
      if (server === undefined) throw new Error('No cedo server in the JSON shown')
      const { url, headers } = server
      expect(url).toBe(`${shown.origin}/api/mcp`)
      const token = /^Bearer (\S+)$/u.exec(headers['Authorization'] ?? '')?.[1]
      expect(token).toBeDefined()
      // Spelled out, not rebuilt with the contract's `aiClientConfigs`: what someone pastes is
      // checked against what it should say, not against the code that wrote it.
      expect(shown.claudeCode).toBe(
        `claude mcp add --transport http --scope user cedo ${url} --header "Authorization: Bearer ${token}"`,
      )

      // Pasted into a client: what it sends, from outside the page, reaches the tools.
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('training_review')
      await app.settings.openTokens()
      expect(await app.settings.tokenListText()).toContain('Your AI')
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

/**
 * A plan shared with you as a reader cannot be edited, so the way to adapt it is a copy in your own
 * group — opened straight in the editor, as an exercise's copy is.
 */
/**
 * A copy may use only exercises its new owner can read. Once the coach takes the squad's exercise
 * back into their own group, the shared plan uses one the athlete cannot see, so the copy is
 * refused. The server says why without naming the exercise, which the athlete may not read. The
 * message shows beside the button, on the plan, and nothing is created.
 */
test(
  'duplicating a shared workout that uses an exercise I cannot see says why',
  async () => {
    const athlete = unique('dupr')
    await withApp('duplicate-workout-refused', async (page) => {
      const app = screens(page)
      await app.auth.register(athlete)

      const coach = await signUp(`${athlete}c`)
      const squad = await coach.api.groups.create({ name: 'Squad' })
      await coach.api.groups.addMember(squad.id, { username: athlete, role: 'reader' })
      const drill = await coach.api.exercises.create({
        name: 'Squad Sled Drill',
        muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
      })
      await coach.api.exercises.transfer(drill.id, { toGroupId: squad.id })
      const plan = await coach.api.workouts.create({ name: 'Coached', notes: null })
      await coach.api.workouts.replacePlan(
        plan.id,
        WorkoutPlanInput.parse({
          days: [{ name: 'Sled', entries: [{ exerciseId: drill.id, sets: [{ targetReps: 5 }] }] }],
        }),
      )
      await coach.api.workouts.transfer(plan.id, { toGroupId: squad.id })
      const { user: coachUser, groups } = await coach.api.auth.me()
      const coachOwn = groups.find((g) => g.kind === 'personal')
      if (coachOwn === undefined) throw new Error(`${coachUser.username} has no personal group`)
      await coach.api.exercises.transfer(drill.id, { toGroupId: coachOwn.id })

      await page.goto(`/workouts/${plan.id}`)
      // Why, and never the name: it is an exercise the athlete may not read.
      const refused = await app.workouts.duplicateRefused()
      expect(refused).toContain('not visible to you, so the plan cannot be copied')
      expect(refused).not.toContain('Squad Sled Drill')
      await app.workouts.shown()
      const mine = await (await page.client()).workouts.list({ scope: 'mine' })
      expect(mine.items).toEqual([])
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a shared workout can be duplicated into my group, landing in the copy’s editor',
  async () => {
    const athlete = unique('dupw')
    await withApp('duplicate-workout', async (page) => {
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

      await page.goto(`/workouts/${plan.id}`)
      const copyId = await app.workouts.duplicate()

      const mine = await page.client()
      const personal = (await mine.auth.me()).groups.find((g) => g.kind === 'personal')
      if (personal === undefined) throw new Error('The athlete has no personal group')
      const copy = await mine.workouts.get(copyId)
      expect(copyId).not.toBe(plan.id)
      expect(copy.ownerGroupId).toBe(personal.id)
      expect(copy.canEdit).toBe(true)
      expect(copy.days.map((d) => [d.name, d.entries.map((e) => e.exercise?.id)])).toEqual([
        ['Legs', [squat.id]],
      ])
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'a shared exercise can be duplicated, landing in the copy’s editor',
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

/** A real, if tiny, image: a 1×1 PNG. */
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/**
 * An image of the movement, uploaded from the device (#13). The limits are said before picking, and
 * a file the API refuses says why, beside the upload — one too large to send is refused by the app
 * in the API's words, since the server cuts such a body off before it can answer. An image lands in
 * the form and is saved with the exercise.
 */
test(
  'an image can be uploaded to an exercise, and a file that is not one, or too large, is refused, saying why',
  async () => {
    await withApp('upload-image', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('img'))

      const form = await app.library.newExercise()
      await form.name('Face Pull With Photo')
      await form.load('deltoid_posterior', '100')
      expect(await form.uploadLimits()).toBe('JPEG, PNG, WebP or GIF, up to 12 MB')

      const refused = await form.upload({
        name: 'notes.png',
        type: 'image/png',
        base64: btoa('not an image at all'),
      })
      expect(refused).toEqual({ refused: 'That file could not be decoded as an image' })

      const huge = await form.upload({
        name: 'huge.png',
        type: 'image/png',
        // Past the server's body limit too, which would answer with a bare 413 — a phone panorama.
        size: 20 * 1024 * 1024,
      })
      expect(huge).toEqual({
        refused: 'Too large to upload: JPEG, PNG, WebP or GIF, up to 12 MB',
      })

      const landed = await form.upload({
        name: 'face-pull.png',
        type: 'image/png',
        base64: ONE_PIXEL_PNG,
      })
      expect('row' in landed).toBe(true)
      await form.save()

      const mine = await page.client()
      const [saved] = (await mine.exercises.list({ q: 'Face Pull With Photo', limit: 1 })).items
      expect(saved?.media.map((m) => [m.kind, m.title])).toEqual([['image', 'face-pull.png']])
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
      // Nothing in it yet, it opens on the picker; put away, the session is there to finish.
      await app.session.skipPicking()
      await app.session.finish()

      await app.nav.onToday()
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * What to do next (#25): the day after the one trained last, one tap from opening the app — and the
 * history beside it, by week, a session's personal bests said on its row.
 */
test(
  'Today offers the next day of the current workout, and starts it in one tap',
  async () => {
    await withApp('today-next', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('next'))
      const mine = await page.client()
      const [squat] = (await mine.exercises.list({ q: 'Back Squat', limit: 1 })).items
      if (squat === undefined) throw new Error('The library has no squat')
      const day = (name: string) => ({
        name,
        entries: [{ exerciseId: squat.id, sets: [{ targetReps: 5, targetWeightG: 100_000 }] }],
      })
      const plan = await mine.workouts.create({ name: 'Two days', notes: null })
      const saved = await mine.workouts.replacePlan(
        plan.id,
        WorkoutPlanInput.parse({ days: [day('Heavy'), day('Light')] }),
      )
      // Trained twice, Heavy both times: a heavier squat the second time is a personal best.
      for (const kg of [100, 105]) {
        // oxlint-disable-next-line no-await-in-loop -- one session at a time.
        const session = await mine.sessions.start({
          workoutId: plan.id,
          dayId: saved.days[0]?.id ?? null,
        })
        // oxlint-disable-next-line no-await-in-loop -- in order.
        await mine.sessions.logSet(session.id, {
          exerciseId: squat.id,
          entryId: null,
          weightG: kgToG(kg),
          reps: 5,
          rpe: null,
          durationS: null,
          distanceMm: null,
          isWarmup: false,
        })
        // oxlint-disable-next-line no-await-in-loop -- finished before the next can start.
        await mine.sessions.update(session.id, { endedAt: new Date().toISOString() })
      }

      // Trained from the test process, which this app's cache cannot know of: opened afresh.
      await page.goto('/today')
      expect(await app.today.nextDay()).toBe('Light')
      expect(await app.today.weekCount()).toBe('2 sessions this week')
      const rows = await app.today.rows()
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatch(/^Heavy \| .* · 1 set \| PB$/u)
      expect(rows[1]).not.toContain('PB')

      await app.today.startNext()
      const [open] = (await mine.sessions.list({ inProgress: true, limit: 1 })).items
      expect(open?.dayName).toBe('Light')
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * The session's two ways out, told apart (#24 review): its menu's note is kept as the menu closes —
 * there is no Save to forget — and the header's back leaves it in progress, one tap from coming back.
 */
test(
  'a note is kept as the menu closes, and back leaves the session going',
  async () => {
    await withApp('notes-on-close', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('notes'))
      await app.session.startAdhoc()
      await app.session.adhoc(await app.session.addExercise('Bench')).log()
      const id = await app.session.id()
      const mine = await page.client()

      await app.session.note('Felt strong')
      await page.until(
        async () => (await mine.sessions.get(id)).notes,
        (notes) => notes === 'Felt strong',
      )

      await app.session.back()
      await app.nav.onToday()
      expect((await mine.sessions.get(id)).endedAt).toBeNull()
      await app.session.returnTo()
      expect(await app.session.id()).toBe(id)

      // Finished, its note is written on its summary, opened from history (#25).
      await app.session.finish()
      await app.nav.tab('today')
      await app.today.open(0)
      await app.session.noteOnSummary('Felt strong, go up next time')
      await page.until(
        async () => (await mine.sessions.get(id)).notes,
        (notes) => notes === 'Felt strong, go up next time',
      )
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * A past mistake fixed (#31): 100 kg typed for 80 on an old session, and a set logged twice. Fixed
 * on its summary, opened from Today's history — and what is judged from it follows: the next
 * session's squat, no best beside a mistyped 100, now is one. A session logged by mistake is then
 * deleted, and gone from the history it was opened from.
 */
test(
  'a past mistake is fixed on its summary: a set corrected, one removed, a session deleted',
  async () => {
    await withApp('fix-past-mistake', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('fix'))
      const mine = await page.client()
      const [squat] = (await mine.exercises.list({ q: 'Back Squat', limit: 1 })).items
      if (squat === undefined) throw new Error('The library has no squat')
      const sessionOf = async (...kgs: number[]): Promise<string> => {
        const session = await mine.sessions.start({ workoutId: null, dayId: null })
        for (const kg of kgs) {
          // oxlint-disable-next-line no-await-in-loop -- in order.
          await mine.sessions.logSet(session.id, {
            exerciseId: squat.id,
            entryId: null,
            weightG: kgToG(kg),
            reps: 5,
            rpe: null,
            durationS: null,
            distanceMm: null,
            isWarmup: false,
          })
        }
        await mine.sessions.update(session.id, { endedAt: new Date().toISOString() })
        return session.id
      }
      const mistyped = await sessionOf(100, 80)
      await sessionOf(85)

      // Logged from the test process, which this app's cache cannot know of: opened afresh.
      await page.goto('/today')
      expect(await app.today.history()).toHaveLength(2)
      expect((await app.today.rows())[0]).not.toContain('PB')

      await app.today.open(1)
      const [typo, twice] = await app.session.loggedIds()
      if (typo === undefined || twice === undefined) throw new Error('The summary shows no sets')
      await app.fix.open(typo)
      expect(await app.fix.title()).toBe(`${squat.name} · Set 1`)
      await app.fix.fill('weight', '80')
      await app.fix.save()
      await app.fix.open(twice)
      await app.fix.remove()
      await page.until(
        async () => await app.session.loggedLines(),
        (lines) => lines.join(' | ') === 'Set 1 | 5 × 80 kg',
      )
      expect((await mine.sessions.get(mistyped)).logs.map((l) => l.weightG)).toEqual([kgToG(80)])

      // Judged on read: with 100 gone, the 85 after it is the best it always was.
      await app.nav.tab('today')
      const rows = await page.until(
        async () => await app.today.rows(),
        (shown) => shown[0]?.endsWith('| PB') === true,
      )
      expect(rows[1]).toContain('1 set')

      await app.today.open(0)
      await app.fix.deleteSession()
      await app.nav.onToday()
      await page.until(
        async () => await app.today.history(),
        (shown) => shown.length === 1,
      )
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
 * A band-assisted pull-up (#19). Assistance is negative added weight, typed as its size with a
 * toggle, since a phone's number pad has no minus key. A plan prescribing it opens the logger
 * assisted, and the set reads as help, never as "+-20 kg". Turned to Added, the same field is load.
 */
test(
  'an assisted set is logged as assistance, and added load as load',
  async () => {
    await withApp('assisted-pull-up', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('band'))
      const mine = await page.client()
      const [pullUp] = (await mine.exercises.list({ q: 'Pull-Up', limit: 1 })).items
      if (pullUp?.tracking !== 'bodyweight_reps') throw new Error('No bodyweight Pull-Up seeded')
      const plan = await mine.workouts.create({ name: 'Band work', notes: null })
      await mine.workouts.replacePlan(
        plan.id,
        WorkoutPlanInput.parse({
          days: [
            {
              name: 'Pull',
              entries: [
                { exerciseId: pullUp.id, sets: [{ targetReps: 8, targetWeightG: -20_000 }] },
              ],
            },
          ],
        }),
      )

      await page.goto('/workouts')
      await app.workouts.openFirst()
      await app.workouts.startDay(0)
      await app.session.entry(0).log()
      await page.until(
        async () => await app.session.loggedLines(),
        (lines) => lines.includes('8 × bodyweight −20 kg (assisted)'),
      )

      // Cleared key by key and retyped, as a thumb does: the empty field in between has no sign of
      // its own, and the band it was must hold — 15 is −15, not +15.
      await app.session.entry(0).focus('weight')
      await page.keys(['Backspace', 'Backspace', '1', '5'])
      await app.session.entry(0).log()
      await page.until(
        async () => await app.session.loggedLines(),
        (lines) => lines.includes('8 × bodyweight −15 kg (assisted)'),
      )

      await app.session.entry(0).assistance('added')
      await app.session.entry(0).fill('weight', '5')
      await app.session.entry(0).log()
      await page.until(
        async () => await app.session.loggedLines(),
        (lines) => lines.includes('8 × bodyweight +5 kg'),
      )
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * No signal mid-session (#9). Sets logged offline show at once as waiting, and the server has none
 * of them; back online, they are sent in order. A set whose answer is lost on the way back — stored,
 * and the phone never told — is sent again under its key, and is still one set.
 */
test(
  'sets logged without a signal are sent when it is back, each exactly once',
  async () => {
    await withApp('offline-sets', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('off'))
      await app.planEditor.create()
      await app.planEditor.saveAndStart()
      const sessionId = await app.session.id()
      const mine = await page.client()
      const stored = async () => (await mine.sessions.get(sessionId)).logs.length

      await app.session.entry(0).fill('weight', '60')
      await app.session.entry(0).log()

      await page.goOffline()
      await app.session.entry(0).logWhileOffline()
      await app.session.entry(0).logWhileOffline()
      expect(await app.session.waiting()).toBe(2)
      expect(await stored()).toBe(1)

      await page.goOnline()
      await app.session.sent()
      expect(await stored()).toBe(3)
      expect(await app.session.loggedIds()).toHaveLength(3)

      page.loseNextAnswer(/^\/api\/sessions\/[^/]+\/logs$/u)
      await app.session.entry(0).log()
      expect(await stored()).toBe(4)
      expect(await app.session.loggedIds()).toHaveLength(4)
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * A day of two entries — the bench, two sets; the squat, one — set up over HTTP, and a session
 * started on it, the bench in focus: where choosing the squat is a choice the day would not make.
 */
async function startTwoEntryDay(page: Page): Promise<void> {
  const app = screens(page)
  const mine = await page.client()
  const found = async (q: string): Promise<string> => {
    const [exercise] = (await mine.exercises.list({ q, limit: 1 })).items
    if (exercise === undefined) throw new Error(`The seeded library has no ${q}`)
    return exercise.id
  }
  const set = (reps: number, kg: number) => ({ targetReps: reps, targetWeightG: kg * 1000 })
  const plan = await mine.workouts.create({ name: 'Two', notes: null })
  await mine.workouts.replacePlan(
    plan.id,
    WorkoutPlanInput.parse({
      days: [
        {
          name: 'Day 1',
          entries: [
            { exerciseId: await found('Bench'), sets: [set(8, 60), set(8, 60)] },
            { exerciseId: await found('Squat'), sets: [set(5, 100)] },
          ],
        },
      ],
    }),
  )
  await page.goto('/workouts')
  await app.workouts.openFirst()
  await app.workouts.startDay(0)
  await page.until(app.session.inFocus, (focus) => focus === 'entry 0')
}

/**
 * An entry chosen while a set waits for a signal stays chosen when the set is sent. A set logged
 * offline is known by its key until the server has it, then by the server's id — so a choice held
 * to the latest set's id was lost as it landed, and the focus went back where the day's order leads.
 */
test(
  'an entry chosen while a set waits for a signal stays in focus once the set is sent',
  async () => {
    await withApp('choice-across-the-signal', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('chs'))
      await startTwoEntryDay(page)

      await page.goOffline()
      await app.session.entry(0).logWhileOffline()
      // The bench has a set left, so the day would stay on it; the athlete goes to the squat.
      await app.session.entry(1).shown()
      expect(await app.session.inFocus()).toBe('entry 1')

      await page.goOnline()
      await app.session.sent()
      await page.until(
        async () => (await app.session.loggedIds()).length,
        (rows) => rows === 1,
      )
      expect(await app.session.inFocus()).toBe('entry 1')
    })
  },
  E2E_TIMEOUT_MS,
)

/** Going to pick an exercise, and putting the picker away, forgets an entry chosen (#24). */
test(
  'an entry chosen is forgotten on going to pick an exercise, picked or not',
  async () => {
    await withApp('picker-forgets', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('pkf'))
      await startTwoEntryDay(page)

      await app.session.entry(1).shown()
      expect(await app.session.inFocus()).toBe('entry 1')
      await app.session.openPicker()
      await app.session.skipPicking()
      expect(await app.session.inFocus()).toBe('entry 0')
    })
  },
  E2E_TIMEOUT_MS,
)

/** Undoing a set ends what was picked, as it ends any choice: the day has its focus back. */
test(
  'an exercise picked mid-plan gives the day back its focus once a set is undone',
  async () => {
    await withApp('undo-ends-pick', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('uep'))
      await app.planEditor.create()
      await app.planEditor.saveAndStart()

      const bench = app.session.entry(0)
      await bench.fill('weight', '60')
      await bench.log()
      const pushUp = await app.session.addExercise('Push-Up')
      expect(await app.session.inFocus()).toBe(`adhoc ${pushUp}`)

      const [logged] = await app.session.loggedIds()
      if (logged === undefined) throw new Error('The bench set is not among those logged')
      await app.session.undo(logged)
      await page.until(
        async () => (await app.session.loggedIds()).length,
        (rows) => rows === 0,
      )
      expect(await app.session.inFocus()).toBe('entry 0')
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Exercises picked together into a session without a plan (#27): the first is chosen, so it takes
 * the focus though the last was picked last — and keeps it once a set of it is logged.
 */
test(
  'exercises picked together without a plan: the first takes the focus, and keeps it',
  async () => {
    await withApp('picked-together', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('ptg'))
      await app.session.startAdhoc()
      const [bench, squat] = await app.session.addExercises(['Bench', 'Squat'])
      if (bench === undefined || squat === undefined) throw new Error('Two were picked')
      expect(await app.session.inFocus()).toBe(`adhoc ${bench}`)

      await app.session.adhoc(bench).log()
      expect(await app.session.inFocus()).toBe(`adhoc ${bench}`)
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

/** A plan you made can be deleted; what you trained from it is yours for good. */
test(
  'a deleted workout leaves the sessions trained from it in history',
  async () => {
    await withApp('delete-workout', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('del'))
      await app.planEditor.create()
      await app.planEditor.saveAndStart()
      await app.session.entry(0).fill('weight', '60')
      await app.session.entry(0).log()
      await app.session.finish()

      // Today's history is read, and stays cached in its tab, before the plan is deleted.
      await page.goto('/workouts')
      await app.nav.tab('today')
      expect(await app.today.history()).toEqual(['Day 1'])
      await app.nav.tab('workouts')
      await app.workouts.openFirst()
      await app.workouts.delete()

      // Its day is gone with it, so the session reads as one without a plan — but it is there,
      // in the history already on screen, refreshed long before it would have gone stale.
      await app.nav.tab('today')
      await page.until(
        app.today.history,
        (titles) => titles.join() === 'Without a plan',
        BEFORE_STALE_MS,
      )
      expect(await app.workouts.listed('all')).toEqual([])
    })
  },
  E2E_TIMEOUT_MS,
)

/** Deleted on another device while this one still showed it: said beside Delete, not thrown. */
test(
  'deleting a workout already deleted elsewhere says so',
  async () => {
    await withApp('delete-workout-gone', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('gone'))
      await app.planEditor.create()
      await app.planEditor.save()
      await page.goto('/workouts')
      await app.workouts.openFirst()

      const mine = await page.client()
      const [plan] = (await mine.workouts.list({})).items
      if (plan === undefined) throw new Error('The plan was not listed')
      await mine.workouts.remove(plan.id)

      expect(await app.workouts.deleteRefused()).toContain('No such workout')
    })
  },
  E2E_TIMEOUT_MS,
)

test(
  'an exercise a plan uses is not deleted, and says why; one nothing uses is',
  async () => {
    await withApp('delete-exercise', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('dex'))
      const used = unique('Used ')
      const spare = unique('Spare ')
      await app.library.create(used, 'quadriceps')
      await app.library.create(spare, 'quadriceps')
      const usedId = await app.planEditor.create(used)
      await app.planEditor.save()

      await page.goto(`/exercises/${usedId}`)
      await app.exercise.shown()
      expect(await app.exercise.deleteRefused()).toContain('used by a plan')

      await page.goto('/exercises')
      const exercise = await app.library.find(spare)
      await exercise.delete()
      const listed = await app.library.listText()
      expect(listed).toContain(used)
      expect(listed).not.toContain(spare)
    })
  },
  E2E_TIMEOUT_MS,
)

/** The Pinned filter could only ever be empty: nothing pinned a workout. */
test(
  'a pinned workout is listed under Pinned',
  async () => {
    await withApp('pin-workout', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('pin'))
      await app.planEditor.create()
      await app.planEditor.save()
      expect(await app.workouts.listed('favourites')).toEqual([])

      await page.goto('/workouts')
      await app.workouts.openFirst()
      await app.workouts.pin()
      expect(await app.workouts.listed('favourites')).toEqual(['Push Day'])
    })
  },
  E2E_TIMEOUT_MS,
)

/** A revoked token cannot be brought back, so Revoke asks twice — and then it is gone. */
test(
  'a revoked token is listed no more',
  async () => {
    await withApp('revoke-token', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('rev'))
      await app.settings.createToken('laptop')
      await app.settings.createToken('phone')
      await app.settings.revokeToken('laptop')
      const listed = await app.settings.tokenListText()
      expect(listed).toContain('phone')
      expect(listed).not.toContain('laptop')
    })
  },
  E2E_TIMEOUT_MS,
)

/** A shared group, run from the app: made, given a member by username, and rid of them again. */
test(
  'a group takes a member by username, refuses one that does not exist, and lets them go',
  async () => {
    const owner = unique('own')
    await withApp('group-members', async (page) => {
      const app = screens(page)
      await app.auth.register(owner)
      const friend = unique('fr')
      const coEditor = unique('co')
      await signUp(friend)
      await signUp(coEditor)

      await app.groups.open()
      await app.groups.create('Squad')
      await app.groups.openGroup('Squad')
      // Its only editor: it cannot leave until there is another.
      expect(await app.groups.canLeave()).toBe(false)

      await app.groups.addMember(friend, 'reader')
      expect((await app.groups.members()).toSorted()).toEqual(
        [`${friend}: reader`, `${owner}: editor`].toSorted(),
      )
      expect(await app.groups.addMemberRefused(`${friend}zz`)).toContain('No such user')

      await app.groups.remove(friend)
      expect(await app.groups.members()).toEqual([`${owner}: editor`])

      // A second editor, and the first may leave.
      await app.groups.addMember(coEditor, 'editor')
      await page.until(app.groups.canLeave, (offered) => offered)
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Leaving takes what the group showed you with it — from lists already on screen, refreshed long
 * before they would have gone stale, because every read that membership decides embeds the group.
 */
test(
  'leaving a group takes its plans out of the list you already had open',
  async () => {
    const athlete = unique('lv')
    await withApp('leave-group', async (page) => {
      const app = screens(page)
      await app.auth.register(athlete)

      const coach = await signUp(`${athlete}c`)
      const squad = await coach.api.groups.create({ name: 'Squad' })
      await coach.api.groups.addMember(squad.id, { username: athlete, role: 'reader' })
      const plan = await coach.api.workouts.create({ name: 'Coached', notes: null })
      await coach.api.workouts.transfer(plan.id, { toGroupId: squad.id })

      expect(await app.workouts.listed('all')).toEqual(['Coached'])
      await app.groups.open()
      await app.groups.openGroup('Squad')
      await app.groups.leave()
      expect(await app.groups.names()).not.toContain('Squad')

      await app.nav.tab('workouts')
      await page.until(app.workouts.showing, (names) => names.length === 0, BEFORE_STALE_MS)
    })
  },
  E2E_TIMEOUT_MS,
)

/** Transferred into a group you edit — never one you only read — and it says where it now is. */
test(
  'an exercise is transferred into a group you edit, and says it is there',
  async () => {
    const owner = unique('tr')
    await withApp('transfer-exercise', async (page) => {
      const app = screens(page)
      await app.auth.register(owner)
      const mine = await page.client()
      await mine.groups.create({ name: 'Squad' })
      const coach = await signUp(`${owner}c`)
      const coached = await coach.api.groups.create({ name: 'Coached' })
      await coach.api.groups.addMember(coached.id, { username: owner, role: 'reader' })

      const name = unique('Lift ')
      await app.library.create(name, 'quadriceps')
      await page.goto('/exercises')
      await app.library.find(name)
      expect(await app.exercise.placement.owner()).toBe('In your personal group')
      expect(await app.exercise.placement.targets()).toEqual(['Squad'])

      await app.exercise.placement.transferTo('Squad')
      await app.exercise.placement.transferTo('your personal group')

      // A reader is told where the coach's exercise is, and offered nothing to do about it.
      const theirs = await coach.api.exercises.create(
        ExerciseCreate.parse({
          name: unique('Coached '),
          tracking: 'weight_reps',
          muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
        }),
      )
      await coach.api.exercises.transfer(theirs.id, { toGroupId: coached.id })
      await page.goto(`/exercises/${theirs.id}`)
      expect(await app.exercise.placement.owner()).toBe('In Coached')
      expect(await app.exercise.placement.canTransfer()).toBe(false)
    })
  },
  E2E_TIMEOUT_MS,
)

/** The server's refusal, as it is: a plan goes only where every exercise it uses can be read. */
test(
  'a plan using an exercise the group cannot see is not transferred, and says which',
  async () => {
    await withApp('transfer-workout-refused', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('trw'))
      const lift = unique('Private ')
      await app.library.create(lift, 'quadriceps')
      await app.planEditor.create(lift)
      await app.planEditor.save()
      await (await page.client()).groups.create({ name: 'Squad' })

      await page.goto('/workouts')
      await app.workouts.openFirst()
      expect(await app.workouts.placement.transferRefused('Squad')).toContain(
        `That group cannot see "${lift}"`,
      )
      expect(await app.workouts.placement.owner()).toBe('In your personal group')
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Progression, automatic: a clean session moves the next one's target, the logger starts from it
 * and says so, beside what was done last time — and the plan itself is left as written.
 */
test(
  'a clean session pre-fills the next one with the advanced target, and shows last time',
  async () => {
    await withApp('prefill-next-target', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('pf'))
      const mine = await page.client()
      const [bench] = (await mine.exercises.list({ q: 'Bench', limit: 1 })).items
      if (bench === undefined) throw new Error('The seeded library has no bench press')
      const plan = await mine.workouts.create({ name: 'Strength', notes: null })
      const five = { targetReps: 5, targetWeightG: 60_000 }
      await mine.workouts.replacePlan(
        plan.id,
        WorkoutPlanInput.parse({
          days: [
            {
              name: 'Heavy',
              entries: [
                {
                  exerciseId: bench.id,
                  progression: { kind: 'linear', incrementG: 2500, afterSuccesses: 1 },
                  sets: [five, five, five],
                },
              ],
            },
          ],
        }),
      )

      await page.goto('/workouts')
      await app.workouts.openFirst()
      await app.workouts.startDay(0)
      const first = app.session.entry(0)
      expect(await first.target()).toBe('Prescribed 5 × 60 kg')
      expect(await first.last()).toBeNull()
      await first.log()
      await first.log()
      await first.log()
      await app.session.finish()

      await page.goto('/workouts')
      await app.workouts.openFirst()
      await app.workouts.startDay(0)
      const next = app.session.entry(0)
      expect(await next.value('weight')).toBe('62.5')
      expect(await next.target()).toBe('Progressed to 5 × 62.5 kg · the plan says 5 × 60 kg')
      expect(await next.last()).toBe('Last time 5, 5, 5 × 60 kg')

      // The plan is as its author wrote it: progression carries it, it does not rewrite it.
      const written = (await mine.workouts.get(plan.id)).days[0]?.entries[0]?.sets
      expect(written?.map((s) => s.target.weightG)).toEqual([60_000, 60_000, 60_000])
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * The workout's own moves (#24): once an entry has all it asked, the set just logged offers one
 * more; a swap mid-plan takes the focus, logged with no entry, and rests the default two minutes,
 * there being no entry to say otherwise. When the day is done, and which entry "+ set" goes to, are
 * the contract's `workoutView`, tested beside it; this proves the taps reach it.
 */
test(
  'a done entry takes one more set, and a swap mid-plan takes the focus and rests two minutes',
  async () => {
    await withApp('another-and-swap', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('swap'))
      await app.planEditor.create()
      await app.planEditor.saveAndStart()

      const bench = app.session.entry(0)
      await bench.fill('weight', '60')
      for (let i = 0; i < 3; i += 1) await bench.log()
      await app.session.another()
      await bench.log()
      expect(await bench.done()).toBe('4 done')

      const pushUp = await app.session.addExercise('Push-Up')
      const swap = app.session.adhoc(pushUp)
      await swap.fill('reps', '12')
      await swap.log()
      expect(await swap.done()).toBe('1 done')
      expect(await swap.rest()).toMatch(/^Rest (2:00|1:5\d)$/u)

      const mine = await page.client()
      const logs = (await mine.sessions.get(await app.session.id())).logs
      expect(logs.map((l) => [l.entryId === null, l.reps])).toEqual([
        [false, 8],
        [false, 8],
        [false, 8],
        [false, 8],
        [true, 12],
      ])
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * An exercise added mid-plan takes the focus as a choice does: its own set keeps it there — a swap
 * logged last — and a set of the day gives the day its focus back. It used to hold the focus over
 * the day's order for as long as it was the last exercise added.
 */
test(
  'an exercise added mid-plan gives the day back its focus once a set of the day is logged',
  async () => {
    await withApp('added-gives-back', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('agb'))
      await app.planEditor.create()
      await app.planEditor.saveAndStart()

      const bench = app.session.entry(0)
      await bench.fill('weight', '60')
      await bench.log()
      const pushUp = await app.session.addExercise('Push-Up')
      expect(await app.session.inFocus()).toBe(`adhoc ${pushUp}`)
      const swap = app.session.adhoc(pushUp)
      await swap.fill('reps', '12')
      await swap.log()
      expect(await app.session.inFocus()).toBe(`adhoc ${pushUp}`)

      await bench.log()
      expect(await app.session.inFocus()).toBe('entry 0')
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * RPE, asked as reps in reserve: a target set in the editor, said of a set before it is logged
 * (#37) — never pre-filled from the plan's, never carried to the next set, which would be answers
 * the athlete did not give, and not asked again once the set is logged.
 */
test(
  'a set logged with one rep left reads back as RPE 9, and the next is asked afresh',
  async () => {
    await withApp('rpe-reserve', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('rpe'))
      await app.planEditor.create()
      await app.planEditor.entry(0, 0).reserve('2')
      await app.planEditor.saveAndStart()

      const bench = app.session.entry(0)
      expect(await bench.target()).toContain('· 2 in reserve')
      // Asked before the set, and not filled in from the plan's 2: the answer is the athlete's.
      expect(await bench.reserveChosen()).toBe('none')
      await bench.reserve('1')
      // Refused — no bar holds 9999 kg — nothing logged, and the set is asked again whole.
      await bench.fill('weight', '9999')
      await bench.attemptLog()
      expect(await app.session.error()).not.toBeNull()
      await bench.reserve('1')
      await bench.fill('weight', '60')
      await bench.log()
      // The next set is asked afresh: its answer is its own. The one logged says its own.
      expect(await bench.reserveChosen()).toBe('none')
      expect(await app.session.lastSetText()).toBe('8 × 60 kg · 1 in reserve')
      await bench.log()
      expect(await app.session.loggedLines()).toContain('8 × 60 kg · 1 in reserve')

      const mine = await page.client()
      const [latest] = (await mine.sessions.list({ limit: 1 })).items
      if (latest === undefined) throw new Error('The session was not listed')
      const logs = (await mine.sessions.get(latest.id)).logs
      expect(logs.map((l) => l.rpe)).toEqual([9, null])
      // And the editor's 2 in reserve was saved as the plan's target: RPE 8.
      const [plan] = (await mine.workouts.list({})).items
      if (plan === undefined) throw new Error('The plan was not listed')
      const saved = (await mine.workouts.get(plan.id)).days[0]?.entries[0]?.sets
      expect(saved?.filter((s) => !s.isWarmup).map((s) => s.target.rpe)).toEqual([8, 8, 8])
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * What the plan tells the athlete beyond its numbers: the rest after a working set, counted down
 * from when the set was logged, and a cue under the exercise — both written in the editor.
 */
test(
  "a working set starts the entry's rest, and the plan's cue is shown with the exercise",
  async () => {
    await withApp('rest-and-cue', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('rest'))
      await app.planEditor.create()
      const entry = app.planEditor.entry(0, 0)
      await entry.rest('5')
      await entry.cue('Pause 1 s at the chest')
      await app.planEditor.saveAndStart()

      const bench = app.session.entry(0)
      expect(await bench.cue()).toBe('Pause 1 s at the chest')
      expect(await bench.rest()).toBeNull()
      await bench.log()
      expect(await bench.rest()).toMatch(/^Rest 0:0[1-5]$/u)
      await page.until(bench.rest, (said) => said === 'Rest over — ready for the next set', 8000)
      // The clock stood still once it was over; the next set starts it again, from the full rest.
      await bench.log()
      expect(await bench.rest()).toMatch(/^Rest 0:0[1-5]$/u)
      await page.until(bench.rest, (said) => said === 'Rest over — ready for the next set', 8000)
    })
  },
  E2E_TIMEOUT_MS,
)

/** Am I progressing? The exercise screen answers: its trend, and whether it has stalled. */
test(
  'an exercise shows its estimated max over time, and says when it has stalled',
  async () => {
    await withApp('estimated-max-trend', async (page) => {
      const app = screens(page)
      await app.auth.register(unique('trend'))
      const mine = await page.client()
      const lift = await mine.exercises.create(
        ExerciseCreate.parse({
          name: unique('Press '),
          muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
        }),
      )
      const endurance = await mine.exercises.create(
        ExerciseCreate.parse({
          name: unique('Curl '),
          muscles: [{ muscle: 'biceps_brachii', loadPct: 100 }],
        }),
      )
      // 55, then 60 three sessions running: a rise, then a stall. And a curl stuck at fifteen reps,
      // past what the estimate reads — a stall with no trend to draw.
      for (const weightG of [55_000, 60_000, 60_000, 60_000]) {
        // oxlint-disable-next-line no-await-in-loop -- sessions in order: what is under test.
        const session = await mine.sessions.start({ workoutId: null, dayId: null })
        for (const set of [
          { exerciseId: lift.id, weightG, reps: 5 },
          { exerciseId: endurance.id, weightG: 10_000, reps: 15 },
        ]) {
          // oxlint-disable-next-line no-await-in-loop -- one set after another.
          await mine.sessions.logSet(session.id, LogSetInput.parse(set))
        }
        // oxlint-disable-next-line no-await-in-loop -- finished before the next can start.
        await mine.sessions.update(session.id, { endedAt: new Date().toISOString() })
      }

      await page.goto(`/exercises/${lift.id}`)
      await app.exercise.shown()
      // 60 × (1 + 5/30): five reps at 60 kg suggest 70 kg once.
      expect(await app.exercise.trend()).toEqual({
        first: '64 kg at first',
        latest: '70 kg now',
        stalled: 'Stalled · 3 sessions at 5 × 60 kg',
      })

      await page.goto(`/exercises/${endurance.id}`)
      await app.exercise.shown()
      expect(await app.exercise.trend()).toEqual({
        first: null,
        latest: null,
        stalled: 'Stalled · 4 sessions at 15 × 10 kg',
      })
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * What Chrome asks of a manifest before it offers to install a site, as its installability criteria
 * document them: a name, a start, a display that is an app's, and icons. A copy of the rules, not
 * Chrome: this WebView is WebKit, which never decides whether to offer an install. What it does
 * prove for real is the rest — the files served, and a worker registered over the whole app.
 */
const Installable = z.object({
  name: z.string().min(1),
  short_name: z.string().min(1),
  start_url: z.string().min(1),
  display: z.enum(['fullscreen', 'standalone', 'minimal-ui']),
  icons: z.array(z.object({ src: z.string(), sizes: z.string(), type: z.string() })).min(1),
  prefer_related_applications: z.literal(false).optional(),
})

test(
  'installable: a manifest meeting Chrome’s criteria, its icons served, a worker over the app',
  async () => {
    await withApp('installable', async (page) => {
      const app = screens(page)
      const { manifest, icons } = await app.install.manifest()
      expect(Installable.safeParse(manifest).error?.issues ?? []).toEqual([])
      expect(icons.filter((icon) => icon.status !== 200)).toEqual([])
      // The two sizes installers ask for, each served as a PNG of exactly that size.
      for (const px of [192, 512]) {
        expect(
          icons.some(
            (icon) =>
              icon.type?.startsWith('image/png') === true &&
              icon.size?.width === px &&
              icon.size.height === px,
          ),
        ).toBe(true)
      }
      expect(await app.install.workerScope()).toBe(`${page.origin}/`)
    })
  },
  E2E_TIMEOUT_MS,
)

/** A flaky gym signal: the app opens from what the worker kept, with nothing answering at all. */
test(
  'without a signal, the installed app still opens',
  async () => {
    await withApp('offline-shell', async (page) => {
      const app = screens(page)
      await app.install.workerScope()
      page.cutNetwork()
      await page.goto('/')
      await app.auth.onLoginScreen()
    })
  },
  E2E_TIMEOUT_MS,
)

/**
 * Signed in, at the gym, no signal: the app opens and says it cannot reach the server — and the
 * session is still there, not signed out into needing a password and a signal to get back in.
 */
test(
  'without a signal, a signed-in app keeps its session',
  async () => {
    await withApp(
      'offline-signed-in',
      async (page) => {
        const app = screens(page)
        await app.auth.register(unique('gym'))
        await app.install.workerScope()
        page.cutNetwork()
        await page.goto('/')
        await app.auth.onUnreachable()
        // The token the page kept still works: the API itself is up, only the site is cut.
        const { user } = await (await page.client()).auth.me()
        expect(user.username).toStartWith('gym')
      },
      // Asking the server who the token is: the one request a cut network must fail.
      { allowErrors: [/\[network\] Load failed/u] },
    )
  },
  E2E_TIMEOUT_MS,
)
