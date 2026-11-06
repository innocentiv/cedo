import { describe, expect, test } from 'bun:test'
import type { SetTarget } from './progression.ts'
import { type EntryTarget, targetLine } from './entry-target.ts'

const at = (weightG: number, reserve: number | null = 2): SetTarget => ({
  reps: 8,
  weightG,
  reserve,
  durationS: null,
  distanceMm: null,
})

const asked = (more: Partial<EntryTarget>): EntryTarget => ({
  entryId: 'bench',
  exerciseId: 'bench-exercise',
  exerciseName: 'Bench Press',
  tracking: 'weight_reps',
  rule: { kind: 'linear', incrementG: 2500, afterSuccesses: 1 },
  prescribed: at(60_000),
  target: at(60_000),
  changed: false,
  held: null,
  limit: null,
  sessions: 0,
  warmups: [],
  working: [],
  ...more,
})

/**
 * What the logger says beside an entry's target (docs/08-frontend.md, the workout screen): moved by
 * the rule, beside what the plan says, and why the latest session held it — per set, in the words
 * `workout_progression` says. No reps in reserve: each set asks its own, said above it.
 */
describe('targetLine', () => {
  const reps = (n: number): SetTarget => ({ ...at(60_000), reps: n })

  test('as prescribed', () => {
    expect(targetLine(asked({}), 'kg')).toBe('Prescribed 8 × 60 kg')
  })

  test('moved by the rule, beside what the plan says', () => {
    expect(targetLine(asked({ target: at(62_500), changed: true }), 'kg')).toBe(
      'Progressed to 8 × 62.5 kg · the plan says 8 × 60 kg',
    )
  })

  test('held short of the target: the set, what it did, of what it was asked', () => {
    const held = asked({ held: { reason: 'targets', set: 3, did: reps(7), asked: reps(8) } })
    expect(targetLine(held, 'kg')).toBe('Prescribed 8 × 60 kg · held: set 3 did 7 of 8')
  })

  /** #45: a hold for effort is not a stall — the reps were there, done harder than asked. */
  test('held for effort: the set, what it left, and what it asked', () => {
    const held = asked({ held: { reason: 'effort', set: 3, reserve: 0, asked: 2 } })
    expect(targetLine(held, 'kg')).toBe(
      'Prescribed 8 × 60 kg · held for effort: set 3 left 0 in reserve, asked 2',
    )
  })

  test('moved earlier, and held by the latest session', () => {
    const held = asked({
      target: reps(10),
      changed: true,
      held: { reason: 'targets', set: 1, did: reps(9), asked: reps(10) },
    })
    expect(targetLine(held, 'kg')).toBe(
      'Progressed to 10 × 60 kg · the plan says 8 × 60 kg · held: set 1 did 9 of 10',
    )
  })

  /** On Manual each set asks its own: the line says the one being logged, not set 1's. */
  test('as prescribed, of the set it is said for', () => {
    const set = { isWarmup: false, target: at(80_000) }
    expect(targetLine(asked({}), 'kg', set)).toBe('Prescribed 8 × 80 kg')
  })

  /** A warm-up is never judged: the line says the entry's target, and why it held, not its own. */
  test('on a warm-up, the entry’s target — not the warm-up’s numbers beside a working set’s hold', () => {
    const held = asked({ held: { reason: 'effort', set: 3, reserve: 0, asked: 2 } })
    const warmup = { isWarmup: true, target: at(30_000) }
    expect(targetLine(held, 'kg', warmup)).toBe(
      'Prescribed 8 × 60 kg · held for effort: set 3 left 0 in reserve, asked 2',
    )
  })

  test("where the athlete's equipment stopped it", () => {
    const line = targetLine(asked({ target: at(24_000), limit: 'heaviest' }), 'kg')
    expect(line).toStartWith('Prescribed 8 × 24 kg · ')
  })
})
