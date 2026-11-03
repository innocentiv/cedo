import { describe, expect, test } from 'bun:test'
import { type AthleteEquipment, type Progression, loadOf } from '@cedo/contract'
import { type EntryToEvaluate, type LoggedSet, type PrescribedSet, suggest } from './evaluate.ts'

/**
 * The wiring around `progress`, without a database: which sets count, what the prescription is,
 * which sessions are read and in what order. The maths itself is tested in the contract.
 */

const LINEAR: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }

const entry = (progression: Progression, id = 'bench'): EntryToEvaluate => ({
  id,
  exerciseId: `${id}-exercise`,
  exerciseName: 'Bench Press',
  tracking: 'weight_reps',
  equipment: ['barbell', 'rack', 'flat_bench'],
  progression,
})

/** Someone who has not said what they train with: nothing is snapped (#36). */
const UNDESCRIBED: AthleteEquipment = { described: false, items: [] }

const suggestFor = (
  entries: readonly EntryToEvaluate[],
  sets: readonly PrescribedSet[],
  logs: readonly LoggedSet[],
  held: AthleteEquipment = UNDESCRIBED,
) => suggest(entries, sets, logs, (exercise) => loadOf(exercise, held, 'kg'))

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
  rpe: null,
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
    const [suggestion] = suggestFor(
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

  /**
   * The FIRST working set, not any of them — what the plan editor shows as the prescription. Every
   * working set shares one prescription when saved through the editor; the rows need not.
   */
  test('the prescription is the first working set, when the working sets differ', () => {
    const [suggestion] = suggestFor(
      [entry({ kind: 'none' })],
      [prescribed(20_000, 5, true), prescribed(60_000, 8), prescribed(70_000, 6)],
      [],
    )
    expect(suggestion?.current).toMatchObject({ weightG: 60_000, reps: 8 })
  })

  /** A logged RPE reaches the rule (#45), and the suggestion says what held it. */
  test('a session ground out past the prescribed RPE holds, for effort', () => {
    const plan = threeWorkingAt60.map((s) => ({ ...s, targetRpe: 8 }))
    const ground = [1, 2, 3].map(() => logged('monday', 60_000, 8, { rpe: 10 }))
    const [suggestion] = suggestFor([entry(LINEAR)], plan, ground)
    expect(suggestion?.changed).toBe(false)
    expect(suggestion?.held).toEqual({ reason: 'effort', rpe: 10 })

    const [missed] = suggestFor([entry(LINEAR)], plan, [logged('monday', 60_000, 8)])
    expect(missed?.held).toEqual({ reason: 'targets' })
  })

  /**
   * Each working set's own RPE reaches the rule (ADR-0026): a plan whose last set may go to failure
   * was judged against set 1's, and held for effort every session.
   */
  test('a ramp to failure done as prescribed advances', () => {
    const plan = threeWorkingAt60.map((s, i) => ({ ...s, targetRpe: [8, 9, 10][i] ?? null }))
    const ramp = [8, 9, 10].map((rpe) => logged('monday', 60_000, 8, { rpe }))
    const [suggestion] = suggestFor([entry(LINEAR)], plan, ramp)
    expect(suggestion?.held).toBeNull()
    expect(suggestion?.suggested).toMatchObject({ weightG: 62_500, reps: 8 })
  })

  /** The loader sends sessions newest first; the evaluator must keep them in that order. */
  test('the session that arrives first is read as the most recent', () => {
    const missedToday = [1, 2, 3].map(() => logged('today', 60_000, 6))
    const clearedLastWeek = [1, 2, 3].map(() => logged('last-week', 60_000, 8))
    const [suggestion] = suggestFor([entry(LINEAR)], threeWorkingAt60, [
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
    const [suggestion] = suggestFor([entry(LINEAR)], threeWorkingAt60, [
      ...cleared(null),
      ...cleared('squat'),
    ])
    expect(suggestion?.sessionsConsidered).toBe(0)
    expect(suggestion?.changed).toBe(false)
  })

  test('one suggestion per entry, in the order the entries arrive', () => {
    const suggestions = suggestFor(
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

/** What the athlete can load (#36): judged against, and answered in, the weights they have. */
describe('against the weights an athlete can load', () => {
  test('22 kg logged on a 22.5 kg plan meets it on 2 kg dumbbells, and 24 is next', () => {
    const press = { ...entry(LINEAR), equipment: ['dumbbells' as const] }
    const plan = [prescribed(22_500, 8), prescribed(22_500, 8), prescribed(22_500, 8)]
    const monday = [
      logged('monday', 22_000, 8),
      logged('monday', 22_000, 8),
      logged('monday', 22_000, 8),
    ]
    const dumbbells: AthleteEquipment = {
      described: true,
      items: [{ slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: 30_000 } }],
    }

    const [mine] = suggestFor([press], plan, monday, dumbbells)
    expect(mine?.suggested.weightG).toBe(24_000)
    expect(mine?.changed).toBe(true)
    // The plan keeps what it says.
    expect(mine?.current.weightG).toBe(22_500)

    // Without the dumbbells' weights known, 22 is short of 22.5, as it always was.
    const [unknown] = suggestFor([press], plan, monday)
    expect(unknown?.suggested.weightG).toBe(22_500)
    expect(unknown?.changed).toBe(false)
  })
})
