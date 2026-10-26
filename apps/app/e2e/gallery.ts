import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { SQL } from 'bun'
import { type Workout, WorkoutPlanInput, kgToG, mToMm } from '@cedo/contract'
import type { ApiClient } from '../src/api/client.ts'
import {
  type Layout,
  type Page,
  TEST_DATABASE_URL,
  sharedApi,
  signUp,
  stopSharedApi,
  withApp,
} from './harness.ts'
import { unique } from './screens/auth.ts'

/**
 * `bun run gallery [--only <state>] [--layout mobile|desktop]` — every screen, in the states a
 * person actually meets, at a phone's width and a laptop's, to `.artifacts/gallery/`.
 *
 * `shot` renders one route for an account with nothing in it, cut at the fold. Judging how the app
 * LOOKS needs what it looks like in use: a plan of four days, weeks of history behind it, a session
 * half done, a coach's group — and the whole page, not its first screen. So each layout seeds one
 * such account, walks every screen and the states inside them (the picker open, a set mid-rest),
 * and photographs each down to its end, a frame per viewport. `index.html` lays mobile and desktop
 * side by side, state by state. See docs/08-frontend.md, "Seeing what you built".
 *
 * Tooling, not a test: it asserts nothing, and the one thing it does that a journey may not — dating
 * its fixture sessions into the past, in its own throwaway database — is what makes a history and a
 * trend look like weeks of training rather than one afternoon.
 */

const OUT = join(import.meta.dir, '..', '..', '..', '.artifacts', 'gallery')
const LAYOUTS: Readonly<Record<string, Layout>> = { mobile: 'phone', desktop: 'desktop' }
const MAX_FRAMES = 6

const args = Bun.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined
const layoutArg = args.includes('--layout') ? args[args.indexOf('--layout') + 1] : undefined
const layouts = Object.entries(LAYOUTS).filter(
  ([name]) => layoutArg === undefined || name === layoutArg,
)

// ---------------------------------------------------------------------------------------------
// The world: one athlete's training, as it looks a few weeks into a block
// ---------------------------------------------------------------------------------------------

interface World {
  readonly username: string
  readonly password: string
  readonly planId: string
  readonly squatId: string
  readonly customId: string
  readonly clubId: string
}

const findExercise = async (api: ApiClient, name: string): Promise<string> => {
  const found = (await api.exercises.list({ q: name, limit: 10 })).items.find(
    (e) => e.name === name,
  )
  if (found === undefined) throw new Error(`The seeded library has no ${name}`)
  return found.id
}

/** A weight lift: `sets` working sets of `reps` at `kg`, with a warm-up or two before heavy ones. */
const lift = (
  exerciseId: string,
  sets: number,
  reps: number,
  kg: number,
  extra: { warmups?: number; cue?: string; rest?: number; linear?: number } = {},
) => ({
  exerciseId,
  restSeconds: extra.rest ?? 120,
  cue: extra.cue ?? null,
  progression:
    extra.linear === undefined
      ? {
          kind: 'double' as const,
          repRange: [reps, reps + 2] as [number, number],
          incrementG: 2500,
        }
      : { kind: 'linear' as const, incrementG: kgToG(extra.linear), afterSuccesses: 1 },
  sets: [
    ...Array.from({ length: extra.warmups ?? 0 }, (_, i) => ({
      targetReps: 5,
      targetWeightG: kgToG(Math.round((kg * (0.4 + 0.2 * i)) / 2.5) * 2.5),
      isWarmup: true,
    })),
    ...Array.from({ length: sets }, () => ({ targetReps: reps, targetWeightG: kgToG(kg) })),
  ],
})

