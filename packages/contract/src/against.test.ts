import { describe, expect, test } from 'bun:test'
import { againstOf, stillCounts } from './against.ts'
import type { Progression } from './progression.ts'

/**
 * What a step was taken against, and whether it still counts (ADR-0026): resets are derived, never
 * written — a step counts while what its rule moves or judges, each working set's reserve, and the
 * rule with its settings stand as they were.
 */
const DOUBLE: Progression = { kind: 'double', repRange: [8, 12], incrementG: 2500 }
const set = (more: Record<string, number | null> = {}) => ({
  targetReps: 8,
  targetWeightG: 55_000,
  targetReserve: 2,
  targetDurationS: null,
  targetDistanceMm: null,
  ...more,
})
const three = [set(), set(), set({ targetReserve: 0 })]

describe('a step still counts', () => {
  test('while the plan is as it was', () => {
    expect(stillCounts(againstOf(DOUBLE, three), againstOf(DOUBLE, three))).toBe(true)
  })

  test('not once what the rule moves or judges has changed — and again once it is put back', () => {
    const typo = [
      set({ targetWeightG: 5_000 }),
      set({ targetWeightG: 5_000 }),
      set({ targetWeightG: 5_000 }),
    ]
    const taken = againstOf(DOUBLE, three)
    expect(stillCounts(taken, againstOf(DOUBLE, typo))).toBe(false)
    expect(stillCounts(taken, againstOf(DOUBLE, three))).toBe(true)
  })

  test('not once a working set asks another reserve', () => {
    const eased = [set(), set(), set({ targetReserve: 1 })]
    expect(stillCounts(againstOf(DOUBLE, three), againstOf(DOUBLE, eased))).toBe(false)
  })

  test('not once the rule or its settings changed', () => {
    const wider: Progression = { ...DOUBLE, repRange: [8, 15] }
    const linear: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }
    expect(stillCounts(againstOf(DOUBLE, three), againstOf(wider, three))).toBe(false)
    expect(stillCounts(againstOf(DOUBLE, three), againstOf(linear, three))).toBe(false)
  })

  /** Adding a fourth set at 12 × 40 keeps your target (ADR-0026): the count is not compared. */
  test('when working sets are added or taken away', () => {
    const four = [...three, set({ targetReserve: 0 })]
    expect(stillCounts(againstOf(DOUBLE, three), againstOf(DOUBLE, four))).toBe(true)
    expect(stillCounts(againstOf(DOUBLE, three), againstOf(DOUBLE, three.slice(0, 2)))).toBe(true)
  })

  /** Read back from JSONB, a rule's keys may come in any order: the same rule is the same rule. */
  test('whatever order a stored rule keeps its settings in', () => {
    const stored: Progression = { incrementG: 2500, repRange: [8, 12], kind: 'double' }
    expect(stillCounts(againstOf(stored, three), againstOf(DOUBLE, three))).toBe(true)
  })
})
