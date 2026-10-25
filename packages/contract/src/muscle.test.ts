import { describe, expect, test } from 'bun:test'
import { MUSCLES, MUSCLE_REGIONS, MUSCLE_REGION_LABELS, mainMuscles } from './muscle.ts'

describe("an exercise's main muscles (#27)", () => {
  test('are its most loaded, most first, three at most', () => {
    expect(
      mainMuscles([
        { muscle: 'hamstrings', loadPct: 5 },
        { muscle: 'quadriceps', loadPct: 45 },
        { muscle: 'gluteus_maximus', loadPct: 30 },
        { muscle: 'adductors', loadPct: 20 },
      ]),
    ).toBe('Quads, Glute max, Adductors')
  })
})

describe('the muscle regions', () => {
  test('each has a name, and every muscle is in one', () => {
    for (const region of MUSCLE_REGIONS) expect(MUSCLE_REGION_LABELS[region]).not.toBe('')
    for (const muscle of MUSCLES) expect(MUSCLE_REGIONS).toContain(muscle.region)
  })
})