async function seed(): Promise<World> {
  const username = unique('sam')
  const { api } = await signUp(username, 'Sam Rivera')

  const ex = Object.fromEntries(
    await Promise.all(
      [
        'Barbell Back Squat',
        'Romanian Deadlift',
        'Leg Press',
        'Standing Calf Raise',
        'Plank',
        'Barbell Bench Press',
        'Barbell Row',
        'Overhead Press',
        'Pull-Up',
        'Face Pull',
        'Conventional Deadlift',
        'Front Squat',
        'Bulgarian Split Squat',
        'Hanging Leg Raise',
        'Rowing Machine',
        'Incline Dumbbell Press',
        'Lat Pulldown',
        'Dumbbell Lateral Raise',
        'Triceps Pushdown',
        'Barbell Curl',
      ].map(async (name) => [name, await findExercise(api, name)] as const),
    ),
  )
  const at = (name: string): string => {
    const id = ex[name]
    if (id === undefined) throw new Error(`No ${name}`)
    return id
  }

  const video = await api.media.link({ url: 'https://www.youtube.com/watch?v=MeIiIdhvXT4' })
  const custom = await api.exercises.create({
    name: 'Tempo Goblet Squat',
    tracking: 'weight_reps',
    equipment: 'Dumbbell',
    description: 'A goblet squat with a three-second descent and a pause at the bottom.',
    instructions:
      'Hold the dumbbell at your chest. Descend for three seconds, pause one, drive up. Keep your elbows inside your knees.',
    muscles: [
      { muscle: 'quadriceps', loadPct: 60 },
      { muscle: 'gluteus_maximus', loadPct: 30 },
      { muscle: 'adductors', loadPct: 10 },
    ],
    mediaIds: [video.id],
  })

  const created = await api.workouts.create({
    name: 'Upper / Lower — Block 2',
    notes: 'Four days a week. Add weight when every set hits the top of the range.',
  })
  const plan: Workout = await api.workouts.replacePlan(
    created.id,
    WorkoutPlanInput.parse({
      days: [
        {
          name: 'Lower A',
          entries: [
            lift(at('Barbell Back Squat'), 5, 5, 100, {
              warmups: 2,
              linear: 2.5,
              rest: 180,
              cue: 'Brace before you unrack. Hips and shoulders rise together.',
            }),
            lift(at('Romanian Deadlift'), 3, 8, 80),
            lift(at('Leg Press'), 3, 12, 160, { rest: 90 }),
            lift(at('Standing Calf Raise'), 4, 12, 60, { rest: 60 }),
            {
              exerciseId: at('Plank'),
              restSeconds: 60,
              progression: { kind: 'linear_duration', incrementS: 10, afterSuccesses: 1 },
              sets: [{ targetDurationS: 60 }, { targetDurationS: 60 }, { targetDurationS: 60 }],
            },
          ],
        },
        {
          name: 'Upper A',
          entries: [
            lift(at('Barbell Bench Press'), 4, 6, 85, { warmups: 2, rest: 180 }),
            lift(at('Barbell Row'), 4, 8, 70),
            lift(at('Overhead Press'), 3, 8, 50),
            {
              exerciseId: at('Pull-Up'),
              restSeconds: 120,
              sets: [{ targetReps: 8 }, { targetReps: 8 }, { targetReps: 8 }],
            },
            { ...lift(at('Face Pull'), 3, 15, 20, { rest: 60 }), supersetGroup: 'A' },
            { ...lift(at('Dumbbell Lateral Raise'), 3, 15, 10, { rest: 60 }), supersetGroup: 'A' },
          ],
        },
        {
          name: 'Lower B',
          entries: [
            lift(at('Conventional Deadlift'), 3, 5, 140, { warmups: 3, linear: 5, rest: 240 }),
            lift(at('Front Squat'), 3, 6, 75),
            lift(at('Bulgarian Split Squat'), 3, 10, 20, { rest: 90 }),
            {
              exerciseId: at('Hanging Leg Raise'),
              restSeconds: 60,
              sets: [{ targetReps: 12 }, { targetReps: 12 }, { targetReps: 12 }],
            },
            {
              exerciseId: at('Rowing Machine'),
              restSeconds: null,
              progression: { kind: 'linear_distance', incrementMm: 250_000, afterSuccesses: 1 },
              sets: [{ targetDistanceMm: mToMm(2000), targetDurationS: 480 }],
            },
          ],
        },
        {
          name: 'Upper B',
          entries: [
            lift(at('Incline Dumbbell Press'), 4, 10, 30),
            lift(at('Lat Pulldown'), 4, 10, 65),
            lift(at('Triceps Pushdown'), 3, 12, 30, { rest: 60 }),
            lift(at('Barbell Curl'), 3, 10, 35, { rest: 60 }),
            lift(custom.id, 3, 10, 26),
          ],
        },
      ],
    }),
  )
  await api.workouts.favourite(plan.id, true)

  // Three weeks, four days a week, oldest first: each set as prescribed, a little heavier each week.
  const notes = [null, 'Squat moved fast today.', null, 'Left knee a bit cranky.', null, null]
  const db = new SQL(TEST_DATABASE_URL)
  const weeks = 3
  for (let n = 0; n < weeks * 4; n += 1) {
    const day = plan.days[n % 4]
    if (day === undefined) continue
    const week = Math.floor(n / 4)
    const session = await api.sessions.start({ workoutId: plan.id, dayId: day.id })
    for (const entry of day.entries) {
      for (const set of entry.sets) {
        const { target } = set
        await api.sessions.logSet(session.id, {
          exerciseId: entry.exerciseId,
          entryId: entry.id,
          weightG:
            target.weightG === null ? null : target.weightG + (set.isWarmup ? 0 : week * 2500),
          reps: target.reps,
          durationS: target.durationS === null ? null : target.durationS + week * 5,
          distanceMm: target.distanceMm,
          rpe: set.isWarmup || target.reps === null ? null : 7 + (week % 3) * 0.5,
          isWarmup: set.isWarmup,
        })
      }
    }
    await api.sessions.update(session.id, {
      endedAt: new Date().toISOString(),
      notes: notes[n % notes.length] ?? null,
    })
    // Dated back: day n of the block, at about six in the evening, an hour and ten long.
    const daysAgo = Math.round((weeks * 4 - n) * 1.75)
    await db`update workout_sessions
      set started_at = date_trunc('day', now()) - make_interval(days => ${daysAgo}) + interval '18 hours',
          ended_at = date_trunc('day', now()) - make_interval(days => ${daysAgo}) + interval '19 hours 10 minutes'
      where id = ${session.id}`
    await db`update set_logs l
      set logged_at = s.started_at + make_interval(mins => (row_number * 3)::int)
      from workout_sessions s,
        (select id, row_number() over (order by logged_at, set_index) from set_logs where session_id = ${session.id}) o
      where l.session_id = ${session.id} and s.id = l.session_id and o.id = l.id`
  }
  await db.close()

  // A coach's club Sam belongs to and shares training with, with a plan of the coach's in it.
  const coach = await signUp(unique('dana'))
  const club = await coach.api.groups.create({ name: 'Northside Barbell Club' })
  await coach.api.groups.addMember(club.id, { username, role: 'reader' })
  const coachPlan = await coach.api.workouts.create({ name: 'Squat Cycle — Peaking', notes: null })
  await coach.api.workouts.replacePlan(
    coachPlan.id,
    WorkoutPlanInput.parse({
      days: [
        { name: 'Heavy', entries: [lift(at('Barbell Back Squat'), 3, 3, 120, { warmups: 3 })] },
      ],
    }),
  )
  await coach.api.workouts.transfer(coachPlan.id, { toGroupId: club.id })
  await api.groups.setSharing(club.id, { sharesTraining: true })
  await api.tokens.create({ name: 'Claude', expiresInDays: null })

  return {
    username,
    password: `${username}-password`,
    planId: plan.id,
    squatId: at('Barbell Back Squat'),
    customId: custom.id,
    clubId: club.id,
  }
}

