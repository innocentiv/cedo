import { describe, expect, test } from 'bun:test'
import {
  type SeriesMember,
  type SetLog,
  exercisesInSession,
  nextSetIndex,
  workingSetsDone,
} from './log.ts'

const benchId = crypto.randomUUID()
const heavyEntry = crypto.randomUUID()
const lightEntry = crypto.randomUUID()
const heavy = { entryId: heavyEntry, exerciseId: benchId }
const light = { entryId: lightEntry, exerciseId: benchId }
const adHoc = { entryId: null, exerciseId: benchId }

const logged = (member: SeriesMember, ...indices: number[]) =>
  indices.map((setIndex) => ({
    entryId: member.entryId,
    exerciseId: member.exerciseId,
    setIndex,
    isWarmup: false,
  }))

describe('the next number in a series', () => {
  test('starts at zero', () => {
    expect(nextSetIndex([], heavy)).toBe(0)
  })

  test('follows the sets logged so far', () => {
    expect(nextSetIndex(logged(heavy, 0, 1, 2), heavy)).toBe(3)
  })

  test('after an undo in the middle, does not reuse an index still taken', () => {
    // Sets 1-3 logged, set 2 undone: a count says 2, which set 3 already holds.
    expect(nextSetIndex(logged(heavy, 0, 2), heavy)).toBe(3)
  })

  /**
   * Regression: the screen counted an ad-hoc set among EVERY log of its exercise, planned ones
   * included, so bench logged without a plan after two planned sets began at "set 3".
   */
  test('counts only its own series: one plan entry, or one exercise logged with none', () => {
    const logs = [...logged(heavy, 0, 1), ...logged(light, 0)]
    expect(nextSetIndex(logs, heavy)).toBe(2)
    expect(nextSetIndex(logs, light)).toBe(1)
    expect(nextSetIndex(logs, adHoc)).toBe(0)
  })

  test('warm-ups take their place in the same sequence', () => {
    const logs = [{ ...heavy, setIndex: 0, isWarmup: true }, ...logged(heavy, 1)]
    expect(nextSetIndex(logs, heavy)).toBe(2)
  })
})

describe('working sets done in a series', () => {
  test('counts the working sets of its own series only', () => {
    const logs = [
      { ...heavy, setIndex: 0, isWarmup: true },
      ...logged(heavy, 1, 2),
      ...logged(light, 0),
      ...logged(adHoc, 0),
    ]
    expect(workingSetsDone(logs, heavy)).toBe(2)
    expect(workingSetsDone(logs, light)).toBe(1)
    expect(workingSetsDone(logs, adHoc)).toBe(1)
  })
})

describe('the exercises a session without a plan is working through', () => {
  const bench = { id: crypto.randomUUID(), name: 'Bench Press', tracking: 'weight_reps' as const }
  const plank = { id: crypto.randomUUID(), name: 'Plank', tracking: 'duration' as const }
  const log = (exerciseId: string, exercise: SetLog['exercise']): SetLog => ({
    id: crypto.randomUUID(),
    entryId: null,
    exerciseId,
    exercise,
    setIndex: 0,
    weightG: null,
    reps: 8,
    rpe: null,
    durationS: null,
    distanceMm: null,
    isWarmup: false,
    loggedAt: new Date().toISOString(),
  })

  /** Regression: picked exercises were local state, so a reload showed no logger at all. */
  test('what was logged comes back after a reload, with nothing picked', () => {
    const logs = [log(bench.id, bench), log(bench.id, bench), log(plank.id, plank)]
    expect(exercisesInSession(logs, [])).toEqual([bench, plank])
  })

  test('then anything picked since, once each', () => {
    const squat = { id: crypto.randomUUID(), name: 'Squat', tracking: 'weight_reps' as const }
    expect(exercisesInSession([log(bench.id, bench)], [bench, squat])).toEqual([bench, squat])
  })

  test('an exercise the caller can no longer see gets no logger', () => {
    expect(exercisesInSession([log(bench.id, null)], [])).toEqual([])
  })
})
