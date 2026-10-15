import { describe, expect, test } from 'bun:test'
import { nextSetIndex } from './log.ts'

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
