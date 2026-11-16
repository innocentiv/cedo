import { describe, expect, test } from 'bun:test'
import { Athlete, SessionDetail, SetLog, WorkoutSessionSummary, page } from '@cedo/contract'
import {
  athleteLines,
  sessionDetail,
  sessionLines,
  sessionLogged,
  setLine,
} from './format-coaching.ts'

/**
 * What the coaching tools say, as the model reads it: who shares their training, a run of
 * someone's sessions, and one session set by set — a contract value in, the whole text out, with no
 * wire and no database (docs/07-mcp.md, "Adding a tool"). That the tools reach these, for the
 * caller and for an athlete of theirs, is `mcp.test.ts`'s, through the wire.
 */

const SAM = '00000000-0000-4000-8000-000000000001'
const ALEX = '00000000-0000-4000-8000-000000000002'
const SQUAD = '00000000-0000-4000-8000-000000000011'
const GARAGE = '00000000-0000-4000-8000-000000000012'
const PLAN = '00000000-0000-4000-8000-000000000021'
const DAY = '00000000-0000-4000-8000-000000000022'
const SESSION = '00000000-0000-4000-8000-000000000031'
const EARLIER = '00000000-0000-4000-8000-000000000032'
const EARLIEST = '00000000-0000-4000-8000-000000000033'
const SQUAT = '00000000-0000-4000-8000-000000000041'
const PLANK = '00000000-0000-4000-8000-000000000042'
const SET = '00000000-0000-4000-8000-000000000051'
const SECOND_SET = '00000000-0000-4000-8000-000000000052'
const THIRD_SET = '00000000-0000-4000-8000-000000000053'
const FOURTH_SET = '00000000-0000-4000-8000-000000000054'

describe('who shares their training', () => {
  const sam = Athlete.parse({
    user: {
      id: SAM,
      username: 'sam',
      displayName: 'Sam Lee',
      createdAt: '2026-09-01T08:00:00.000Z',
    },
    groups: [{ id: SQUAD, name: 'Squad' }],
  })

  test('nobody yet is said, not an empty answer', () => {
    expect(athleteLines([])).toBe('Nobody shares their training with a group you edit.')
  })

  test('an athlete a line: their name, the group they share through, and their id', () => {
    const alex = Athlete.parse({
      user: {
        id: ALEX,
        username: 'alex',
        displayName: 'Alex Kim',
        createdAt: '2026-09-02T08:00:00.000Z',
      },
      groups: [{ id: GARAGE, name: 'Garage' }],
    })
    expect(athleteLines([sam, alex])).toBe(
      [`Sam Lee (@sam) · via Squad · ${SAM}`, `Alex Kim (@alex) · via Garage · ${ALEX}`].join('\n'),
    )
  })

  test('sharing through two groups, both are named', () => {
    const through = [...sam.groups, { id: GARAGE, name: 'Garage' }]
    expect(athleteLines([{ ...sam, groups: through }])).toBe(
      `Sam Lee (@sam) · via Squad, Garage · ${SAM}`,
    )
  })
})

/** A finished session without a plan: two sets, 5 × 80 kg and 8 × 30 kg — 640 kg lifted. */
const summary = (fields: Partial<WorkoutSessionSummary> = {}): WorkoutSessionSummary =>
  WorkoutSessionSummary.parse({
    id: SESSION,
    workoutId: null,
    dayId: null,
    startedAt: '2026-10-20T17:00:00.000Z',
    endedAt: '2026-10-20T18:05:00.000Z',
    notes: null,
    workoutName: null,
    dayName: null,
    setCount: 2,
    liftedG: 640_000,
    personalBests: 0,
    ...fields,
  })

const sessions = (items: WorkoutSessionSummary[], nextCursor: string | null = null) =>
  page(WorkoutSessionSummary).parse({ items, nextCursor })

