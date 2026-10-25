import { describe, expect, test } from 'bun:test'
import type { SetTarget } from './progression.ts'
import {
  type FlowEntry,
  type FlowLog,
  focusOf,
  nextSet,
  restingAfter,
  setsOf,
} from './session-flow.ts'

/** The workout screen's flow (#24): which set is next, where the focus goes, whose rest runs. */

const target = (reps: number, kg: number): SetTarget => ({
  reps,
  weightG: kg * 1000,
  rpe: null,
  durationS: null,
  distanceMm: null,
})

const entry = (
  id: string,
  index: number,
  sets: { warmups?: number; working: number },
  supersetGroup: string | null = null,
): FlowEntry => ({
  id,
  index,
  supersetGroup,
  exercise: {},
  sets: [
    ...Array.from({ length: sets.warmups ?? 0 }, (_, i) => ({
      index: i,
      isWarmup: true,
      target: target(5, 20 + i * 20),
    })),
    ...Array.from({ length: sets.working }, (_, i) => ({
      index: (sets.warmups ?? 0) + i,
      isWarmup: false,
      target: target(5, 100),
    })),
  ],
})

let clock = Date.parse('2026-10-25T18:00:00Z')
const log = (entryId: string | null, isWarmup = false): FlowLog => {
  clock += 60_000
  return {
    id: crypto.randomUUID(),
    entryId,
    isWarmup,
    loggedAt: new Date(clock).toISOString(),
    reps: 5,
    weightG: 100_000,
    durationS: null,
    distanceMm: null,
  }
}

describe("an entry's sets", () => {
  const squat = entry('squat', 0, { warmups: 2, working: 3 })

  test('warm-ups first, each with its own target; working sets ask what the session asks', () => {
    const sets = setsOf(squat, [], target(5, 102.5))
    expect(sets.map((s) => [s.key, s.isWarmup, s.target.weightG])).toEqual([
      ['w0', true, 20_000],
      ['w1', true, 40_000],
      ['s0', false, 102_500],
      ['s1', false, 102_500],
      ['s2', false, 102_500],
    ])
  })

  test('the nth warm-up logged is the nth warm-up, the nth working set the nth working set', () => {
    const [warm, work, other] = [log('squat', true), log('squat'), log('other')]
    const sets = setsOf(squat, [warm, work, other], null)
    expect(sets.map((s) => s.log?.id ?? null)).toEqual([warm.id, null, work.id, null, null])
    // A warm-up skipped is still the next set: warm-ups come first.
    expect(nextSet(sets)?.key).toBe('w1')
  })

  test('working sets logged beyond the prescription follow as extra; none is then next', () => {
    const logs = [
      log('squat', true),
      log('squat', true),
      log('squat'),
      log('squat'),
      log('squat'),
      log('squat'),
    ]
    const sets = setsOf(squat, logs, null)
    expect(sets.at(-1)).toMatchObject({ key: 'x0', extra: true })
    expect(nextSet(sets)).toBeNull()
  })
})

describe('where the focus goes', () => {
  const day = {
    entries: [
      entry('squat', 0, { working: 2 }),
      entry('rdl', 1, { working: 1 }),
      entry('pull', 2, { working: 2 }, 'A'),
      entry('raise', 3, { working: 2 }, 'A'),
    ],
  }

  test('to the first entry with sets left, before anything is logged', () => {
    expect(focusOf(day, [])?.id).toBe('squat')
  })

  test('stays on an entry while it has sets left, then moves to the first still open', () => {
    expect(focusOf(day, [log('squat')])?.id).toBe('squat')
    expect(focusOf(day, [log('squat'), log('squat')])?.id).toBe('rdl')
  })

  test('back up the day to an entry skipped, once the one after it is done', () => {
    expect(focusOf(day, [log('rdl')])?.id).toBe('squat')
  })

  test('alternates the entries of a superset, and round again', () => {
    const before = [log('squat'), log('squat'), log('rdl')]
    const a1 = [...before, log('pull')]
    expect(focusOf(day, a1)?.id).toBe('raise')
    const a2 = [...a1, log('raise')]
    expect(focusOf(day, a2)?.id).toBe('pull')
  })

  test('none once every prescribed set is logged', () => {
    const all = ['squat', 'squat', 'rdl', 'pull', 'raise', 'pull', 'raise'].map((id) => log(id))
    expect(focusOf(day, all)).toBeNull()
  })

  test('never to an exercise the reader cannot see', () => {
    const hidden = {
      entries: [
        { ...entry('gone', 0, { working: 1 }), exercise: null },
        entry('next', 1, { working: 1 }),
      ],
    }
    expect(focusOf(hidden, [])?.id).toBe('next')
  })
})

describe('whose rest runs', () => {
  const day = {
    entries: [
      entry('squat', 0, { warmups: 1, working: 2 }),
      entry('pull', 1, { working: 2 }, 'A'),
      entry('raise', 2, { working: 2 }, 'A'),
    ],
  }

  test('none before a working set, nor after a warm-up', () => {
    expect(restingAfter(day, [])).toBeNull()
    expect(restingAfter(day, [log('squat', true)])).toBeNull()
  })

  test('the entry of the working set logged last', () => {
    expect(restingAfter(day, [log('squat', true), log('squat')])?.id).toBe('squat')
  })

  test('straight on within a superset round; the rest comes after its last entry', () => {
    const squat = [log('squat', true), log('squat'), log('squat')]
    expect(restingAfter(day, [...squat, log('pull')])).toBeNull()
    expect(restingAfter(day, [...squat, log('pull'), log('raise')])?.id).toBe('raise')
  })
})
