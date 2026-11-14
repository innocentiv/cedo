import { describe, expect, test } from 'bun:test'
import { ExerciseHistory, type MuscleWork, SignUp, TrainingReview } from '@cedo/contract'
import { historyLines, reviewSummary, signUpLine } from './format.ts'

/**
 * What `training_review`, `exercise_history` and `instance_sign_up_set` say, as the model reads it:
 * a contract value in, the whole text out, with no wire and no database (docs/07-mcp.md, "Adding a
 * tool"). That the tools reach these formatters, with what the services answer, is `mcp.test.ts`'s,
 * through the wire.
 */

const lift = (reps: number, weightG: number) => ({
  reps,
  weightG,
  durationS: null,
  distanceMm: null,
})

const hold = (durationS: number) => ({ reps: null, weightG: null, durationS, distanceMm: null })

const BENCH = { name: 'Bench Press', tracking: 'weight_reps' } as const
const SQUAT = { name: 'Back Squat', tracking: 'weight_reps' } as const
const ROW = { name: 'Barbell Row', tracking: 'weight_reps' } as const
const RAISE = { name: 'Lateral Raise', tracking: 'weight_reps' } as const
const PULL_UP = { name: 'Weighted Pull-up', tracking: 'bodyweight_reps' } as const
const PLANK = { name: 'Plank', tracking: 'duration' } as const

/** A muscle's work: its working sets, the grams lifted, and its change on the period before. */
const worked = (
  muscle: string,
  weightedSets: number,
  liftedG: number,
  changePct: number | null,
): MuscleWork => ({ muscle, weightedSets, liftedG, changePct, declined: false })

/**
 * Three sessions in four weeks, none of them of a plan's day, with nothing to flag and nothing
 * known of the person: what each test below changes one part of.
 */
const review = (over: Partial<TrainingReview> = {}): TrainingReview =>
  TrainingReview.parse({
    weeks: 4,
    adherence: {
      sessions: 3,
      perWeek: 0.8,
      currentStreakDays: 2,
      longestGapDays: 9,
      lastSessionAt: '2026-10-30T17:05:00.000Z',
    },
    dayBalance: [],
    muscleWork: {
      top: [worked('quadriceps', 3, 1_537_500, null), worked('rectus_abdominis', 3, 0, null)],
      declined: [],
      omitted: 0,
    },
    stalled: [],
    falling: [],
    effortDrift: [],
    bodyweight: null,
    age: null,
    ...over,
  })

/** The text's blocks, as its blank lines set them apart: the summary, the days, the muscles, … */
const blocks = (text: string): string[] => text.split('\n\n')

const FALLING = 'Falling (estimated max from what was lifted, down 2+ sessions running):'
const DRIFT =
  'Effort drift (reps in reserve down 1+ at the same set, in each of the latest 2 sessions):'