describe('a run of sessions', () => {
  test('none is said, not an empty answer', () => {
    expect(sessionLines(sessions([]), 'kg')).toBe('No sessions.')
  })

  test('a session a line: its day, its plan, what was done, how it went, and its id', () => {
    const run = sessions([
      summary({
        workoutId: PLAN,
        dayId: DAY,
        workoutName: 'PPL',
        dayName: 'Push',
        endedAt: null,
        notes: 'felt heavy',
        setCount: 18,
        liftedG: 850_000,
        personalBests: 1,
      }),
      summary({
        id: EARLIER,
        startedAt: '2026-10-18T17:00:00.000Z',
        endedAt: '2026-10-18T18:00:00.000Z',
        personalBests: 2,
      }),
      summary({
        id: EARLIEST,
        workoutId: PLAN,
        dayId: DAY,
        workoutName: 'PPL',
        dayName: 'Push',
        startedAt: '2026-10-16T17:00:00.000Z',
        endedAt: '2026-10-16T18:00:00.000Z',
        setCount: 12,
        liftedG: 720_500,
      }),
    ])
    expect(sessionLines(run, 'kg')).toBe(
      [
        `2026-10-20 · PPL / Push · 18 sets · 850 kg · 1 personal best · in progress · "felt heavy" · ${SESSION}`,
        `2026-10-18 · no plan · 2 sets · 640 kg · 2 personal bests · ${EARLIER}`,
        `2026-10-16 · PPL / Push · 12 sets · 720.5 kg · ${EARLIEST}`,
      ].join('\n'),
    )
  })

  test('a session without a plan, its notes in quotes', () => {
    expect(sessionLines(sessions([summary({ notes: 'felt heavy' })]), 'kg')).toBe(
      `2026-10-20 · no plan · 2 sets · 640 kg · "felt heavy" · ${SESSION}`,
    )
  })

  /** ADR-0019: the session is the athlete's for good; its plan's name is not the reader's. */
  test('a plan the reader cannot see is unavailable, and its day with it', () => {
    const unseen = summary({ workoutId: PLAN, dayId: DAY, workoutName: null, dayName: null })
    expect(sessionLines(sessions([unseen]), 'kg')).toBe(
      `2026-10-20 · unavailable plan / unavailable day · 2 sets · 640 kg · ${SESSION}`,
    )
  })

  test('a plan still seen whose day is not keeps its name', () => {
    const dayGone = summary({ workoutId: PLAN, dayId: null, workoutName: 'PPL', dayName: null })
    expect(sessionLines(sessions([dayGone]), 'kg')).toBe(
      `2026-10-20 · PPL / unavailable day · 2 sets · 640 kg · ${SESSION}`,
    )
  })

  test('notes left empty are no notes', () => {
    expect(sessionLines(sessions([summary({ notes: '' })]), 'kg')).toBe(
      `2026-10-20 · no plan · 2 sets · 640 kg · ${SESSION}`,
    )
  })

  test('notes of two lines stay on the session’s one', () => {
    const twoLines = summary({ notes: 'felt heavy\nleft knee sore' })
    expect(sessionLines(sessions([twoLines]), 'kg')).toBe(
      `2026-10-20 · no plan · 2 sets · 640 kg · "felt heavy\\nleft knee sore" · ${SESSION}`,
    )
  })

  test('the weight lifted reads in the reader’s unit', () => {
    expect(sessionLines(sessions([summary({ liftedG: 100_000 })]), 'lb')).toBe(
      `2026-10-20 · no plan · 2 sets · 220.46 lb · ${SESSION}`,
    )
  })

  test('more than the page holds: the cursor to pass for the rest', () => {
    const first = sessions([summary(), summary({ id: EARLIER, notes: 'felt heavy' })], 'next-page')
    expect(sessionLines(first, 'kg')).toBe(
      [
        `2026-10-20 · no plan · 2 sets · 640 kg · ${SESSION}`,
        `2026-10-20 · no plan · 2 sets · 640 kg · "felt heavy" · ${EARLIER}`,
        'More: pass cursor next-page',
      ].join('\n'),
    )
  })
})

