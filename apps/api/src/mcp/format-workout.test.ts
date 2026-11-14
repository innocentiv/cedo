import { describe, expect, test } from 'bun:test'
import {
  AthleteEquipment,
  DEFAULT_GROUP_SLUG,
  EntryTarget,
  type EquipmentSlug,
  Exercise,
  GroupMembership,
  type ItemWeights,
  NO_TARGET,
  type Progression,
  type SetTarget,
  type TrackingMode,
  type WeightUnit,
  Workout,
  WorkoutSummary,
  lbToG,
} from '@cedo/contract'
import { groupNames } from './format-group.ts'
import {
  nextTargetLine,
  nextTargetLines,
  workoutCopied,
  workoutCreated,
  workoutDetail,
  workoutLines,
  workoutUpdated,
} from './format-workout.ts'

/**
 * A workout as the model reads it — its line in a list, its plan as an outline, each entry's next
 * target: a contract value in, the whole text out, with no wire and no database (docs/07-mcp.md,
 * "A plan teaches its own model"). That the tools reach these, and hand them the caller's unit,
 * equipment and targets, is `mcp.test.ts`'s and `progression.test.ts`'s, through the wire.
 */

const AT = '2026-01-05T08:00:00Z'

/** An id nobody could take for a real one: `00000000-0000-4000-8000-000000000021`. */
const fakeId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const MINE = fakeId(1)
const LIBRARY = fakeId(2)
const SQUAD = fakeId(3)
const WORKOUT = fakeId(10)

/** The entries whose ids a line says. */
const BENCH = fakeId(21)
const PRESS = fakeId(22)
const PUSHDOWN = fakeId(23)
const PLANK = fakeId(24)
const PULL_UP = fakeId(25)
const ROWING = fakeId(26)

const membership = (id: string, kind: 'personal' | 'shared', slug: string, name: string) =>
  GroupMembership.parse({
    id,
    slug,
    name,
    kind,
    createdAt: AT,
    role: 'reader',
    memberCount: 2,
    canManage: false,
    canLeave: false,
    canTransferInto: false,
    sharesTraining: false,
    canShareTraining: false,
  })

/** The reader's groups: their own, the starter library, and one they were added to. */
const groupNameOf = groupNames([
  membership(MINE, 'personal', 'alice', 'alice'),
  membership(LIBRARY, 'shared', DEFAULT_GROUP_SLUG, 'Library'),
  membership(SQUAD, 'shared', 'squad', 'Squad'),
])

/** What every ownable carries: the reader's own, which they edit, unless a fixture says otherwise. */
const owned = {
  ownerGroupId: MINE,
  createdBy: fakeId(4),
  canEdit: true,
  isFavourite: false,
  createdAt: AT,
  updatedAt: AT,
}

const MANUAL: Progression = { kind: 'none' }
const LINEAR: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }
const DOUBLE: Progression = { kind: 'double', repRange: [8, 12], incrementG: 2500 }

const exercise = (
  name: string,
  fields: { tracking?: TrackingMode; equipment?: EquipmentSlug[] | null; doable?: boolean } = {},
): Exercise =>
  Exercise.parse({
    id: crypto.randomUUID(),
    name,
    tracking: 'weight_reps',
    description: '',
    instructions: '',
    equipment: null,
    isUnilateral: false,
    muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
    mediaIds: [],
    media: [],
    doable: true,
    ...owned,
    ...fields,
  })

const benchPress = exercise('Bench Press', { equipment: ['barbell', 'flat_bench'] })
const overheadPress = exercise('Overhead Press')
const pushdown = exercise('Triceps Pushdown')
const plank = exercise('Plank', { tracking: 'duration' })
const pullUp = exercise('Pull-up', { tracking: 'bodyweight_reps' })
const rowing = exercise('Rowing', { tracking: 'distance_duration' })
const dumbbellPress = exercise('Dumbbell Press', { equipment: ['dumbbells'] })

/** What a set asks: only what is given, every other dimension none. */
const asked = (fields: Partial<SetTarget>): SetTarget => ({ ...NO_TARGET, ...fields })

interface PlannedSet {
  readonly isWarmup: boolean
  readonly target: SetTarget
}
const work = (fields: Partial<SetTarget>): PlannedSet => ({
  isWarmup: false,
  target: asked(fields),
})
const warmUp = (fields: Partial<SetTarget>): PlannedSet => ({
  isWarmup: true,
  target: asked(fields),
})

