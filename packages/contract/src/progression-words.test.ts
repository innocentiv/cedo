import { describe, expect, test } from 'bun:test'
import type { Held, Progression, SetTarget } from './progression.ts'
import { describeProgression, heldWords, ruleSentence } from './progression-words.ts'
import { formatWeight, kgToG } from './units.ts'

const LINEAR: Progression = { kind: 'linear', incrementG: kgToG(2.5), afterSuccesses: 1 }

/** The rule as the editor and the MCP tool both say it — a streak said wherever a rule has one. */
describe('describeProgression', () => {
  const kg = (g: number) => formatWeight(g, 'kg')

  test.each<[Progression, string]>([
    [{ kind: 'none' }, 'Manual'],
    [LINEAR, 'Linear, +2.5 kg'],
    [{ ...LINEAR, afterSuccesses: 2 }, 'Linear, +2.5 kg after 2 cleared sessions'],
    [
      { kind: 'linear_duration', incrementS: 15, afterSuccesses: 3 },
      'Linear, +0:15 after 3 cleared sessions',
    ],
    [
      { kind: 'linear_distance', incrementMm: 500_000, afterSuccesses: 1 },
      'Distance, +500 m at the same pace',
    ],
    [
      { kind: 'linear_distance', incrementMm: 1_000_000, afterSuccesses: 2 },
      'Distance, +1 km at the same pace after 2 cleared sessions',
    ],
  ])('%o reads %p', (rule, said) => {
    expect(describeProgression(rule, kg)).toBe(said)
  })

  /** Read back from JSONB, a kind no version of this code knows is reachable — and said loudly. */
  test('an unknown kind throws, rather than describing nothing', () => {
    // As a row edited by hand reads back: a rule whose kind the type system never saw.
    const unknown: Progression = { kind: 'none' }
    Reflect.set(unknown, 'kind', 'percentage')
    expect(() => describeProgression(unknown, kg)).toThrow('Unhandled progression kind')
  })
})

const effort = (fields: Partial<SetTarget>): SetTarget => ({
  reps: null,
  weightG: null,
  reserve: null,
  durationS: null,
  distanceMm: null,
  ...fields,
})

/**
 * Why a step held, per set (ADR-0026) — the words `workout_progression` says and the logger says
 * beside the target, so the AI and the athlete read a hold alike.
 */
describe('heldWords', () => {
  const short = (set: number, did: SetTarget | null, asked: SetTarget): Held => ({
    reason: 'targets',
    set,
    did,
    asked,
  })

  test('short of the reps alone: the reps it did, of those asked', () => {
    const held = short(
      3,
      effort({ reps: 7, weightG: 55_000, reserve: 2 }),
      effort({ reps: 10, weightG: 55_000, reserve: 2 }),
    )
    expect(heldWords(held, 'weight_reps', 'kg')).toBe('held: set 3 did 7 of 10')
  })

  test('short of anything else: what it did, of what it was asked, in full', () => {
    const lighter = short(
      2,
      effort({ reps: 8, weightG: 50_000 }),
      effort({ reps: 8, weightG: 55_000 }),
    )
    expect(heldWords(lighter, 'weight_reps', 'kg')).toBe('held: set 2 did 8 × 50 kg of 8 × 55 kg')
    const plank = short(1, effort({ durationS: 45 }), effort({ durationS: 60 }))
    expect(heldWords(plank, 'duration', 'kg')).toBe('held: set 1 did 0:45 of 1:00')
  })

  test('a set not done says so', () => {
    expect(heldWords(short(3, null, effort({ reps: 10 })), 'weight_reps', 'kg')).toBe(
      'held: set 3 not done',
    )
  })

  test('ground out past its reserve: what it left, and what it asked', () => {
    const held: Held = { reason: 'effort', set: 3, reserve: 0, asked: 2 }
    expect(heldWords(held, 'weight_reps', 'kg')).toBe(
      'held for effort: set 3 left 0 in reserve, asked 2',
    )
  })
})

/**
 * What a rule does, as one plain sentence under the rule in the entry editor (docs/08-frontend.md,
 * "An entry's settings") — so a person reads what picking it means, not only its name.
 */
describe('ruleSentence', () => {
  const kg = (g: number) => formatWeight(g, 'kg')

  test.each<[Progression, string]>([
    [{ kind: 'none' }, 'Nothing moves these numbers but an edit to the plan.'],
    [
      { kind: 'double', repRange: [8, 12], incrementG: kgToG(5) },
      'Climb from 8 to 12 reps at the same weight. When every working set reaches 12, add 5 kg and start again at 8.',
    ],
    [
      LINEAR,
      'Add 2.5 kg when every working set makes its reps, leaving the reps in reserve it asks.',
    ],
    [
      { ...LINEAR, afterSuccesses: 2 },
      'Add 2.5 kg when every working set makes its reps, leaving the reps in reserve it asks, 2 sessions running.',
    ],
    [
      { kind: 'linear_duration', incrementS: 15, afterSuccesses: 1 },
      'Add 0:15 when every working set lasts its time.',
    ],
    [
      { kind: 'linear_distance', incrementMm: 500_000, afterSuccesses: 3 },
      'Go 500 m further at the same pace when every working set covers its distance in its time, 3 sessions running.',
    ],
  ])('%o', (rule, sentence) => {
    expect(ruleSentence(rule, kg)).toBe(sentence)
  })
})
