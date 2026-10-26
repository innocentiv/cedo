import { describe, expect, test } from 'bun:test'
import {
  byExercise,
  notesToKeep,
  type SeriesMember,
  type SetLog,
  SetLogUpdate,
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

  test('after undoing the last set, the next takes its number, as a correction would', () => {
    expect(nextSetIndex(logged(heavy, 0, 1), heavy)).toBe(2)
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
    personalBest: false,
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

  test('a set logged against a plan entry is the entry’s, not something added (#24)', () => {
    expect(
      exercisesInSession([{ ...log(bench.id, bench), entryId: crypto.randomUUID() }], []),
    ).toEqual([])
  })

  test('an exercise the caller can no longer see gets no logger', () => {
    expect(exercisesInSession([log(bench.id, null)], [])).toEqual([])
  })
})

describe('a session read back by exercise (#25)', () => {
  test('lists each exercise once, in the order first done, its sets in order', () => {
    const log = (id: string, exerciseId: string) => ({ id, exerciseId })
    const logs = [log('1', 'squat'), log('2', 'row'), log('3', 'squat'), log('4', 'row')]
    expect(byExercise(logs).map((sets) => sets.map((s) => s.id))).toEqual([
      ['1', '3'],
      ['2', '4'],
    ])
  })
})

describe("a session's notes, as typed (#25)", () => {
  test('are kept trimmed, nothing but space as none, and not sent again unchanged', () => {
    expect(notesToKeep('  Felt strong ', null)).toBe('Felt strong')
    expect(notesToKeep('   ', 'Old')).toBeNull()
    expect(notesToKeep('Same', 'Same')).toBeUndefined()
    expect(notesToKeep('', null)).toBeUndefined()
  })
})

describe('a set corrected (#31)', () => {
  test('replaces only what it names: a field left out is not reset to its default', () => {
    expect(SetLogUpdate.parse({ reps: 6 })).toEqual({ reps: 6 })
    expect(SetLogUpdate.parse({ weightG: null, isWarmup: true })).toEqual({
      weightG: null,
      isWarmup: true,
    })
  })

  test('never moves a set to another exercise, or another series', () => {
    expect(SetLogUpdate.safeParse({ exerciseId: crypto.randomUUID() }).success).toBe(false)
    expect(SetLogUpdate.safeParse({ entryId: null }).success).toBe(false)
  })
})