/** A working set of the squat: 5 × 80 kg, no reps in reserve said. */
const setLog = (fields: Partial<SetLog> = {}): SetLog =>
  SetLog.parse({
    id: SET,
    entryId: null,
    exerciseId: SQUAT,
    exercise: { name: 'Squat', tracking: 'weight_reps' },
    setIndex: 0,
    weightG: 80_000,
    reps: 5,
    reserve: null,
    durationS: null,
    distanceMm: null,
    isWarmup: false,
    loggedAt: '2026-10-20T17:10:00.000Z',
    personalBest: false,
    idempotencyKey: null,
    ...fields,
  })

/** #31: how a corrected set is answered — by its exercise, with the id that names it. */
describe('one set log', () => {
  test('a working set: its exercise, its effort, and its id', () => {
    expect(setLine(setLog(), 'kg')).toBe(`Squat: 5 × 80 kg [${SET}]`)
  })

  test('with reps in reserve, they follow the effort', () => {
    expect(setLine(setLog({ reserve: 1 }), 'kg')).toBe(`Squat: 5 × 80 kg · 1 in reserve [${SET}]`)
  })

  test('a warm-up set is marked w', () => {
    expect(setLine(setLog({ isWarmup: true, weightG: 40_000 }), 'kg')).toBe(
      `Squat: w5 × 40 kg [${SET}]`,
    )
  })

  test('a warm-up set with reps in reserve says both', () => {
    expect(setLine(setLog({ isWarmup: true, weightG: 40_000, reserve: 2 }), 'kg')).toBe(
      `Squat: w5 × 40 kg · 2 in reserve [${SET}]`,
    )
  })

  test('the effort is said as its exercise is tracked: weight added to bodyweight', () => {
    const pullUp = setLog({
      exercise: { name: 'Pull-Up', tracking: 'bodyweight_reps' },
      reps: 6,
      weightG: 20_000,
    })
    expect(setLine(pullUp, 'kg')).toBe(`Pull-Up: 6 × bodyweight +20 kg [${SET}]`)
  })

  test('the weight reads in the reader’s unit', () => {
    expect(setLine(setLog({ reps: 8, weightG: 61_235 }), 'lb')).toBe(`Squat: 8 × 135 lb [${SET}]`)
  })
})

describe('one session, set by set', () => {
  const detail = (fields: Partial<SessionDetail> = {}): SessionDetail =>
    SessionDetail.parse({
      id: SESSION,
      workoutId: null,
      dayId: null,
      startedAt: '2026-10-20T17:00:00.000Z',
      endedAt: '2026-10-20T18:05:00.000Z',
      notes: null,
      logs: [],
      rest: null,
      plan: null,
      ...fields,
    })

  /** Squat, squat, plank, squat: the squat comes back after the plank, as a run of its own. */
  const logs = [
    setLog({ isWarmup: true, weightG: 40_000 }),
    setLog({ id: SECOND_SET, setIndex: 1, reserve: 2 }),
    setLog({
      id: THIRD_SET,
      exerciseId: PLANK,
      exercise: { name: 'Plank', tracking: 'duration' },
      weightG: null,
      reps: null,
      durationS: 60,
    }),
    setLog({ id: FOURTH_SET, setIndex: 2 }),
  ]

  test('a line per run of one exercise, in the order done', () => {
    expect(sessionDetail(detail({ logs }), 'kg')).toBe(
      [
        '2026-10-20',
        'Squat: w5 × 40 kg, 5 × 80 kg · 2 in reserve',
        'Plank: 1:00',
        'Squat: 5 × 80 kg',
      ].join('\n'),
    )
  })

  /** #31: the reader's own session, whose sets `session_fix_set` takes by these ids. */
  test('with ids, each set is followed by its own', () => {
    expect(sessionDetail(detail({ logs }), 'kg', true)).toBe(
      [
        '2026-10-20',
        `Squat: w5 × 40 kg [${SET}], 5 × 80 kg · 2 in reserve [${SECOND_SET}]`,
        `Plank: 1:00 [${THIRD_SET}]`,
        `Squat: 5 × 80 kg [${FOURTH_SET}]`,
      ].join('\n'),
    )
  })

  test('a session in progress with notes says both beside its day', () => {
    const open = detail({ endedAt: null, notes: 'felt heavy', logs: [setLog()] })
    expect(sessionDetail(open, 'kg')).toBe(
      ['2026-10-20 · in progress · "felt heavy"', 'Squat: 5 × 80 kg'].join('\n'),
    )
  })

  test('a finished session’s notes follow its day', () => {
    const finished = detail({ notes: 'felt heavy', logs: [setLog()] })
    expect(sessionDetail(finished, 'kg')).toBe(
      ['2026-10-20 · "felt heavy"', 'Squat: 5 × 80 kg'].join('\n'),
    )
  })

  test('notes left empty are no notes', () => {
    expect(sessionDetail(detail({ notes: '', logs: [setLog()] }), 'kg')).toBe(
      ['2026-10-20', 'Squat: 5 × 80 kg'].join('\n'),
    )
  })

  test('a session just started has no sets, and says so', () => {
    expect(sessionDetail(detail({ endedAt: null }), 'kg')).toBe(
      ['2026-10-20 · in progress', 'No sets.'].join('\n'),
    )
  })

  test('the weights read in the reader’s unit', () => {
    const pounds = detail({ logs: [setLog({ reps: 8, weightG: 61_235 })] })
    expect(sessionDetail(pounds, 'lb')).toBe(['2026-10-20', 'Squat: 8 × 135 lb'].join('\n'))
  })
})

