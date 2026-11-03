import { describe, expect, test } from 'bun:test'
import type { Progression } from './progression.ts'
import { describeProgression } from './progression-words.ts'
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