interface PlannedEntry {
  readonly id: string
  readonly exercise: Exercise
  readonly supersetGroup: string | null
  readonly restSeconds: number | null
  readonly cue: string | null
  readonly progression: Progression
  readonly sets: readonly PlannedSet[]
}

/** An entry out of a superset, resting two minutes, Manual, with no cue: one set of 5 reps. */
const entry = (
  id: string,
  of: Exercise,
  fields: Partial<Omit<PlannedEntry, 'id' | 'exercise'>> = {},
): PlannedEntry => ({
  id,
  exercise: of,
  supersetGroup: null,
  restSeconds: 120,
  cue: null,
  progression: MANUAL,
  sets: [work({ reps: 5 })],
  ...fields,
})

interface PlannedDay {
  readonly name: string
  readonly entries: readonly PlannedEntry[]
}

/** "Push Pull Legs", the reader's own, of these days — each index its place in the order given. */
const workout = (
  days: readonly PlannedDay[],
  fields: Partial<Pick<Workout, 'name' | 'notes' | 'ownerGroupId' | 'canEdit'>> = {},
): Workout =>
  Workout.parse({
    id: WORKOUT,
    name: 'Push Pull Legs',
    notes: null,
    dayCount: days.length,
    version: 1,
    ...owned,
    ...fields,
    days: days.map((day, dayAt) => ({
      id: crypto.randomUUID(),
      index: dayAt,
      name: day.name,
      entries: day.entries.map((planned, entryAt) => ({
        ...planned,
        index: entryAt,
        exerciseId: planned.exercise.id,
        sets: planned.sets.map((set, setAt) => ({ ...set, id: crypto.randomUUID(), index: setAt })),
      })),
    })),
  })

/** Someone who has not said what they have: nothing is known of what they load. */
const UNDESCRIBED = AthleteEquipment.parse({ described: false, items: [] })

const having = (slug: EquipmentSlug, weights: ItemWeights | null): AthleteEquipment =>
  AthleteEquipment.parse({ described: true, items: [{ slug, weights }] })

/** Dumbbells from 2 kg to 30 kg, by 2 kg. */
const DUMBBELLS = having('dumbbells', { stepG: 2000, minG: 2000, maxG: 30_000 })

/** 8 × 60 kg and the like, asking 2 in reserve. */
const at = (reps: number, weightG: number): SetTarget => asked({ reps, weightG, reserve: 2 })

/**
 * The reader's target on the Bench Press entry: three sets of 8 at 60 kg under Linear, +2.5 kg,
 * nothing trained yet — as the plan says, unless a fixture moves it.
 */
const target = (fields: Partial<EntryTarget> = {}): EntryTarget => {
  const prescribed = fields.prescribed ?? at(8, 60_000)
  const next = fields.target ?? prescribed
  return EntryTarget.parse({
    entryId: BENCH,
    exerciseId: benchPress.id,
    exerciseName: 'Bench Press',
    tracking: 'weight_reps',
    rule: LINEAR,
    prescribed,
    target: next,
    changed: false,
    held: null,
    limit: null,
    sessions: 0,
    byHand: false,
    warmups: [],
    working: [next, next, next],
    ...fields,
  })
}

describe('the workouts a caller can see', () => {
  const summary = (
    id: string,
    name: string,
    dayCount: number,
    fields: { ownerGroupId?: string; canEdit?: boolean } = {},
  ) => WorkoutSummary.parse({ id, name, notes: null, dayCount, version: 1, ...owned, ...fields })

  test('a line each: its name, its days, the group that owns it, and its id last', () => {
    const workouts = [
      summary(fakeId(11), 'Push Pull Legs', 3),
      summary(fakeId(12), 'Full Body', 1, { ownerGroupId: SQUAD }),
      summary(fakeId(13), 'Upper Lower', 4, { ownerGroupId: SQUAD, canEdit: false }),
      summary(fakeId(14), 'Starter Strength', 2, { ownerGroupId: LIBRARY, canEdit: false }),
      summary(fakeId(15), 'Deload Week', 0),
    ]
    expect(workoutLines(workouts, groupNameOf)).toBe(
      [
        `Push Pull Legs | 3 days | [mine] | ${fakeId(11)}`,
        `Full Body | 1 day | [Squad] | ${fakeId(12)}`,
        `Upper Lower | 4 days | [Squad, read-only] | ${fakeId(13)}`,
        `Starter Strength | 2 days | [library, read-only] | ${fakeId(14)}`,
        `Deload Week | 0 days | [mine] | ${fakeId(15)}`,
      ].join('\n'),
    )
  })

  test('none yet is said, not an empty answer', () => {
    expect(workoutLines([], groupNameOf)).toBe('No workouts yet.')
  })
})

