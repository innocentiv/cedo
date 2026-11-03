import { describe, expect, test } from 'bun:test'
import type { SetTarget } from './progression.ts'
import { type EntryTarget, targetLine } from './session-target.ts'

const at = (weightG: number, reserve: number | null = 2): SetTarget => ({
  reps: 8,
  weightG,
  reserve,
  durationS: null,
  distanceMm: null,
})

const asked = (more: Partial<EntryTarget>): EntryTarget => ({
  entryId: 'bench',
  prescribed: at(60_000),
  target: at(60_000),
  changed: false,
  held: null,
  limit: null,
  last: null,
  warmups: [],
  ...more,
})

/** What the logger says beside an entry's target — moved, held for effort, or as prescribed. */
describe('targetLine', () => {
  test('as prescribed, with the reserve it asks', () => {
    expect(targetLine(asked({}), 'weight_reps', 'kg')).toBe('Prescribed 8 × 60 kg · 2 in reserve')
  })

  test('moved by the rule, beside what the plan says', () => {
    expect(targetLine(asked({ target: at(62_500), changed: true }), 'weight_reps', 'kg')).toBe(
      'Progressed to 8 × 62.5 kg · 2 in reserve · the plan says 8 × 60 kg',
    )
  })

  /** #45: the one reason a prescription held that is nowhere else on the screen. */
  test('held for effort, with the reserve a set left', () => {
    const held = asked({ held: { reason: 'effort', set: 3, reserve: 0, asked: 2 } })
    expect(targetLine(held, 'weight_reps', 'kg')).toBe(
      'Held at 8 × 60 kg · 2 in reserve · a recent set left 0 in reserve',
    )
  })

  test('short of the targets reads as prescribed: last time, beside it, shows the miss', () => {
    const held = asked({ held: { reason: 'targets', set: 3, did: at(60_000), asked: at(60_000) } })
    expect(targetLine(held, 'weight_reps', 'kg')).toBe('Prescribed 8 × 60 kg · 2 in reserve')
  })

  test("where the athlete's equipment stopped it", () => {
    const line = targetLine(asked({ target: at(24_000), limit: 'heaviest' }), 'weight_reps', 'kg')
    expect(line).toStartWith('Prescribed 8 × 24 kg · 2 in reserve · ')
  })
})
