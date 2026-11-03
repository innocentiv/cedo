import { describe, expect, test } from 'bun:test'
import {
  prescribeAt,
  reservesVary,
  restartsTarget,
  sameReserveForAll,
  startAtChoices,
  setNames,
  switchRule,
  hasTarget,
  warmupsAt,
  withRange,
  workingAt,
} from './entry-editing.ts'
import type { WorkoutSetInput } from './plan-set.ts'
import type { Progression } from './progression.ts'
import type { WorkoutEntryInput } from './workout.ts'

const set = (
  targetReps: number,
  kg: number,
  targetReserve: number | null = null,
  isWarmup = false,
): WorkoutSetInput => ({
  targetReps,
  targetWeightG: kg * 1000,
  targetReserve,
  targetDurationS: null,
  targetDistanceMm: null,
  isWarmup,
})
const entry = (progression: Progression, ...sets: WorkoutSetInput[]): WorkoutEntryInput => ({
  exerciseId: 'bench',
  supersetGroup: null,
  restSeconds: 120,
  cue: null,
  progression,
  sets,
})
const MANUAL: Progression = { kind: 'none' }
const DOUBLE: Progression = { kind: 'double', repRange: [8, 12], incrementG: 2500 }
const LINEAR: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }

/** The entry editor's moves (docs/08-frontend.md, "An entry's settings"): pure, so tested here. */
describe('prescribeAt — one set, as written on paper', () => {
  test('a Manual line changes its own set and no other', () => {
    const top = entry(MANUAL, set(5, 40, null, true), set(6, 90), set(8, 80), set(8, 80))
    expect(prescribeAt(top, 1, { targetWeightG: 92_500 }).sets).toEqual([
      set(5, 40, null, true),
      set(6, 92.5),
      set(8, 80),
      set(8, 80),
    ])
  })

  test('a warm-up line is its own', () => {
    const warm = entry(DOUBLE, set(5, 40, null, true), set(10, 60))
    expect(prescribeAt(warm, 0, { targetReps: 3 }).sets[0]).toEqual(set(3, 40, null, true))
  })
})

describe('reps in reserve, all sets or by set', () => {
  test('vary while the working sets ask different reserves — warm-ups aside', () => {
    expect(reservesVary(entry(DOUBLE, set(10, 60, 2), set(10, 60, 2)))).toBe(false)
    expect(reservesVary(entry(DOUBLE, set(10, 60, 2), set(10, 60, 1), set(10, 60, 0)))).toBe(true)
    expect(reservesVary(entry(DOUBLE, set(5, 40, null, true), set(10, 60, 2)))).toBe(false)
  })

  test('same for all sets uses set 1’s for every working set', () => {
    const ramp = entry(DOUBLE, set(5, 40, null, true), set(10, 60, 2), set(10, 60, 1))
    expect(sameReserveForAll(ramp).sets).toEqual([
      set(5, 40, null, true),
      set(10, 60, 2),
      set(10, 60, 2),
    ])
  })
})

describe('switchRule', () => {
  test('sets that already agree switch without asking', () => {
    const same = entry(MANUAL, set(10, 60, 2), set(10, 60, 1))
    expect(switchRule(same, LINEAR)).toEqual({
      entry: { ...same, progression: LINEAR },
      overwrites: false,
    })
  })

  test('a top set and back-offs switch to set 1’s numbers — and say so, to be asked first', () => {
    const top = entry(MANUAL, set(5, 40, null, true), set(6, 90, 1), set(8, 80, 2))
    expect(switchRule(top, LINEAR)).toEqual({
      entry: {
        ...top,
        progression: LINEAR,
        sets: [set(5, 40, null, true), set(6, 90, 1), set(6, 90, 2)],
      },
      overwrites: true,
    })
  })

  test('a double’s range takes in the reps the sets ask, so they start inside it', () => {
    const fives = entry(MANUAL, set(5, 100), set(5, 100))
    expect(switchRule(fives, DOUBLE).entry.progression).toEqual({ ...DOUBLE, repRange: [5, 12] })
    const fifteens = entry(MANUAL, set(15, 20))
    expect(switchRule(fifteens, DOUBLE).entry.progression).toEqual({ ...DOUBLE, repRange: [8, 15] })
  })

  test('to Manual, nothing is overwritten', () => {
    const ruled = entry(DOUBLE, set(10, 60), set(10, 60))
    expect(switchRule(ruled, MANUAL)).toEqual({
      entry: { ...ruled, progression: MANUAL },
      overwrites: false,
    })
  })
})

