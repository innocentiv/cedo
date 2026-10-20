import { describe, expect, test } from 'bun:test'
import { NO_PROGRESSION, describeProgression } from './progression.ts'
import { formatWeight } from './units.ts'
import {
  canAddDay,
  canAddEntry,
  newDay,
  newEntry,
  planIssues,
  prescribe,
  prescriptionOf,
  progressionOf,
  resizeSets,
  setCounts,
} from './plan-editing.ts'
import {
  MAX_DAYS_PER_PLAN,
  MAX_ENTRIES_PER_DAY,
  MAX_SETS_PER_ENTRY,
  WorkoutEntryInput,
  WorkoutPlanInput,
  setTargetOf,
  targetFieldsOf,
} from './workout.ts'

const bench = newEntry({ id: crypto.randomUUID(), tracking: 'weight_reps' })

describe('a new entry', () => {
  test('prescribes three working sets in what the exercise measures', () => {
    const plank = newEntry({ id: crypto.randomUUID(), tracking: 'duration' })
    expect(setCounts(plank)).toEqual({ warmup: 0, working: 3 })
    expect(prescriptionOf(plank)).toMatchObject({ targetReps: null, targetDurationS: 30 })
    expect(prescriptionOf(bench)).toMatchObject({ targetReps: 8, targetDurationS: null })
  })

  test('is one the schema accepts', () => {
    expect(WorkoutEntryInput.safeParse(bench).success).toBe(true)
  })
})

describe('the prescription', () => {
  /** One rule for every shape of set, so a plan as READ answers as the plan being edited does. */
  test('is the first working set, in a plan as read just as in one being edited', () => {
    const warmup = { isWarmup: true, target: { reps: 5, weightG: 20_000 } }
    const working = { isWarmup: false, target: { reps: 8, weightG: 60_000 } }
    expect(prescriptionOf({ sets: [warmup, working, { ...working }] })).toBe(working)
    expect(prescriptionOf({ sets: [warmup] })).toBeUndefined()
  })
})

describe('a set’s targets', () => {
  test('map from the written plan to the read one and back, every field in its place', () => {
    const fields = {
      targetReps: 8,
      targetWeightG: 60_000,
      targetRpe: 8,
      targetDurationS: 30,
      targetDistanceMm: 1000,
    }
    expect(setTargetOf(fields)).toEqual({
      reps: 8,
      weightG: 60_000,
      rpe: 8,
      durationS: 30,
      distanceMm: 1000,
    })
    expect(targetFieldsOf(setTargetOf(fields))).toEqual(fields)
  })
})

describe('resizing a band of sets', () => {
  /**
   * Regression: each band was clamped to 20 on its own, while the schema allows 20 IN TOTAL — so
   * 5 warm-ups and 20 working sets were accepted on screen and refused with a 422 on save.
   */
  test('never takes the entry past the total the schema allows', () => {
    const warmedUp = resizeSets(bench, 'warmup', 5)
    const full = resizeSets(warmedUp, 'working', 20)
    expect(setCounts(full)).toEqual({ warmup: 5, working: MAX_SETS_PER_ENTRY - 5 })
    expect(WorkoutEntryInput.safeParse(full).success).toBe(true)

    // And the other way round: a full working band leaves no room for warm-ups.
    const allWork = resizeSets(bench, 'working', 20)
    expect(setCounts(resizeSets(allWork, 'warmup', 3))).toEqual({ warmup: 0, working: 20 })
  })

  test('keeps at least one working set, and allows no warm-ups', () => {
    expect(setCounts(resizeSets(bench, 'working', 0))).toEqual({ warmup: 0, working: 1 })
    expect(setCounts(resizeSets(bench, 'working', null))).toEqual({ warmup: 0, working: 1 })
    expect(setCounts(resizeSets(bench, 'warmup', null))).toEqual({ warmup: 0, working: 3 })
  })

  test('new sets copy the prescription, and the other band is left as it was', () => {
    const loaded = prescribe(bench, { targetWeightG: 60_000 })
    const resized = resizeSets(loaded, 'warmup', 2)
    expect(resized.sets.map((s) => [s.isWarmup, s.targetWeightG])).toEqual([
      [true, 60_000],
      [true, 60_000],
      [false, 60_000],
      [false, 60_000],
      [false, 60_000],
    ])
  })
})

describe('prescribing', () => {
  test('changes every working set and no warm-up', () => {
    // The warm-up copies the prescription it was added under: 20 kg.
    const warmedUp = resizeSets(prescribe(bench, { targetWeightG: 20_000 }), 'warmup', 1)
    const prescribed = prescribe(warmedUp, { targetWeightG: 80_000 })
    expect(prescribed.sets.map((s) => s.targetWeightG)).toEqual([20_000, 80_000, 80_000, 80_000])
    expect(prescriptionOf(prescribed)?.targetWeightG).toBe(80_000)
  })
})

describe('how big a plan may grow', () => {
  test('a day can be added until the schema’s limit, and no further', () => {
    const days = Array.from({ length: MAX_DAYS_PER_PLAN - 1 }, (_, i) => newDay(i))
    expect(canAddDay(days)).toBe(true)
    expect(canAddDay([...days, newDay(days.length)])).toBe(false)
  })

  test('so can an exercise to a day', () => {
    const entries = Array.from({ length: MAX_ENTRIES_PER_DAY }, () => bench)
    expect(canAddEntry({ name: 'Day 1', entries: entries.slice(1) })).toBe(true)
    expect(canAddEntry({ name: 'Day 1', entries })).toBe(false)
  })

  test('the limits are the schema’s own', () => {
    const tooMany = { days: Array.from({ length: MAX_DAYS_PER_PLAN + 1 }, (_, i) => newDay(i)) }
    expect(WorkoutPlanInput.safeParse(tooMany).success).toBe(false)
  })
})