describe('a workout renamed, or its notes changed', () => {
  test('its id and name, then its notes whole', () => {
    const renamed = workout([], { name: 'Push B', notes: 'Deload every fifth week' })
    expect(workoutUpdated(renamed)).toBe(
      [`Updated workout ${WORKOUT} — "Push B"`, 'notes: Deload every fifth week'].join('\n'),
    )
  })

  test('notes cleared are said as none', () => {
    const cleared = workout([], { name: 'Push', notes: null })
    expect(workoutUpdated(cleared)).toBe(
      [`Updated workout ${WORKOUT} — "Push"`, 'no notes'].join('\n'),
    )
  })
})

describe('a plan’s outline', () => {
  /**
   * A plan of one day, "Push", read by its owner in `unit`, with `equipment` and their `targets`:
   * the lines under the day's name. The header, the blank line and the day are the first two
   * tests'.
   */
  const linesOf = (
    entries: readonly PlannedEntry[],
    read: {
      unit?: WeightUnit
      equipment?: AthleteEquipment
      targets?: readonly EntryTarget[]
    } = {},
  ): string[] =>
    workoutDetail(
      workout([{ name: 'Push', entries }]),
      read.unit ?? 'kg',
      read.equipment ?? UNDESCRIBED,
      groupNameOf,
      read.targets ?? [],
    )
      .split('\n')
      .slice(3)

  /** Each entry's own line, without its sets. */
  const entryLinesOf = (entries: readonly PlannedEntry[]): string[] =>
    linesOf(entries).filter((line) => line.startsWith('  - '))

  test('the whole plan: header, notes, then each day’s entries, their sets, and the reader’s target', () => {
    const plan = workout(
      [
        {
          name: 'Day 1 · Push',
          entries: [
            entry(BENCH, benchPress, {
              restSeconds: 180,
              cue: 'Pause at the chest',
              progression: DOUBLE,
              sets: [
                warmUp({ reps: 5, weightG: 40_000 }),
                warmUp({ reps: 3, weightG: 50_000 }),
                work({ reps: 8, weightG: 60_000, reserve: 2 }),
                work({ reps: 8, weightG: 60_000, reserve: 1 }),
                work({ reps: 8, weightG: 60_000, reserve: 0 }),
              ],
            }),
            entry(PRESS, overheadPress, {
              supersetGroup: 'A',
              restSeconds: 90,
              progression: { ...LINEAR, afterSuccesses: 2 },
              sets: [work({ reps: 5, weightG: 40_000 })],
            }),
            entry(PUSHDOWN, pushdown, {
              supersetGroup: 'A',
              restSeconds: 90,
              sets: [work({ reps: 12, reserve: 1 })],
            }),
            entry(PLANK, plank, {
              restSeconds: null,
              progression: { kind: 'linear_duration', incrementS: 15, afterSuccesses: 1 },
              sets: [work({ durationS: 60 })],
            }),
          ],
        },
        {
          name: 'Pull',
          entries: [
            entry(PULL_UP, pullUp, {
              sets: [work({ reps: 6, weightG: 20_000, reserve: 2 }), work({ reps: 10 })],
            }),
            entry(ROWING, rowing, {
              restSeconds: 0,
              progression: { kind: 'linear_distance', incrementMm: 500_000, afterSuccesses: 1 },
              sets: [work({ distanceMm: 5_000_000, durationS: 1500 })],
            }),
          ],
        },
      ],
      { notes: 'Deload every fifth week' },
    )
    const targets = [
      // One cleared session under Double 8–12: a rep more, at the same weight.
      target({
        entryId: BENCH,
        rule: DOUBLE,
        target: at(9, 60_000),
        changed: true,
        sessions: 1,
      }),
      // Not trained yet: as the plan says, so the outline says nothing of it.
      target({
        entryId: PRESS,
        exerciseId: overheadPress.id,
        exerciseName: 'Overhead Press',
        rule: { ...LINEAR, afterSuccesses: 2 },
        prescribed: asked({ reps: 5, weightG: 40_000 }),
      }),
    ]

    expect(workoutDetail(plan, 'kg', UNDESCRIBED, groupNameOf, targets)).toBe(
      [
        `Push Pull Legs  (${WORKOUT})  [mine]`,
        'notes: Deload every fifth week',
        '',
        'Day 1 · Push',
        `  - Bench Press, rest 3:00, progression: Double 8–12, +2.5 kg   [entry ${BENCH}]`,
        '      cue: Pause at the chest',
        '      warm-up: 5 × 40 kg',
        '      warm-up: 3 × 50 kg',
        '      work: 8 × 60 kg · 2 in reserve',
        '      work: 8 × 60 kg · 1 in reserve',
        '      work: 8 × 60 kg · 0 in reserve',
        '      next: 9 × 60 kg — your target; reps in reserve as each set asks',
        `  - Overhead Press (superset A), rest 1:30 when it ends the round, progression: Linear, +2.5 kg after 2 cleared sessions   [entry ${PRESS}]`,
        '      work: 5 × 40 kg',
        `  - Triceps Pushdown (superset A), rest 1:30 after the round, progression: Manual   [entry ${PUSHDOWN}]`,
        '      work: 12 reps · 1 in reserve',
        `  - Plank, straight on, progression: Linear, +0:15   [entry ${PLANK}]`,
        '      work: 1:00',
        'Pull',
        `  - Pull-up, rest 2:00, progression: Manual   [entry ${PULL_UP}]`,
        '      work: 6 × bodyweight +20 kg · 2 in reserve',
        '      work: 10 × bodyweight',
        `  - Rowing, straight on, progression: Distance, +500 m at the same pace   [entry ${ROWING}]`,
        '      work: 5 km in 25:00',
      ].join('\n'),
    )
  })

  test('another group’s plan, read-only and without notes: the days follow the header', () => {
    const theirs = workout([{ name: 'Push', entries: [entry(BENCH, benchPress)] }], {
      ownerGroupId: SQUAD,
      canEdit: false,
    })
    expect(workoutDetail(theirs, 'kg', UNDESCRIBED, groupNameOf, [])).toBe(
      [
        `Push Pull Legs  (${WORKOUT})  [Squad, read-only]`,
        '',
        'Push',
        `  - Bench Press, rest 2:00, progression: Manual   [entry ${BENCH}]`,
        '      work: 5 reps',
      ].join('\n'),
    )
  })

  test('a day with no entries yet is its name alone', () => {
    const plan = workout([
      { name: 'Push', entries: [entry(BENCH, benchPress)] },
      { name: 'Legs', entries: [] },
    ])
    expect(workoutDetail(plan, 'kg', UNDESCRIBED, groupNameOf, []).split('\n').slice(2)).toEqual([
      'Push',
      `  - Bench Press, rest 2:00, progression: Manual   [entry ${BENCH}]`,
      '      work: 5 reps',
      'Legs',
    ])
  })

  /** #48: where the logger counts it — a superset rests after the round, never within it. */
  test('a rest reads where it falls: its own, when it ends the round, after the round, or straight on', () => {
    const lines = entryLinesOf([
      entry(fakeId(31), exercise('Squat'), { restSeconds: 180 }),
      entry(fakeId(32), benchPress, { supersetGroup: 'A', restSeconds: 90 }),
      entry(fakeId(33), exercise('Pulldown'), { supersetGroup: 'A', restSeconds: 90 }),
      entry(fakeId(34), exercise('Curl'), { restSeconds: 0 }),
      entry(fakeId(35), plank, { restSeconds: null }),
    ])
    expect(lines).toEqual([
      `  - Squat, rest 3:00, progression: Manual   [entry ${fakeId(31)}]`,
      `  - Bench Press (superset A), rest 1:30 when it ends the round, progression: Manual   [entry ${fakeId(32)}]`,
      `  - Pulldown (superset A), rest 1:30 after the round, progression: Manual   [entry ${fakeId(33)}]`,
      `  - Curl, straight on, progression: Manual   [entry ${fakeId(34)}]`,
      `  - Plank, straight on, progression: Manual   [entry ${fakeId(35)}]`,
    ])
  })

  test('each progression rule in full, Manual included', () => {
    const lines = entryLinesOf([
      entry(fakeId(41), benchPress),
      entry(fakeId(42), benchPress, { progression: LINEAR }),
      entry(fakeId(43), benchPress, { progression: { ...LINEAR, afterSuccesses: 2 } }),
      entry(fakeId(44), benchPress, { progression: DOUBLE }),
      entry(fakeId(45), plank, {
        progression: { kind: 'linear_duration', incrementS: 15, afterSuccesses: 1 },
      }),
      entry(fakeId(46), rowing, {
        progression: { kind: 'linear_distance', incrementMm: 500_000, afterSuccesses: 1 },
      }),
    ])
    expect(lines).toEqual([
      `  - Bench Press, rest 2:00, progression: Manual   [entry ${fakeId(41)}]`,
      `  - Bench Press, rest 2:00, progression: Linear, +2.5 kg   [entry ${fakeId(42)}]`,
      `  - Bench Press, rest 2:00, progression: Linear, +2.5 kg after 2 cleared sessions   [entry ${fakeId(43)}]`,
      `  - Bench Press, rest 2:00, progression: Double 8–12, +2.5 kg   [entry ${fakeId(44)}]`,
      `  - Plank, rest 2:00, progression: Linear, +0:15   [entry ${fakeId(45)}]`,
      `  - Rowing, rest 2:00, progression: Distance, +500 m at the same pace   [entry ${fakeId(46)}]`,
    ])
  })

  /** #35: kept in the plan, and said before the model plans around it. */
  test('an exercise the athlete’s equipment lacks is marked, and one they can do is not', () => {
    const squat = (doable: boolean) =>
      exercise('Back Squat', { equipment: ['barbell', 'rack'], doable })
    expect(entryLinesOf([entry(BENCH, squat(false))])).toEqual([
      `  - Back Squat [Missing equipment], rest 2:00, progression: Manual   [entry ${BENCH}]`,
    ])
    expect(entryLinesOf([entry(BENCH, squat(true))])).toEqual([
      `  - Back Squat, rest 2:00, progression: Manual   [entry ${BENCH}]`,
    ])
  })

  /** #36: the plan kept as written, and beside it the loadable weight the athlete would put on. */
  describe('a weight the athlete’s equipment cannot load as written', () => {
    const pressing = (sets: readonly PlannedSet[]) => [entry(BENCH, dumbbellPress, { sets })]
    const off = [work({ reps: 8, weightG: 22_500 }), work({ reps: 8, weightG: 32_500 })]

    test('says what it loads: the heaviest not above it, and where their equipment stops', () => {
      const lines = linesOf(
        pressing([
          warmUp({ reps: 5, weightG: 11_000 }),
          work({ reps: 8, weightG: 22_500, reserve: 2 }),
          work({ reps: 8, weightG: 32_500 }),
          work({ reps: 8, weightG: 1000 }),
        ]),
        { equipment: DUMBBELLS },
      )
      expect(lines).toEqual([
        `  - Dumbbell Press, rest 2:00, progression: Manual   [entry ${BENCH}]`,
        '      warm-up: 5 × 11 kg (loads 10 kg)',
        '      work: 8 × 22.5 kg · 2 in reserve (loads 22 kg)',
        '      work: 8 × 32.5 kg (loads 30 kg, your heaviest)',
        '      work: 8 × 1 kg (loads 2 kg, your lightest)',
      ])
    })

    test('a loadable weight, and a set that asks no weight, say nothing more', () => {
      const lines = linesOf(
        pressing([
          work({ reps: 8, weightG: 22_000 }),
          work({ reps: 8, weightG: 30_000 }),
          work({ reps: 12 }),
        ]),
        { equipment: DUMBBELLS },
      )
      expect(lines).toEqual([
        `  - Dumbbell Press, rest 2:00, progression: Manual   [entry ${BENCH}]`,
        '      work: 8 × 22 kg',
        '      work: 8 × 30 kg',
        '      work: 12 reps',
      ])
    })

    test('nothing is said while what they load is not known', () => {
      const asWritten = ['      work: 8 × 22.5 kg', '      work: 8 × 32.5 kg']
      // They have not said what they have.
      expect(linesOf(pressing(off), { equipment: UNDESCRIBED }).slice(1)).toEqual(asWritten)
      // They have dumbbells, and have not said how their weights go.
      expect(linesOf(pressing(off), { equipment: having('dumbbells', null) }).slice(1)).toEqual(
        asWritten,
      )
      // Nobody has said what the exercise is loaded with.
      expect(
        linesOf([entry(BENCH, overheadPress, { sets: off })], { equipment: DUMBBELLS }).slice(1),
      ).toEqual(asWritten)
    })

    test('weight added to bodyweight loads by their weight belt', () => {
      const belt = having('weight_belt', { stepG: 5000, minG: 0, maxG: 40_000 })
      const lines = linesOf(
        [entry(PULL_UP, pullUp, { sets: [work({ reps: 6, weightG: 12_500 })] })],
        {
          equipment: belt,
        },
      )
      expect(lines.slice(1)).toEqual(['      work: 6 × bodyweight +12.5 kg (loads 10 kg)'])
    })
  })

  describe('the reader’s own target', () => {
    const entries = [
      entry(BENCH, benchPress, { progression: LINEAR, sets: [work({ reps: 8, weightG: 60_000 })] }),
      entry(PRESS, overheadPress, {
        progression: LINEAR,
        sets: [work({ reps: 5, weightG: 40_000 })],
      }),
    ]
    const asPlanned = target({ entryId: BENCH })
    const moved = target({
      entryId: PRESS,
      exerciseId: overheadPress.id,
      exerciseName: 'Overhead Press',
      prescribed: asked({ reps: 5, weightG: 40_000 }),
      target: asked({ reps: 5, weightG: 42_500 }),
      changed: true,
      sessions: 1,
    })

    test('is said under its entry, and only where it has moved off the prescription', () => {
      expect(linesOf(entries, { targets: [asPlanned, moved] })).toEqual([
        `  - Bench Press, rest 2:00, progression: Linear, +2.5 kg   [entry ${BENCH}]`,
        '      work: 8 × 60 kg',
        `  - Overhead Press, rest 2:00, progression: Linear, +2.5 kg   [entry ${PRESS}]`,
        '      work: 5 × 40 kg',
        '      next: 5 × 42.5 kg — your target; reps in reserve as each set asks',
      ])
    })

    test('is not said with no targets given, as when the plan is read for an athlete', () => {
      expect(linesOf(entries, { targets: [] })).toEqual([
        `  - Bench Press, rest 2:00, progression: Linear, +2.5 kg   [entry ${BENCH}]`,
        '      work: 8 × 60 kg',
        `  - Overhead Press, rest 2:00, progression: Linear, +2.5 kg   [entry ${PRESS}]`,
        '      work: 5 × 40 kg',
      ])
    })
  })

  test('in pounds for a reader who reads pounds: the rule, each set, what it loads, their target', () => {
    const lines = linesOf(
      [
        entry(BENCH, dumbbellPress, {
          progression: { kind: 'linear', incrementG: lbToG(5), afterSuccesses: 1 },
          sets: [work({ reps: 8, weightG: lbToG(22.5) })],
        }),
      ],
      {
        unit: 'lb',
        // Dumbbells from 5 lb to 50 lb, by 5 lb: 22.5 lb loads 20, and a step on from 20 is 25.
        equipment: having('dumbbells', { stepG: lbToG(5), minG: lbToG(5), maxG: lbToG(50) }),
        targets: [
          target({
            exerciseId: dumbbellPress.id,
            exerciseName: 'Dumbbell Press',
            rule: { kind: 'linear', incrementG: lbToG(5), afterSuccesses: 1 },
            prescribed: asked({ reps: 8, weightG: lbToG(22.5) }),
            target: asked({ reps: 8, weightG: lbToG(25) }),
            changed: true,
            sessions: 1,
          }),
        ],
      },
    )
    expect(lines).toEqual([
      `  - Dumbbell Press, rest 2:00, progression: Linear, +5 lb   [entry ${BENCH}]`,
      '      work: 8 × 22.5 lb (loads 20 lb)',
      '      next: 8 × 25 lb — your target; reps in reserve as each set asks',
    ])
  })
})

