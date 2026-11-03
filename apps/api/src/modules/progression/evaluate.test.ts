import { describe, expect, test } from 'bun:test'
import {
  type AthleteEquipment,
  type Progression,
  type SetTarget,
  againstOf,
  loadOf,
} from '@cedo/contract'
import {
  type EntryToEvaluate,
  type LatestStep,
  type PrescribedSet,
  suggest,
  targetsFrom,
} from './evaluate.ts'

/**
 * Reading a target, without a database (ADR-0026): the latest step while it still counts against
 * the plan as it stands, else the prescription — in weights the athlete can load. Taking steps is
 * tested in the contract (`step`) and through the routes (`steps.test.ts`).
 */

const LINEAR: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }

const entry = (progression: Progression = LINEAR): EntryToEvaluate => ({
  id: 'bench',
  exerciseId: 'bench-exercise',
  exerciseName: 'Bench Press',
  tracking: 'weight_reps',
  equipment: ['dumbbells', 'flat_bench'],
  progression,
})

/** Someone who has not said what they train with: nothing is snapped (#36). */
const UNDESCRIBED: AthleteEquipment = { described: false, items: [] }
const DUMBBELLS: AthleteEquipment = {
  described: true,
  items: [{ slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: 30_000 } }],
}

const prescribed = (
  weightG: number,
  reps: number,
  more: Partial<PrescribedSet> = {},
): PrescribedSet => ({
  entryId: 'bench',
  targetReps: reps,
  targetWeightG: weightG,
  targetReserve: 2,
  targetDurationS: null,
  targetDistanceMm: null,
  isWarmup: false,
  ...more,
})

const plan = (weightG = 60_000) => [
  prescribed(20_000, 5, { isWarmup: true }),
  ...[1, 2, 3].map(() => prescribed(weightG, 8)),
]

const at = (weightG: number, reps = 8): SetTarget => ({
  reps,
  weightG,
  reserve: 2,
  durationS: null,
  distanceMm: null,
})

/** The latest step, taken against `sets` — the plan as it stood then. */
const stepped = (target: SetTarget, sets = plan(), more: Partial<LatestStep> = {}): LatestStep => ({
  entryId: 'bench',
  target,
  held: null,
  against: againstOf(
    LINEAR,
    sets.filter((s) => !s.isWarmup),
  ),
  sessions: 1,
  ...more,
})

const read = (sets: PrescribedSet[], steps: LatestStep[], held = UNDESCRIBED) => {
  const [suggestion] = suggest([entry()], sets, steps, (exercise) => loadOf(exercise, held, 'kg'))
  return suggestion
}

describe('reading a target', () => {
  test('with no step yet, the prescription — its first working set, never a warm-up', () => {
    const suggestion = read(plan(), [])
    expect(suggestion?.current).toMatchObject({ weightG: 60_000, reps: 8 })
    expect(suggestion?.suggested).toEqual(suggestion?.current)
    expect(suggestion?.changed).toBe(false)
    expect(suggestion?.sessionsConsidered).toBe(0)
  })

  test('the latest step, while the plan stands as it was taken against', () => {
    const suggestion = read(plan(), [stepped(at(65_000), plan(), { sessions: 3 })])
    expect(suggestion?.suggested).toMatchObject({ weightG: 65_000, reps: 8 })
    expect(suggestion?.changed).toBe(true)
    expect(suggestion?.sessionsConsidered).toBe(3)
  })

  test('says why the latest step held', () => {
    const held = { reason: 'effort', set: 1, reserve: 0, asked: 2 } as const
    expect(read(plan(), [stepped(at(60_000), plan(), { held })])?.held).toEqual(held)
  })

  /** Resets are derived, never written: nothing changed but the plan, and back again. */
  test('the prescription once the plan moved under the step — and the step once it is put back', () => {
    const step = stepped(at(65_000))
    const typo = read(plan(6_000), [step])
    expect(typo?.suggested).toMatchObject({ weightG: 6_000 })
    expect(typo?.changed).toBe(false)
    expect(typo?.held).toBeNull()
    expect(read(plan(), [step])?.suggested).toMatchObject({ weightG: 65_000 })
  })

  test('asks the reserve the plan asks, which no rule moves', () => {
    const step = stepped({ ...at(65_000), reserve: 4 })
    expect(read(plan(), [step])?.suggested.reserve).toBe(2)
  })

  /** #36: shown in a weight the athlete can load, the prescription and the step alike. */
  test('in weights the athlete can load: 22.5 is 22, and a step at 24 stays 24', () => {
    const sets = plan(22_500)
    const none = read(sets, [], DUMBBELLS)
    expect(none?.suggested.weightG).toBe(22_000)
    expect(none?.changed).toBe(false)
    expect(read(sets, [stepped(at(24_000), sets)], DUMBBELLS)?.suggested.weightG).toBe(24_000)
  })
})