describe('the issues a draft would be refused for', () => {
  /** With every exercise in it visible: the schema's verdict alone. */
  const issuesIn = (plan: WorkoutPlanInput) => planIssues(plan, { has: () => true })

  test('none for a plan the schema accepts', () => {
    expect(issuesIn({ days: [{ name: 'Day 1', entries: [bench] }] })).toEqual([])
  })

  test('each located by day and exercise', () => {
    const noWorkingSet = { ...bench, sets: bench.sets.map((s) => ({ ...s, isWarmup: true })) }
    const issues = issuesIn({
      days: [
        { name: 'Day 1', entries: [bench] },
        { name: 'Day 2', entries: [bench, noWorkingSet] },
      ],
    })
    expect(issues).toEqual([
      'Day 2, exercise 2, sets: An entry must prescribe at least one working set',
    ])
  })

  test('a field’s problem names the field, in words a person can act on', () => {
    expect(issuesIn({ days: [{ name: '  ', entries: [bench] }] })).toEqual([
      'Day 1, name: Cannot be empty',
    ])
  })

  test('a plan-wide problem is not attributed to a day', () => {
    expect(issuesIn({ days: [] })).toEqual(['A plan needs at least one day'])
  })

  /**
   * Regression: the field was the FIRST string after the exercise — always `sets` — so a bad
   * target read "sets: Too small: expected number to be >0", once per working set.
   */
  test('a bad target is named by its unit, in plain words, once for all the working sets', () => {
    const zeroReps = prescribe(bench, { targetReps: 0 })
    expect(issuesIn({ days: [{ name: 'Day 1', entries: [zeroReps] }] })).toEqual([
      'Day 1, exercise 1, reps: Must be more than 0',
    ])
  })

  /** By what it measures, not its unit label — `m:ss` is a format, not a name. */
  test('a bad duration is named as a duration', () => {
    const plank = prescribe(newEntry({ id: crypto.randomUUID(), tracking: 'duration' }), {
      targetDurationS: 0,
    })
    expect(issuesIn({ days: [{ name: 'Day 1', entries: [plank] }] })).toEqual([
      'Day 1, exercise 1, duration: Must be more than 0',
    ])
  })

  test('a limit says what the limit is', () => {
    const set = {
      targetReps: 8,
      targetWeightG: null,
      targetRpe: null,
      targetDurationS: null,
      targetDistanceMm: null,
      isWarmup: false,
    }
    const crowded = { ...bench, sets: Array.from({ length: 21 }, () => set) }
    expect(issuesIn({ days: [{ name: 'Day 1', entries: [crowded] }] })).toEqual([
      'Day 1, exercise 1, sets: An exercise holds at most 20 sets',
    ])
  })
})

describe('a new rule', () => {
  /** In the person's unit: 2.5 kg read in pounds was "+5.51 lb", and every target drifted off. */
  test('adds 2.5 kg — or 5 lb, for someone who reads pounds', () => {
    expect(progressionOf('linear', NO_PROGRESSION, 'kg')).toMatchObject({ incrementG: 2500 })
    expect(progressionOf('linear', NO_PROGRESSION, 'lb')).toMatchObject({ incrementG: 2268 })
    expect(progressionOf('double', NO_PROGRESSION, 'lb')).toMatchObject({ incrementG: 2268 })
    expect(
      describeProgression(progressionOf('linear', NO_PROGRESSION, 'lb'), (g) =>
        formatWeight(g, 'lb'),
      ),
    ).toBe('Linear, +5 lb')
  })

  test('a duration rule adds time, whatever the weight unit', () => {
    expect(progressionOf('linear_duration', NO_PROGRESSION, 'lb')).toMatchObject({ incrementS: 15 })
  })

  test('choosing the kind it already is keeps its settings', () => {
    const tuned = { kind: 'linear', incrementG: 5000, afterSuccesses: 3 } as const
    expect(progressionOf('linear', tuned, 'lb')).toBe(tuned)
  })
})

/** See GLOSSARY.md, "Unavailable exercise". */
describe('an entry whose exercise is out of the editor’s reach', () => {
  const plank = newEntry({ id: crypto.randomUUID(), tracking: 'duration' })

  test('is an issue, located like any other: the server would refuse the save', () => {
    const visible = new Set([bench.exerciseId])
    expect(planIssues({ days: [{ name: 'Day 1', entries: [bench, plank] }] }, visible)).toEqual([
      'Day 1, exercise 2: Unavailable exercise — remove it to save',
    ])
  })

  test('once per entry, beside the schema’s own verdict', () => {
    const noName = { name: ' ', entries: [plank, plank] }
    expect(planIssues({ days: [noName] }, new Set())).toEqual([
      'Day 1, exercise 1: Unavailable exercise — remove it to save',
      'Day 1, exercise 2: Unavailable exercise — remove it to save',
      'Day 1, name: Cannot be empty',
    ])
  })
})