describe('each entry’s next target', () => {
  test('a workout with no entries says so', () => {
    expect(nextTargetLines([], 'kg')).toBe('This workout has no entries yet.')
  })

  test('a line each, in the order the entries come', () => {
    const targets = [
      target({ target: at(8, 62_500), changed: true, sessions: 1 }),
      target({ entryId: PRESS, exerciseName: 'Overhead Press', rule: MANUAL }),
    ]
    expect(nextTargetLines(targets, 'kg')).toBe(
      [
        'Bench Press (Linear, +2.5 kg): next 8 × 62.5 kg; the plan says 8 × 60 kg  (from 1 session)',
        'Overhead Press (Manual): 8 × 60 kg, the plan’s numbers — change the plan to change them',
      ].join('\n'),
    )
  })

  test('a manual entry is the plan’s numbers, and nothing moves them', () => {
    expect(nextTargetLine(target({ rule: MANUAL }), 'kg')).toBe(
      'Bench Press (Manual): 8 × 60 kg, the plan’s numbers — change the plan to change them',
    )
  })

  test('nothing trained yet: the target is as the plan says, with no session behind it', () => {
    expect(nextTargetLine(target({ rule: DOUBLE }), 'kg')).toBe(
      'Bench Press (Double 8–12, +2.5 kg): next 8 × 60 kg, as the plan says  (no session yet)',
    )
  })

  test('a target moved past the plan, beside what the plan says', () => {
    const moved = target({ target: at(8, 62_500), changed: true, sessions: 1 })
    expect(nextTargetLine(moved, 'kg')).toBe(
      'Bench Press (Linear, +2.5 kg): next 8 × 62.5 kg; the plan says 8 × 60 kg  (from 1 session)',
    )
  })

  test('held short of the target: the set, what it did, of what it was asked', () => {
    const held = target({
      held: { reason: 'targets', set: 3, did: at(6, 60_000), asked: at(8, 60_000) },
      sessions: 1,
    })
    expect(nextTargetLine(held, 'kg')).toBe(
      'Bench Press (Linear, +2.5 kg): next 8 × 60 kg, as the plan says — held: set 3 did 6 of 8  (from 1 session)',
    )
  })

  test('held for effort: the set, what it left in reserve, and what it asked', () => {
    const held = target({ held: { reason: 'effort', set: 1, reserve: 0, asked: 2 }, sessions: 1 })
    expect(nextTargetLine(held, 'kg')).toBe(
      'Bench Press (Linear, +2.5 kg): next 8 × 60 kg, as the plan says — held for effort: set 1 left 0 in reserve, asked 2  (from 1 session)',
    )
  })

  /** #66: at their heaviest there is nothing heavier to move to, so it is not read as a stall. */
  test('at the heaviest the athlete can load, it says so — planned there, or trained up to it', () => {
    expect(nextTargetLine(target({ limit: 'heaviest' }), 'kg')).toBe(
      'Bench Press (Linear, +2.5 kg): next 8 × 60 kg (your heaviest), as the plan says  (no session yet)',
    )
    const reached = target({
      prescribed: at(8, 57_500),
      target: at(8, 60_000),
      changed: true,
      limit: 'heaviest',
      sessions: 1,
    })
    expect(nextTargetLine(reached, 'kg')).toBe(
      'Bench Press (Linear, +2.5 kg): next 8 × 60 kg (your heaviest); the plan says 8 × 57.5 kg  (from 1 session)',
    )
  })

  test('over a plan lighter than their lightest, it says that', () => {
    const lightest = target({
      exerciseName: 'Dumbbell Press',
      rule: DOUBLE,
      prescribed: at(8, 1000),
      target: at(10, 2000),
      changed: true,
      limit: 'lightest',
      byHand: true,
    })
    expect(nextTargetLine(lightest, 'kg')).toBe(
      'Dumbbell Press (Double 8–12, +2.5 kg): next 10 × 2 kg (your lightest); the plan says 8 × 1 kg  (set by hand)',
    )
  })

  /** #66: the sessions since the target last started, never every session the entry took. */
  test('behind a target are the sessions since it started from the prescription', () => {
    const after = (sessions: number) =>
      target({ rule: DOUBLE, target: at(11, 60_000), changed: true, sessions })
    expect(nextTargetLine(after(1), 'kg')).toBe(
      'Bench Press (Double 8–12, +2.5 kg): next 11 × 60 kg; the plan says 8 × 60 kg  (from 1 session)',
    )
    expect(nextTargetLine(after(3), 'kg')).toBe(
      'Bench Press (Double 8–12, +2.5 kg): next 11 × 60 kg; the plan says 8 × 60 kg  (from 3 sessions)',
    )
  })

  test('set by hand: says so, and the sessions since', () => {
    const byHand = (reps: number, sessions: number) =>
      target({ rule: DOUBLE, target: at(reps, 60_000), changed: true, byHand: true, sessions })
    expect(nextTargetLine(byHand(10, 0), 'kg')).toBe(
      'Bench Press (Double 8–12, +2.5 kg): next 10 × 60 kg; the plan says 8 × 60 kg  (set by hand)',
    )
    expect(nextTargetLine(byHand(11, 1), 'kg')).toBe(
      'Bench Press (Double 8–12, +2.5 kg): next 11 × 60 kg; the plan says 8 × 60 kg  (set by hand, then 1 session)',
    )
    expect(nextTargetLine(byHand(12, 2), 'kg')).toBe(
      'Bench Press (Double 8–12, +2.5 kg): next 12 × 60 kg; the plan says 8 × 60 kg  (set by hand, then 2 sessions)',
    )
  })

  test('in what the exercise tracks: added to bodyweight, a hold, a distance in its time', () => {
    const added = (weightG: number) => asked({ reps: 6, weightG, reserve: 2 })
    const pullUps = target({
      exerciseName: 'Pull-up',
      tracking: 'bodyweight_reps',
      prescribed: added(20_000),
      held: { reason: 'targets', set: 1, did: added(15_000), asked: added(20_000) },
      sessions: 1,
    })
    expect(nextTargetLine(pullUps, 'kg')).toBe(
      'Pull-up (Linear, +2.5 kg): next 6 × bodyweight +20 kg, as the plan says — held: set 1 did 6 × bodyweight +15 kg of 6 × bodyweight +20 kg  (from 1 session)',
    )

    const planks = target({
      exerciseName: 'Plank',
      tracking: 'duration',
      rule: { kind: 'linear_duration', incrementS: 15, afterSuccesses: 1 },
      prescribed: asked({ durationS: 60 }),
      target: asked({ durationS: 75 }),
      changed: true,
      sessions: 1,
    })
    expect(nextTargetLine(planks, 'kg')).toBe(
      'Plank (Linear, +0:15): next 1:15; the plan says 1:00  (from 1 session)',
    )

    const rows = target({
      exerciseName: 'Rowing',
      tracking: 'distance_duration',
      rule: { kind: 'linear_distance', incrementMm: 500_000, afterSuccesses: 1 },
      prescribed: asked({ distanceMm: 5_000_000, durationS: 1500 }),
      target: asked({ distanceMm: 5_500_000, durationS: 1650 }),
      changed: true,
      sessions: 1,
    })
    expect(nextTargetLine(rows, 'kg')).toBe(
      'Rowing (Distance, +500 m at the same pace): next 5.5 km in 27:30; the plan says 5 km in 25:00  (from 1 session)',
    )
  })

  test('in pounds for a reader who reads pounds: the rule, the target, the plan, why it held', () => {
    const rule: Progression = { kind: 'linear', incrementG: lbToG(5), afterSuccesses: 1 }
    const pounds = (lb: number) => at(8, lbToG(lb))
    const moved = target({
      rule,
      prescribed: pounds(135),
      target: pounds(140),
      changed: true,
      sessions: 1,
    })
    expect(nextTargetLine(moved, 'lb')).toBe(
      'Bench Press (Linear, +5 lb): next 8 × 140 lb; the plan says 8 × 135 lb  (from 1 session)',
    )
    const held = target({
      rule,
      prescribed: pounds(135),
      held: { reason: 'targets', set: 2, did: pounds(130), asked: pounds(135) },
      sessions: 1,
    })
    expect(nextTargetLine(held, 'lb')).toBe(
      'Bench Press (Linear, +5 lb): next 8 × 135 lb, as the plan says — held: set 2 did 8 × 130 lb of 8 × 135 lb  (from 1 session)',
    )
  })
})