describe('the training review', () => {
  test('a plan followed: the days trained, each muscle’s work, and every signal under its own heading', () => {
    const followed = review({
      adherence: {
        sessions: 6,
        perWeek: 1.5,
        currentStreakDays: 2,
        longestGapDays: 9,
        lastSessionAt: '2026-10-30T17:05:00.000Z',
      },
      dayBalance: [
        { workout: 'Push Pull', day: 'Push', sessions: 4 },
        { workout: 'Push Pull', day: 'Pull', sessions: 2 },
      ],
      muscleWork: {
        top: [
          worked('quadriceps', 12, 1_537_500, 20),
          worked('pectoralis_major', 7.5, 900_000, -35),
          worked('latissimus_dorsi', 6, 360_000, 0),
          worked('rectus_abdominis', 3, 0, null),
        ],
        declined: [
          { ...worked('hamstrings', 0, 0, -100), declined: true },
          { ...worked('gastrocnemius', 2.4, 0, -60), declined: true },
        ],
        omitted: 2,
      },
      stalled: [
        { exercise: BENCH, sessions: 3, effort: { ...lift(5, 60_000), reserve: 2 } },
        { exercise: PULL_UP, sessions: 3, effort: { ...lift(6, 20_000), reserve: null } },
        { exercise: PLANK, sessions: 4, effort: { ...hold(60), reserve: null } },
      ],
      falling: [{ exercise: SQUAT, sessions: 3, fromG: 77_000, toG: 66_500 }],
      effortDrift: [{ exercise: ROW, effort: lift(8, 50_000), fromReserve: 3, toReserve: 1 }],
      bodyweight: {
        latest: { day: '2026-10-30', weightG: 82_400 },
        from: { day: '2026-09-01', weightG: 84_000 },
      },
      age: 36,
    })

    expect(reviewSummary(followed, 'kg')).toBe(
      [
        'Last 4 weeks: 6 sessions (1.5/week).',
        'Bodyweight 82.4 kg on Fri 30 Oct, −1.6 kg since Tue 1 Sep. Age 36 this year.',
        'Last session 2026-10-30T17:05:00.000Z. Current streak 2 days, longest gap 9 days.',
        '',
        'Planned days trained:',
        '  Push Pull / Push: 4x',
        '  Push Pull / Pull: 2x',
        '',
        'Working sets by muscle, by its share of each exercise (vs the preceding 4 weeks):',
        '  quadriceps: 12 sets, 1537.5 kg lifted (+20%)',
        '  pectoralis_major: 7.5 sets, 900 kg lifted (-35%)',
        '  latissimus_dorsi: 6 sets, 360 kg lifted (0%)',
        '  rectus_abdominis: 3 sets (no prior data)',
        '  and 2 more muscles with less work.',
        '',
        'Declined sharply (half or less of their sets in the preceding 4 weeks):',
        '  hamstrings: 0 sets (-100%)',
        '  gastrocnemius: 2.4 sets (-60%)',
        '',
        'Stalled (the same top set, 3+ sessions running):',
        // 5 reps with 2 in reserve, as if 7: 60 kg × (1 + 7/30).
        '  Bench Press: 3 sessions at 5 × 60 kg (estimated max 74 kg)',
        '  Weighted Pull-up: 3 sessions at 6 × bodyweight +20 kg',
        '  Plank: 4 sessions at 1:00',
        '',
        FALLING,
        '  Back Squat: down in each of the latest 3 sessions, 77 kg → 66.5 kg',
        '',
        DRIFT,
        '  Barbell Row at 8 × 50 kg: 3 → 1 in reserve',
      ].join('\n'),
    )
  })

  test('sessions of no plan and nothing to flag: said in a line each, with no heading left empty', () => {
    expect(reviewSummary(review(), 'kg')).toBe(
      [
        'Last 4 weeks: 3 sessions (0.8/week).',
        'No weigh-ins yet. Age not given.',
        'Last session 2026-10-30T17:05:00.000Z. Current streak 2 days, longest gap 9 days.',
        '',
        'No sessions were tied to a planned day (all ad hoc).',
        '',
        'Working sets by muscle, by its share of each exercise (vs the preceding 4 weeks):',
        '  quadriceps: 3 sets, 1537.5 kg lifted (no prior data)',
        // A plank lifts nothing, and is still three sets of work.
        '  rectus_abdominis: 3 sets (no prior data)',
        '',
        'Nothing looks stalled.',
      ].join('\n'),
    )
  })

  test('sessions that worked no muscle say so, under no heading', () => {
    const idle = review({ muscleWork: { top: [], declined: [], omitted: 0 } })
    expect(blocks(reviewSummary(idle, 'kg')).slice(2)).toEqual([
      'No working sets recorded.',
      'Nothing looks stalled.',
    ])
  })

  test('one muscle left out is counted as one', () => {
    const cut = review({ muscleWork: { ...review().muscleWork, omitted: 1 } })
    expect(blocks(reviewSummary(cut, 'kg'))[2]?.split('\n').at(-1)).toBe(
      '  and 1 more muscle with less work.',
    )
  })

  /** Its reps and weight alone when no reserve was said, and nothing where there is no estimate. */
  test('a stalled lift says its estimated max, unless it has none', () => {
    const stalled = review({
      stalled: [
        { exercise: ROW, sessions: 4, effort: { ...lift(8, 60_000), reserve: null } },
        // Past a dozen reps a set estimates nothing.
        { exercise: RAISE, sessions: 5, effort: { ...lift(15, 10_000), reserve: null } },
      ],
    })
    expect(blocks(reviewSummary(stalled, 'kg')).slice(3)).toEqual([
      [
        'Stalled (the same top set, 3+ sessions running):',
        // 60 kg × (1 + 8/30).
        '  Barbell Row: 4 sessions at 8 × 60 kg (estimated max 76 kg)',
        '  Lateral Raise: 5 sessions at 15 × 10 kg',
      ].join('\n'),
    ])
  })

  test('lifts falling are listed alone, with nothing said of effort drift', () => {
    const falling = review({
      falling: [
        { exercise: SQUAT, sessions: 3, fromG: 77_000, toG: 66_500 },
        { exercise: BENCH, sessions: 2, fromG: 70_000, toG: 68_500 },
      ],
    })
    expect(blocks(reviewSummary(falling, 'kg')).slice(3)).toEqual([
      'Nothing looks stalled.',
      [
        FALLING,
        '  Back Squat: down in each of the latest 3 sessions, 77 kg → 66.5 kg',
        '  Bench Press: down in each of the latest 2 sessions, 70 kg → 68.5 kg',
      ].join('\n'),
    ])
  })

  /** Averages, so the reps in reserve it drifted to may be a fraction. */
  test('effort drift is listed alone, with nothing said of falling', () => {
    const drifting = review({
      effortDrift: [
        { exercise: ROW, effort: lift(8, 50_000), fromReserve: 3, toReserve: 1 },
        { exercise: BENCH, effort: lift(5, 80_000), fromReserve: 3, toReserve: 1.3 },
      ],
    })
    expect(blocks(reviewSummary(drifting, 'kg')).slice(3)).toEqual([
      'Nothing looks stalled.',
      [
        DRIFT,
        '  Barbell Row at 8 × 50 kg: 3 → 1 in reserve',
        '  Bench Press at 5 × 80 kg: 3 → 1.3 in reserve',
      ].join('\n'),
    ])
  })

  test('someone who reads pounds is written to in pounds, every weight of it', () => {
    const inPounds = review({
      muscleWork: { top: [worked('quadriceps', 3, 100_000, null)], declined: [], omitted: 0 },
      stalled: [{ exercise: SQUAT, sessions: 3, effort: { ...lift(5, 100_000), reserve: null } }],
      falling: [{ exercise: BENCH, sessions: 2, fromG: 100_000, toG: 61_235 }],
      effortDrift: [{ exercise: ROW, effort: lift(8, 61_235), fromReserve: 3, toReserve: 1 }],
      bodyweight: { latest: { day: '2026-10-30', weightG: 100_000 }, from: null },
    })
    expect(reviewSummary(inPounds, 'lb')).toBe(
      [
        'Last 4 weeks: 3 sessions (0.8/week).',
        'Bodyweight 220.46 lb on Fri 30 Oct. Age not given.',
        'Last session 2026-10-30T17:05:00.000Z. Current streak 2 days, longest gap 9 days.',
        '',
        'No sessions were tied to a planned day (all ad hoc).',
        '',
        'Working sets by muscle, by its share of each exercise (vs the preceding 4 weeks):',
        '  quadriceps: 3 sets, 220.46 lb lifted (no prior data)',
        '',
        'Stalled (the same top set, 3+ sessions running):',
        // 100 kg × (1 + 5/30) is 116.67 kg, said to the half kilogram: 116.5 kg, in pounds.
        '  Back Squat: 3 sessions at 5 × 220.46 lb (estimated max 256.84 lb)',
        '',
        FALLING,
        '  Bench Press: down in each of the latest 2 sessions, 220.46 lb → 135 lb',
        '',
        DRIFT,
        '  Barbell Row at 8 × 135 lb: 3 → 1 in reserve',
      ].join('\n'),
    )
  })
})