/** Today's Lower A, two warm-ups and a working set in — the last one a minute ago, so rest runs. */
async function startToday(page: Page, world: World): Promise<string> {
  const api = await page.client()
  const plan = await api.workouts.get(world.planId)
  const day = plan.days[0]
  const squat = day?.entries[0]
  if (day === undefined || squat === undefined) throw new Error('The plan has no Lower A')
  const session = await api.sessions.start({ workoutId: plan.id, dayId: day.id })
  for (const set of squat.sets.slice(0, 3)) {
    await api.sessions.logSet(session.id, {
      exerciseId: squat.exerciseId,
      entryId: squat.id,
      weightG: (set.target.weightG ?? 0) + (set.isWarmup ? 0 : 7500),
      reps: set.target.reps,
      rpe: set.isWarmup ? null : 7.5,
      durationS: null,
      distanceMm: null,
      isWarmup: set.isWarmup,
    })
  }
  const db = new SQL(TEST_DATABASE_URL)
  await db`update workout_sessions set started_at = now() - interval '12 minutes' where id = ${session.id}`
  // Each set two and a half minutes after the one before, the last a minute ago: rest is running.
  await db`update set_logs l set logged_at = now() - make_interval(secs => 60 + (o.last - o.rn) * 150)
    from (select id, row_number() over (order by logged_at, set_index) as rn,
            count(*) over () as last from set_logs where session_id = ${session.id}) o
    where l.id = o.id`
  await db.close()
  return session.id
}

