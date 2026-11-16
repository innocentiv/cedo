import { describe, expect, test } from 'bun:test'
import { SetLog, SetLogUpdate, byExercise, exercisesInSession, notesToKeep } from './log.ts'

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
    reserve: null,
    durationS: null,
    distanceMm: null,
    isWarmup: false,
    loggedAt: new Date().toISOString(),
    personalBest: false,
    idempotencyKey: null,
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

/** The app can be newer than its server (ADR-0032): a set from one that says no key reads as none. */
test('a set from a server that says no key reads as sent without one', () => {
  const said = {
    id: crypto.randomUUID(),
    entryId: null,
    exerciseId: crypto.randomUUID(),
    exercise: null,
    setIndex: 0,
    weightG: null,
    reps: 8,
    reserve: null,
    durationS: null,
    distanceMm: null,
    isWarmup: false,
    loggedAt: new Date().toISOString(),
    personalBest: false,
  }
  expect(SetLog.parse(said).idempotencyKey).toBeNull()
})