describe('an exercise’s history', () => {
  const EXERCISE_ID = '00000000-0000-4000-8000-000000000010'
  /** Newest first, a week apart. */
  const SESSIONS = [
    { sessionId: '00000000-0000-4000-8000-000000000011', performedAt: '2026-10-21T17:30:00.000Z' },
    { sessionId: '00000000-0000-4000-8000-000000000012', performedAt: '2026-10-14T17:30:00.000Z' },
    { sessionId: '00000000-0000-4000-8000-000000000013', performedAt: '2026-10-07T17:30:00.000Z' },
  ] as const

  interface LoggedSet {
    readonly reps: number | null
    readonly weightG: number | null
    readonly durationS: number | null
    readonly distanceMm: number | null
    readonly reserve?: number
    readonly isWarmup?: boolean
  }

  /** Up to three sessions, newest first, each the sets it logged in order. */
  const history = (
    tracking: ExerciseHistory['tracking'],
    sessions: readonly (readonly LoggedSet[])[],
    stalled: ExerciseHistory['stalled'] = null,
  ): ExerciseHistory =>
    ExerciseHistory.parse({
      exerciseId: EXERCISE_ID,
      tracking,
      sessions: sessions.map((sets, s) => ({
        ...SESSIONS[s],
        sets: sets.map((set, setIndex) => ({
          reserve: null,
          isWarmup: false,
          ...set,
          setIndex,
        })),
      })),
      stalled,
    })

  test('a line a session, newest first: each set, its reps in reserve, and the session’s best estimated max', () => {
    const lines = historyLines(
      history('weight_reps', [
        [
          { ...lift(10, 20_000), isWarmup: true },
          { ...lift(5, 60_000), reserve: 1 },
          { ...lift(5, 60_000), reserve: 2 },
          lift(5, 60_000),
        ],
        [lift(5, 57_500)],
      ]),
      'kg',
    )
    expect(lines).toBe(
      [
        // The best of the session: 5 reps with 2 in reserve, as if 7 — 60 kg × (1 + 7/30).
        '2026-10-21: w10 × 20 kg, 5 × 60 kg · 1 in reserve, 5 × 60 kg · 2 in reserve, 5 × 60 kg · estimated max 74 kg',
        // 57.5 kg × (1 + 5/30) is 67.08 kg, said to the half kilogram.
        '2026-10-14: 5 × 57.5 kg · estimated max 67 kg',
      ].join('\n'),
    )
  })

  test('a stalled exercise says so last, with the top set its sessions share', () => {
    const same = [{ ...lift(5, 60_000), reserve: 2 }]
    const lines = historyLines(
      history('weight_reps', [same, same, same], { sessions: 3, effort: lift(5, 60_000) }),
      'kg',
    )
    expect(lines).toBe(
      [
        '2026-10-21: 5 × 60 kg · 2 in reserve · estimated max 74 kg',
        '2026-10-14: 5 × 60 kg · 2 in reserve · estimated max 74 kg',
        '2026-10-07: 5 × 60 kg · 2 in reserve · estimated max 74 kg',
        'Stalled: 3 sessions at 5 × 60 kg',
      ].join('\n'),
    )
  })

  /** A warm-up counts toward nothing, and past a dozen reps a set estimates nothing. */
  test('a session with nothing to estimate from is its sets alone', () => {
    const lines = historyLines(
      history('weight_reps', [[{ ...lift(10, 20_000), isWarmup: true }], [lift(15, 10_000)]]),
      'kg',
    )
    expect(lines).toBe(['2026-10-21: w10 × 20 kg', '2026-10-14: 15 × 10 kg'].join('\n'))
  })

  test('a bodyweight movement reads in its own terms, with no estimated max', () => {
    const lines = historyLines(
      history('bodyweight_reps', [
        [{ ...lift(6, 20_000), reserve: 1 }],
        [{ reps: 10, weightG: null, durationS: null, distanceMm: null }],
      ]),
      'kg',
    )
    expect(lines).toBe(
      ['2026-10-21: 6 × bodyweight +20 kg · 1 in reserve', '2026-10-14: 10 × bodyweight'].join(
        '\n',
      ),
    )
  })

  test('a hold is its time, set by set', () => {
    expect(historyLines(history('duration', [[hold(60), hold(45)]]), 'kg')).toBe(
      '2026-10-21: 1:00, 0:45',
    )
  })

  test('someone who reads pounds is written to in pounds, the estimated max too', () => {
    // 100 kg × (1 + 5/30) is 116.67 kg, said to the half kilogram: 116.5 kg, in pounds.
    expect(historyLines(history('weight_reps', [[lift(5, 100_000)]]), 'lb')).toBe(
      '2026-10-21: 5 × 220.46 lb · estimated max 256.84 lb',
    )
  })

  test('none logged yet is said, not an empty answer', () => {
    expect(historyLines(history('weight_reps', []), 'kg')).toBe(
      'No sessions logged for this exercise.',
    )
  })
})