// ---------------------------------------------------------------------------------------------
// Photographing
// ---------------------------------------------------------------------------------------------

const shots: { state: string; layout: string; frames: string[] }[] = []

/**
 * The state as it stands, top to bottom: a frame per viewport of the page's scroller — the tallest
 * scrollable element, which on web is the screen's ScrollView, not the window.
 */
async function photograph(page: Page, layout: string, state: string): Promise<void> {
  if (only !== undefined && !state.includes(only)) return
  // Settled: no spinner shown, and a beat for images and fonts.
  await page.until(
    async () =>
      await page.evaluate(
        `[...document.querySelectorAll('[data-testid$="-loading"]')].some((e) => e.offsetParent != null)`,
      ),
    (loading) => loading === false,
    10_000,
  )
  await Bun.sleep(400)
  const pick = `(() => { const all = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY.match(/auto|scroll/)); return all.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? null })()`
  const height = (await page.evaluate(
    `(() => { const s = ${pick}; return s ? [s.scrollHeight, s.clientHeight] : [0, 0] })()`,
  )) as [number, number]
  const [scrollHeight, clientHeight] = height
  const count =
    clientHeight === 0
      ? 1
      : Math.min(MAX_FRAMES, Math.ceil((scrollHeight - 40) / Math.max(clientHeight - 120, 1)))
  const frames: string[] = []
  for (let i = 0; i < count; i += 1) {
    await page.evaluate(
      `(() => { const s = ${pick}; if (s) s.scrollTop = ${i} * (s.clientHeight - 120) })()`,
    )
    await Bun.sleep(150)
    const name = `${layout}/${state}${count > 1 ? `-${i + 1}` : ''}`
    await page.screenshot(`gallery/${name}`)
    frames.push(`${name}.png`)
  }
  await page.evaluate(`(() => { const s = ${pick}; if (s) s.scrollTop = 0 })()`)
  shots.push({ state, layout, frames })
  console.log(`  ${layout} ${state}: ${frames.length} frame${frames.length === 1 ? '' : 's'}`)
}

async function show(page: Page, path: string, screen: string): Promise<void> {
  await page.goto(path)
  await page.waitFor(screen, 15_000)
}

async function signIn(page: Page, world: World): Promise<void> {
  await page.goto('/login')
  await page.waitFor('login-username')
  await page.fill('login-username', world.username)
  await page.fill('login-password', world.password)
  await page.click('[data-testid="login-submit"]')
  await page.waitFor('today-screen', 15_000)
}