describe('startAtChoices', () => {
  test('under double, the range’s reps, so reps outside it cannot be picked', () => {
    expect(startAtChoices(DOUBLE)).toEqual([8, 9, 10, 11, 12])
  })

  test('under any other rule, none: the reps are typed', () => {
    expect(startAtChoices(LINEAR)).toEqual([])
    expect(startAtChoices(MANUAL)).toEqual([])
  })
})

/**
 * "your next session restarts from the plan" (ADR-0026): said while an edit changes what a step is
 * compared against — and no longer once it is put back.
 */
describe('restartsTarget', () => {
  const plan = entry(DOUBLE, set(5, 40, null, true), set(10, 60, 2), set(10, 60, 2))

  test('an edit to what the rule moves or judges, or to the rule, restarts it', () => {
    expect(restartsTarget(plan, prescribeAt(plan, 1, { targetWeightG: 62_500 }))).toBe(true)
    expect(restartsTarget(plan, { ...plan, progression: { ...DOUBLE, repRange: [6, 10] } })).toBe(
      true,
    )
    expect(restartsTarget(plan, prescribeAt(plan, 2, { targetReserve: 1 }))).toBe(true)
  })

  test('warm-ups, the number of sets, rest and cue restart nothing', () => {
    expect(restartsTarget(plan, prescribeAt(plan, 0, { targetWeightG: 30_000 }))).toBe(false)
    expect(restartsTarget(plan, { ...plan, sets: [...plan.sets, set(10, 60, 2)] })).toBe(false)
    expect(restartsTarget(plan, { ...plan, restSeconds: 180, cue: 'Pause' })).toBe(false)
  })
})

/** A double's range edited: the reps it starts at stay inside it, so none is left outside. */
describe('withRange', () => {
  const tens = entry(DOUBLE, set(5, 40, null, true), set(10, 60, 2), set(10, 60, 1))

  test('reps the new range still holds are kept', () => {
    expect(withRange(tens, [6, 10]).sets).toEqual(tens.sets)
    expect(withRange(tens, [6, 10]).progression).toEqual({ ...DOUBLE, repRange: [6, 10] })
  })

  test('reps outside it move to its nearest end — warm-ups and reserves as they were', () => {
    expect(withRange(tens, [12, 15]).sets).toEqual([
      set(5, 40, null, true),
      set(12, 60, 2),
      set(12, 60, 1),
    ])
    expect(withRange(tens, [5, 8]).sets.map((s) => s.targetReps)).toEqual([5, 8, 8])
  })

  test('only a double has a range', () => {
    const linear = entry(LINEAR, set(10, 60))
    expect(withRange(linear, [6, 8])).toBe(linear)
  })
})

/** What the editor lays out set by set: where each working set is, and what each set is called. */
describe('sets, as the editor names them', () => {
  const warm = entry(
    DOUBLE,
    set(5, 40, null, true),
    set(3, 50, null, true),
    set(10, 60),
    set(10, 60),
  )

  test('the warm-ups and the working sets, each with its place among all the sets', () => {
    expect(warmupsAt(warm).map((w) => w.at)).toEqual([0, 1])
    expect(workingAt(warm).map((w) => w.at)).toEqual([2, 3])
  })

  test('warm-ups and working sets counted apart', () => {
    expect(setNames(warm.sets)).toEqual(['Warm-up 1', 'Warm-up 2', 'Set 1', 'Set 2'])
  })
})

describe('hasTarget', () => {
  test('a rule gives each follower a target; Manual has none — its numbers are the plan’s', () => {
    expect(hasTarget(DOUBLE)).toBe(true)
    expect(hasTarget(LINEAR)).toBe(true)
    expect(hasTarget(MANUAL)).toBe(false)
  })
})
