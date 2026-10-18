import { describe, expect, test } from 'bun:test'
import type { Progression } from '@cedo/contract'
import { type EntryToEvaluate, type LoggedSet, type PrescribedSet, suggest } from './evaluate.ts'

/**
 * The wiring around `nextTarget`, without a database: which sets count, what the prescription is,
 * which sessions are read and in what order. The maths itself is tested in the contract.
 */

const LINEAR: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }

const entry = (progression: Progression, id = 'bench'): EntryToEvaluate => ({
  id,
  exerciseId: `${id}-exercise`,
  exerciseName: 'Bench Press',
  tracking: 'weight_reps',
  progression,
})

const prescribed = (weightG: number, reps: number, isWarmup = false): PrescribedSet => ({
  entryId: 'bench',
  targetReps: reps,
  targetWeightG: weightG,
  targetRpe: null,
  targetDurationS: null,
  targetDistanceMm: null,
  isWarmup,
})

const logged = (
  sessionId: string,
  weightG: number,
  reps: number,
  more: Partial<LoggedSet> = {},
): LoggedSet => ({
  entryId: 'bench',
  sessionId,
  weightG,
  reps,
  durationS: null,
  distanceMm: null,
  isWarmup: false,
  ...more,
})

const threeWorkingAt60 = [prescribed(60_000, 8), prescribed(60_000, 8), prescribed(60_000, 8)]

describe('suggesting the next prescription', () => {
  /**
   * A warm-up is neither the prescription nor a working set, in the plan or in the log. Read as
   * the prescription, the target would be the 20 kg ramp; counted as a working set, a session with
   * every working set done would read as one set short, and never advance.
   */
  test('warm-ups count for nothing, prescribed or logged', () => {
    const [suggestion] = suggest(
      [entry(LINEAR)],
      [prescribed(20_000, 5, true), ...threeWorkingAt60],
      [
        logged('monday', 20_000, 3, { isWarmup: true }),
        logged('monday', 60_000, 8),
        logged('monday', 60_000, 8),
        logged('monday', 60_000, 8),
      ],
    )
    expect(suggestion?.current).toMatchObject({ weightG: 60_000, reps: 8 })
    expect(suggestion?.suggested).toMatchObject({ weightG: 62_500, reps: 8 })
    expect(suggestion?.changed).toBe(true)
    expect(suggestion?.sessionsConsidered).toBe(1)
  })

  /** The loader sends sessions newest first; the evaluator must keep them in that order. */
  test('the session that arrives first is read as the most recent', () => {
    const missedToday = [1, 2, 3].map(() => logged('today', 60_000, 6))
    const clearedLastWeek = [1, 2, 3].map(() => logged('last-week', 60_000, 8))
    const [suggestion] = suggest([entry(LINEAR)], threeWorkingAt60, [
      ...missedToday,
      ...clearedLastWeek,
    ])
    expect(suggestion?.changed).toBe(false)
    expect(suggestion?.sessionsConsidered).toBe(2)
  })

  /** Progression reads logs by entry: an ad-hoc set, or another entry's, is not this one's history. */
  test('reads only the logs of its own entry', () => {
    const cleared = (entryId: string | null) =>
      [1, 2, 3].map(() => logged('elsewhere', 60_000, 8, { entryId }))
    const [suggestion] = suggest([entry(LINEAR)], threeWorkingAt60, [
      ...cleared(null),
      ...cleared('squat'),
    ])
    expect(suggestion?.sessionsConsidered).toBe(0)
    expect(suggestion?.changed).toBe(false)
  })

  test('one suggestion per entry, in the order the entries arrive', () => {
    const suggestions = suggest(
      [entry({ kind: 'none' }, 'squat'), entry({ kind: 'none' }, 'bench')],
      threeWorkingAt60,
      [],
    )
    expect(suggestions.map((s) => s.entryId)).toEqual(['squat', 'bench'])
    // The squat has no prescribed set here: it prescribes nothing, and holds at nothing.
    expect(suggestions[0]?.current).toEqual({
      reps: null,
      weightG: null,
      rpe: null,
      durationS: null,
      distanceMm: null,
    })
    expect(suggestions.every((s) => !s.changed)).toBe(true)
  })
})