async function walk(page: Page, layout: string, world: World): Promise<void> {
  const snap = async (state: string) => await photograph(page, layout, state)

  await signIn(page, world)
  await snap('01-today-between-sessions')

  const sessionId = await startToday(page, world)
  await show(page, '/today', 'today-screen')
  await snap('02-today-session-in-progress')

  await show(page, `/today/session/${sessionId}`, 'session-screen')
  await snap('03-session-live')
  await page.click('[data-testid="session-header-menu"]')
  await page.waitFor('session-menu')
  await snap('03b-session-menu')
  await page.click('[data-testid="session-menu-close"]')
  await page.click('[data-testid="log-entry-0-how-to"]')
  await page.waitFor('how-to')
  await snap('03c-session-how-to')
  await page.click('[data-testid="how-to-close"]')

  await show(page, '/workouts', 'workouts-screen')
  await snap('04-workouts')
  await show(page, `/workouts/${world.planId}`, 'workout-detail-screen')
  await snap('05-workout-outline')
  // An entry's settings: a sheet on a phone, the panel beside the outline on a desktop (#26).
  await page.click('[data-testid="plan-line-0-0"]')
  await page.waitFor('plan-entry-0-0')
  await snap('06-workout-entry')
  if (await page.shown('entry-sheet')) await page.click('[data-testid="entry-sheet-close"]')
  await page.click('[data-testid="add-entry-0"]')
  await page.waitFor('exercise-picker')
  await snap('07-workout-edit-picker')

  await show(page, '/exercises', 'exercises-screen')
  await snap('08-exercises')
  // On a desktop, an exercise opens beside the list (#29).
  if (await page.shown('exercise-pane')) {
    await page.click(`[data-testid="exercise-row-${world.customId}"]`)
    await page.waitFor('exercise-detail-pane')
    await snap('08b-exercises-pane')
  }
  await show(page, `/exercises/${world.squatId}`, 'exercise-detail-screen')
  await snap('09-exercise-detail-with-history')
  await show(page, `/exercises/${world.customId}`, 'exercise-detail-screen')
  await snap('10-exercise-detail-own-with-video')
  await show(page, `/exercises/${world.customId}/edit`, 'exercise-edit-screen')
  await snap('11-exercise-edit')
  await show(page, '/exercises/new', 'exercise-new-screen')
  await snap('12-exercise-new')

  await show(page, '/progress', 'progress-consistency')
  await snap('12b-progress')
  await show(page, '/settings', 'settings-screen')
  await snap('13-settings')
  await show(page, '/settings/groups', 'groups-screen')
  await snap('14-groups')
  await show(page, `/settings/groups/${world.clubId}`, 'group-detail-screen')
  await snap('15-group-detail')
  await show(page, '/settings/tokens', 'tokens-screen')
  await snap('16-tokens')
  await show(page, '/settings/connect', 'connect-screen')
  await snap('17-connect')

  // Last, as it ends the session every screen above showed in progress.
  await show(page, `/today/session/${sessionId}`, 'session-screen')
  await page.click('[data-testid="session-header-menu"]')
  await page.click('[data-testid="finish-session"]')
  await page.click('[data-testid="finish-session-confirm"]')
  await page.waitFor('session-finished')
  await snap('18-session-finished')
}

function index(): string {
  const states = [...new Set(shots.map((s) => s.state))].toSorted()
  const column = (state: string, layout: string) =>
    (shots.find((s) => s.state === state && s.layout === layout)?.frames ?? [])
      .map((f) => `<img src="${f}" loading="lazy">`)
      .join('')
  return `<!doctype html><meta charset="utf-8"><title>cedo gallery</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:24px}h2{margin:40px 0 8px}
.row{display:flex;gap:24px;align-items:flex-start}.col{display:flex;flex-direction:column;gap:8px}
.mobile img{width:280px}.desktop img{width:820px}img{border:1px solid #333}</style>
<h1>cedo — every screen, mobile and desktop</h1>
${states
  .map(
    (state) =>
      `<h2>${state}</h2><div class="row"><div class="col mobile">${column(state, 'mobile')}</div><div class="col desktop">${column(state, 'desktop')}</div></div>`,
  )
  .join('\n')}`
}

// ---------------------------------------------------------------------------------------------

if (only === undefined) await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
await sharedApi()
let failed = false
for (const [name, layout] of layouts) {
  console.log(`${name} (${layout})`)
  try {
    await withApp(
      `gallery/${name}/00-login`,
      async (page) => {
        await page.goto('/login')
        await page.waitFor('login-screen')
        await photograph(page, name, '00-login')
      },
      { layout },
    )
    const world = await seed()
    await withApp(`gallery/${name}/last`, async (page) => await walk(page, name, world), {
      layout,
    })
  } catch (error) {
    failed = true
    console.error(error instanceof Error ? error.message : String(error))
  }
}
await Bun.write(join(OUT, 'index.html'), index())
console.log(`\n${shots.length} states → ${join('.artifacts', 'gallery', 'index.html')}`)
await stopSharedApi()
process.exit(failed ? 1 : 0)