/** What a session asks of each warm-up (ADR-0026): following the working target, worked out here. */
describe("a session's warm-ups", () => {
  test('follow the working target in proportion, and ask as planned before any step', () => {
    const asked = (steps: LatestStep[]) =>
      targetsFrom([entry()], plan(), steps, () => null, new Map())[0]?.warmups
    expect(asked([])).toEqual([at(20_000, 5)])
    expect(asked([stepped(at(75_000))])).toEqual([at(25_000, 5)])
  })
})

/**
 * Snapping is not progress (#36): a 22.5 kg plan shown as 22 on 2 kg dumbbells has not moved, so
 * its warm-ups ask what they say, in a weight the equipment loads — not scaled by 22 ÷ 22.5.
 */
describe("a session's warm-ups, against the equipment", () => {
  test('ask what they say, loadable, while no step moved the target', () => {
    const sets = [
      prescribed(20_000, 5, { isWarmup: true }),
      ...[1, 2, 3].map(() => prescribed(22_500, 8)),
    ]
    const loadFor = (exercise: Parameters<typeof loadOf>[0]) => loadOf(exercise, DUMBBELLS, 'kg')
    const [asked] = targetsFrom([entry()], sets, [], loadFor, new Map())
    expect(asked?.warmups.map((w) => w.weightG)).toEqual([20_000])
  })
})

/**
 * What a session asks of each working set (docs/08-frontend.md, the logger): under a rule, the
 * target, each set asking its own reps in reserve (ADR-0026); on Manual, each set's own numbers —
 * a top set and its back-offs pre-filled as written, not all as set 1.
 */
describe("a session's working sets, each its own", () => {
  const ramp = [2, 1, 0].map((targetReserve) => prescribed(60_000, 8, { targetReserve }))

  test("under a rule: the target, with each set's own reps in reserve", () => {
    const [asked] = targetsFrom([entry()], ramp, [stepped(at(62_500), ramp)], () => null, new Map())
    expect(asked?.working).toEqual(
      [2, 1, 0].map((reserve) => Object.assign(at(62_500), { reserve })),
    )
  })

  test("on Manual: each set's own numbers, as the equipment loads them", () => {
    const top = [
      prescribed(90_000, 6, { targetReserve: 1 }),
      prescribed(80_500, 8),
      prescribed(80_500, 8),
    ]
    const loadFor = (exercise: Parameters<typeof loadOf>[0]) => loadOf(exercise, DUMBBELLS, 'kg')
    const [asked] = targetsFrom([entry({ kind: 'none' })], top, [], loadFor, new Map())
    // 90 is past the heaviest dumbbell (30); 80.5 too — each asked as it can be loaded.
    expect(asked?.working).toEqual([{ ...at(30_000, 6), reserve: 1 }, at(30_000), at(30_000)])
    const [unloaded] = targetsFrom([entry({ kind: 'none' })], top, [], () => null, new Map())
    expect(unloaded?.working).toEqual([{ ...at(90_000, 6), reserve: 1 }, at(80_500), at(80_500)])
  })
})

/** The editor's Your next session column shows the warm-ups as the next session asks them. */
describe('a target, as the editor reads it', () => {
  test('carries its warm-ups, following the working target in proportion', () => {
    expect(read(plan(), [stepped(at(75_000))])?.warmups).toEqual([at(25_000, 5)])
    expect(read(plan(), [])?.warmups).toEqual([at(20_000, 5)])
  })
})
