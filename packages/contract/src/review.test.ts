import { describe, expect, test } from 'bun:test'
import { driftLine, fallingLine, muscleRows, stallLine } from './review.ts'

/** The review, as the Progress tab says it (#28). */

const bench = { name: 'Bench', tracking: 'weight_reps' as const }
const set = { reps: 5, weightG: 80_000, durationS: null, distanceMm: null }

describe('work per muscle', () => {
  test('is named, counted in sets, compared, and drawn against the most worked', () => {
    const { top, declined } = muscleRows({
      top: [
        { muscle: 'quadriceps', weightedSets: 12, liftedG: 0, changePct: 20, declined: false },
        { muscle: 'hamstrings', weightedSets: 3, liftedG: 0, changePct: -60, declined: true },
      ],
      declined: [
        {
          muscle: 'latissimus_dorsi',
          weightedSets: 1,
          liftedG: 0,
          changePct: null,
          declined: false,
        },
      ],
      omitted: 0,
    })
    expect(top.map((m) => [m.name, m.sets, m.change, m.share, m.declined])).toEqual([
      ['Quads', '12 sets', '+20%', 1, false],
      // A declined muscle among the most worked is said to be, there too.
      ['Hamstrings', '3 sets', '−60%', 0.25, true],
    ])
    expect(declined.map((m) => [m.name, m.sets, m.change])).toEqual([['Lats', '1 set', 'new']])
  })
})

describe('what needs attention', () => {
  test('says the set that stalled, the max that fell, and the reserve that shrank', () => {
    expect(
      stallLine({ exercise: bench, sessions: 4, effort: { ...set, reserve: null } }, 'kg'),
    ).toBe('4 sessions at 5 × 80 kg')
    expect(fallingLine({ exercise: bench, sessions: 2, fromG: 77_000, toG: 70_000 }, 'kg')).toBe(
      'Estimated max 77 kg → 70 kg, 2 sessions running',
    )
    expect(driftLine({ exercise: bench, effort: set, fromReserve: 3, toReserve: 1.3 }, 'kg')).toBe(
      '5 × 80 kg: 3 → 1.3 in reserve',
    )
  })
})