/**
 * A count of one is said in the singular, and an exercise the reader cannot see by the one name it
 * has everywhere (GLOSSARY.md, "Unavailable exercise") — its efforts still said (ADR-0019): the
 * sets are the athlete's, the name is not theirs to read.
 */
describe('a session of one set, and an exercise out of reach', () => {
  test('one set is one set', () => {
    const one = sessions([summary({ setCount: 1, liftedG: 400_000 })])
    expect(sessionLines(one, 'kg')).toBe(`2026-10-20 · no plan · 1 set · 400 kg · ${SESSION}`)
  })

  test('a set of an exercise out of reach keeps what it said, under that name', () => {
    expect(setLine(setLog({ exercise: null }), 'kg')).toBe(
      `Unavailable exercise: 5 × 80 kg [${SET}]`,
    )
  })

  test('in a session, its run reads the same beside the ones in reach', () => {
    const session = SessionDetail.parse({
      id: SESSION,
      workoutId: null,
      dayId: null,
      startedAt: '2026-10-20T17:00:00.000Z',
      endedAt: '2026-10-20T18:05:00.000Z',
      notes: null,
      logs: [
        setLog(),
        setLog({ id: SECOND_SET, exerciseId: PLANK, exercise: null, reps: 8, weightG: 30_000 }),
      ],
      rest: null,
      plan: null,
    })
    expect(sessionDetail(session, 'kg')).toBe(
      ['2026-10-20', 'Squat: 5 × 80 kg', 'Unavailable exercise: 8 × 30 kg'].join('\n'),
    )
  })
})

/** What `session_log` answers: the session it made, by the id every session tool takes. */
describe('a session logged whole', () => {
  const logged = (sets: number) =>
    SessionDetail.parse({
      id: SESSION,
      workoutId: null,
      dayId: null,
      startedAt: '2026-10-20T17:00:00.000Z',
      endedAt: '2026-10-20T17:00:00.000Z',
      notes: null,
      logs: Array.from({ length: sets }, (_, at) =>
        setLog({ id: `00000000-0000-4000-8000-00000000006${String(at)}`, setIndex: at }),
      ),
      rest: null,
      plan: null,
    })

  test('says its id and how many sets it holds', () => {
    expect(sessionLogged(logged(3))).toBe(`Logged session ${SESSION} with 3 sets.`)
  })

  test('one set is one set', () => {
    expect(sessionLogged(logged(1))).toBe(`Logged session ${SESSION} with 1 set.`)
  })
})
