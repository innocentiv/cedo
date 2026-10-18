import { describe, expect, test } from 'bun:test'
import { type SetLog, exercisesInSession, nextSetIndex } from './log.ts'

const logged = (...indices: number[]) => indices.map((setIndex) => ({ setIndex }))

describe('nextSetIndex', () => {
  test('starts at zero', () => {
    expect(nextSetIndex([])).toBe(0)
  })

  test('follows the sets logged so far', () => {
    expect(nextSetIndex(logged(0, 1, 2))).toBe(3)
  })

  test('after an undo in the middle, does not reuse an index still taken', () => {
    // Sets 1-3 logged, set 2 undone: a count says 2, which set 3 already holds.
    expect(nextSetIndex(logged(0, 2))).toBe(3)
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
