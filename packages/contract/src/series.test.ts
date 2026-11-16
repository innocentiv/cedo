import { describe, expect, test } from 'bun:test'
import { type SeriesMember, nextSetIndex, workingSetsDone } from './series.ts'

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
