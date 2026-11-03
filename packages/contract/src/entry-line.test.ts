import { describe, expect, test } from 'bun:test'
import { entryLine } from './entry-line.ts'
import type { Progression, SetTarget } from './progression.ts'

const at = (reps: number, kg: number, reserve: number | null = null): SetTarget => ({
  reps,
  weightG: kg * 1000,
  reserve,
  durationS: null,
  distanceMm: null,
})
const working = (...targets: SetTarget[]) => targets.map((target) => ({ isWarmup: false, target }))
const warmup = (target: SetTarget) => ({ isWarmup: true, target })

const DOUBLE: Progression = { kind: 'double', repRange: [8, 12], incrementG: 5000 }
const MANUAL: Progression = { kind: 'none' }

/**
 * An entry as its outline line says it (docs/08-frontend.md, "Editing a workout"): its working sets,
 * the rule, and the viewer's own target only where it differs from the plan (ADR-0026).
 */
describe('entryLine', () => {
  test('under a rule: the sets, what they ask, and the rule in full', () => {
    const sets = [warmup(at(5, 10)), ...working(at(10, 20), at(10, 20), at(10, 20))]
    expect(entryLine(sets, DOUBLE, 'weight_reps', 'kg', null)).toBe(
      '3 sets · 10 × 20 kg · Double 8–12, +5 kg',
    )
  })

  test('the target after it, only when it differs from the plan', () => {
    const sets = working(at(10, 20), at(10, 20), at(10, 20))
    expect(entryLine(sets, DOUBLE, 'weight_reps', 'kg', at(12, 40))).toBe(
      '3 sets · 10 × 20 kg · Double 8–12, +5 kg · next 12 × 40 kg',
    )
    expect(entryLine(sets, DOUBLE, 'weight_reps', 'kg', at(10, 20))).toBe(
      '3 sets · 10 × 20 kg · Double 8–12, +5 kg',
    )
  })

  test('reps in reserve neither split a run nor make a target differ', () => {
    const ramp = working(at(10, 20, 2), at(10, 20, 1), at(10, 20, 0))
    expect(entryLine(ramp, DOUBLE, 'weight_reps', 'kg', at(10, 20, 2))).toBe(
      '3 sets · 10 × 20 kg · Double 8–12, +5 kg',
    )
  })

  test('a manual entry whose sets differ says each run of equal sets', () => {
    const topAndBackOffs = working(at(6, 90), at(8, 80), at(8, 80))
    expect(entryLine(topAndBackOffs, MANUAL, 'weight_reps', 'kg', null)).toBe(
      '1 set 6 × 90 kg · 2 sets 8 × 80 kg · Manual',
    )
  })

  test('a manual entry says no target: its numbers are the plan’s', () => {
    const sets = working(at(8, 60), at(8, 60))
    expect(entryLine(sets, MANUAL, 'weight_reps', 'kg', at(9, 60))).toBe(
      '2 sets · 8 × 60 kg · Manual',
    )
  })

  test('an entry with no working set says so', () => {
    expect(entryLine([warmup(at(5, 10))], MANUAL, 'weight_reps', 'kg', null)).toBe(
      'no working sets · Manual',
    )
  })
})