/**
 * An entry whose exercise the reader can no longer see (GLOSSARY.md, "Unavailable exercise"): the
 * plan still holds it, so the outline still says what it prescribes — under the one name such an
 * exercise has everywhere, and with no tracking mode to read its sets by.
 */
describe('an entry whose exercise is out of reach', () => {
  test('is named as one, and its sets say only what was measured', () => {
    const plan = workout([{ name: 'Push', entries: [entry(BENCH, benchPress)] }])
    const out = structuredClone(plan)
    for (const planned of out.days.flatMap((day) => day.entries)) planned.exercise = null
    // Still a workout as the contract has one: an entry's exercise may be null.
    const lost = Workout.parse(out)
    expect(workoutDetail(lost, 'kg', UNDESCRIBED, groupNameOf, []).split('\n').slice(2)).toEqual([
      'Push',
      `  - Unavailable exercise, rest 2:00, progression: Manual   [entry ${BENCH}]`,
      '      work: 5 reps',
    ])
  })
})

/** What the two tools that make a workout answer: its id, its name, and what to do next. */
describe('a workout made', () => {
  test('created empty, it says what to call next', () => {
    expect(workoutCreated(workout([]))).toBe(
      `Created workout ${WORKOUT} — "Push Pull Legs". Now call workout_save_plan.`,
    )
  })

  test('copied, it says how many days came with it — one day in the singular', () => {
    const day = (name: string) => ({ name, entries: [entry(crypto.randomUUID(), benchPress)] })
    expect(workoutCopied(workout([day('Push'), day('Pull')]))).toBe(
      `Copied to workout ${WORKOUT} — "Push Pull Legs", 2 days.`,
    )
    expect(workoutCopied(workout([day('Push')]))).toBe(
      `Copied to workout ${WORKOUT} — "Push Pull Legs", 1 day.`,
    )
  })
})