describe('sign-up, as the curator left it', () => {
  test('open says who can now create an account', () => {
    expect(signUpLine(SignUp.parse('open'))).toBe(
      'Sign-up is open: anyone who reaches this instance can create an account.',
    )
  })

  test('closed says nobody new can', () => {
    expect(signUpLine(SignUp.parse('closed'))).toBe(
      'Sign-up is closed: nobody new can create an account.',
    )
  })
})

/** A count is said as a person says it (`counted`): one of anything in the singular. */
describe('a count of one, and a window with nothing in it', () => {
  test('one week, one session, one day and one set are each said in the singular', () => {
    const one = review({
      weeks: 1,
      adherence: {
        sessions: 1,
        perWeek: 1,
        currentStreakDays: 1,
        longestGapDays: 1,
        lastSessionAt: '2026-10-30T17:05:00.000Z',
      },
      muscleWork: {
        top: [worked('quadriceps', 1, 100_000, null)],
        declined: [{ ...worked('hamstrings', 1, 0, -50), declined: true }],
        omitted: 1,
      },
    })
    expect(reviewSummary(one, 'kg')).toBe(
      [
        'Last 1 week: 1 session (1/week).',
        'No weigh-ins yet. Age not given.',
        'Last session 2026-10-30T17:05:00.000Z. Current streak 1 day, longest gap 1 day.',
        '',
        'No sessions were tied to a planned day (all ad hoc).',
        '',
        'Working sets by muscle, by its share of each exercise (vs the preceding 1 week):',
        '  quadriceps: 1 set, 100 kg lifted (no prior data)',
        '  and 1 more muscle with less work.',
        '',
        'Declined sharply (half or less of their sets in the preceding 1 week):',
        '  hamstrings: 1 set (-50%)',
        '',
        'Nothing looks stalled.',
      ].join('\n'),
    )
  })

  const nothingLogged = {
    sessions: 0,
    perWeek: 0,
    currentStreakDays: 0,
    longestGapDays: 0,
    lastSessionAt: null,
  }

  /** With nothing logged, nothing is judged: an all-clear for nothing is not given — as in the app. */
  test('with no session in the window, nothing is said of stalls', () => {
    const none = review({
      adherence: nothingLogged,
      muscleWork: { top: [], declined: [], omitted: 0 },
    })
    expect(reviewSummary(none, 'kg')).toBe(
      [
        'Last 4 weeks: 0 sessions (0/week).',
        'No weigh-ins yet. Age not given.',
        'No sessions logged in this window.',
        '',
        'No sessions were tied to a planned day (all ad hoc).',
        '',
        'No working sets recorded.',
      ].join('\n'),
    )
  })

  /** A stall is judged on an exercise's latest sessions, whenever they were: it is still said. */
  test('an exercise stalled before the window is still named, with no session in it', () => {
    const stalledBefore = review({
      adherence: nothingLogged,
      muscleWork: { top: [], declined: [], omitted: 0 },
      stalled: [{ exercise: PLANK, sessions: 4, effort: { ...hold(60), reserve: null } }],
    })
    expect(blocks(reviewSummary(stalledBefore, 'kg')).at(-1)).toBe(
      ['Stalled (the same top set, 3+ sessions running):', '  Plank: 4 sessions at 1:00'].join(
        '\n',
      ),
    )
  })
})

/** docs/07-mcp.md shows the two deload sections as an example: this is that example, kept true. */
describe('the example the MCP guide shows', () => {
  test('a lift falling and one drifting, as docs/07-mcp.md prints them', () => {
    const both = review({
      falling: [{ exercise: BENCH, sessions: 3, fromG: 77_000, toG: 66_500 }],
      effortDrift: [
        {
          exercise: { name: 'Row', tracking: 'weight_reps' },
          effort: lift(8, 50_000),
          fromReserve: 3,
          toReserve: 1.5,
        },
      ],
    })
    expect(blocks(reviewSummary(both, 'kg')).slice(-2).join('\n\n')).toBe(
      [
        'Falling (estimated max from what was lifted, down 2+ sessions running):',
        '  Bench Press: down in each of the latest 3 sessions, 77 kg → 66.5 kg',
        '',
        'Effort drift (reps in reserve down 1+ at the same set, in each of the latest 2 sessions):',
        '  Row at 8 × 50 kg: 3 → 1.5 in reserve',
      ].join('\n'),
    )
  })
})
