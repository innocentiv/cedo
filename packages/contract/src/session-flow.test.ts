import { describe, expect, test } from 'bun:test'
import type { SetTarget } from './progression.ts'
import {
  type FlowEntry,
  type FlowLog,
  adHocSetsOf,
  focusOf,
  nextSet,
  restOf,
  restingAfter,
  sessionSummary,
  setsOf,
} from './session-flow.ts'
import {
  loggedLabel,
  loggedTitle,
  markOf,
  markedSets,
  nextSetWords,
  progressOf,
} from './set-marks.ts'

/** The workout screen's flow (#24): which set is next, where the focus goes, whose rest runs. */

const target = (reps: number, kg: number): SetTarget => ({
  reps,
  weightG: kg * 1000,
  reserve: null,
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

  /** On the athlete's equipment (#36): the plan's own targets, as they can be loaded. */
  test('the plan’s own targets asked as the athlete can load them; the session’s as sent', () => {
    const bar = { stepG: 5000, minG: 25_000, maxG: null, assisted: false, unit: 'kg' as const }
    const sets = setsOf(squat, [], null, bar)
    // A 20 kg warm-up under a 25 kg bar is the bar; 40 and 100 load as written.
    expect(sets.map((s) => s.target.weightG)).toEqual([25_000, 40_000, 100_000, 100_000, 100_000])
    expect(setsOf(squat, [], target(5, 102.5), bar).at(-1)?.target.weightG).toBe(102_500)
  })

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

describe("a session's summary", () => {
  const done = (isWarmup: boolean, personalBest: boolean) => ({ isWarmup, personalBest })

  test('how long it took, its working sets, and its personal bests', () => {
    const best = done(false, true)
    const logs = [done(true, false), done(false, false), best, done(false, false)]
    expect(
      sessionSummary({
        startedAt: '2026-10-25T18:00:00Z',
        endedAt: '2026-10-25T19:12:30Z',
        logs,
      }),
    ).toEqual({ durationS: 4350, workingSets: 3, personalBests: [best] })
  })

  test('no duration while in progress, and none below zero against a skewed clock', () => {
    expect(
      sessionSummary({ startedAt: '2026-10-25T18:00:00Z', endedAt: null, logs: [] }).durationS,
    ).toBeNull()
    expect(
      sessionSummary({
        startedAt: '2026-10-25T18:00:05Z',
        endedAt: '2026-10-25T18:00:00Z',
        logs: [],
      }).durationS,
    ).toBe(0)
  })
})

describe('how a set shows', () => {
  const squat = entry('squat', 0, { working: 3 })

  test('done, a personal best, waiting for a signal, next, to do', () => {
    const best = { ...log('squat'), personalBest: true }
    const plain = { ...log('squat'), personalBest: false }
    const sets = setsOf(squat, [plain, best], null)
    const next = nextSet(sets)
    expect(sets.map((s) => markOf(s, next, new Set()))).toEqual(['done', 'best', 'next'])
    expect(markOf(sets[0]!, next, new Set([plain.id]))).toBe('waiting')
    const fresh = setsOf(entry('rdl', 1, { working: 2 }), [], null)
    expect(fresh.map((s) => markOf(s, nextSet(fresh), new Set()))).toEqual(['next', 'todo'])
  })
})

describe('an exercise of a session without a plan', () => {
  test('its logged sets, then one more starting from the last', () => {
    const adHoc = (exerciseId: string) => ({ ...log(null), exerciseId, weightG: 60_000 })
    const [first, other, second] = [adHoc('curl'), adHoc('row'), adHoc('curl')]
    const logs = [first, other, second]
    const sets = adHocSetsOf('curl', logs)
    expect(sets.map((s) => s.log?.id ?? null)).toEqual([first.id, second.id, null])
    expect(nextSet(sets)?.target.weightG).toBe(60_000)
    expect(nextSet(adHocSetsOf('press', logs))?.target.weightG).toBeNull()
  })
})

describe('what the next set is called', () => {
  const squat = entry('squat', 0, { warmups: 2, working: 3 })

  test('a warm-up, a working set of the prescription, another beyond it', () => {
    const fresh = setsOf(squat, [], null)
    expect(nextSetWords(fresh, nextSet(fresh), true)).toEqual({
      title: 'Warm-up 1 of 2',
      action: 'Log warm-up',
    })
    const warmed = setsOf(squat, [log('squat', true), log('squat', true), log('squat')], null)
    expect(nextSetWords(warmed, nextSet(warmed), true)).toEqual({
      title: 'Set 2 of 3',
      action: 'Log set 2',
    })
    expect(nextSetWords(warmed, null, true)).toEqual({
      title: 'Another set',
      action: 'Log another set',
    })
  })

  test('without a plan, no "of"', () => {
    const sets = adHocSetsOf('curl', [{ ...log(null), exerciseId: 'curl' }])
    expect(nextSetWords(sets, nextSet(sets), false)).toEqual({
      title: 'Set 2',
      action: 'Log set 2',
    })
  })
})

describe('an entry at a glance', () => {
  test('each set marked and labelled — W, then its number — and how far along it is', () => {
    const squat = entry('squat', 0, { warmups: 1, working: 3 })
    const [warm, first] = [log('squat', true), log('squat')]
    const sets = setsOf(squat, [warm, first], null)
    expect(markedSets(sets, new Set([first.id])).map((m) => [m.label, m.mark])).toEqual([
      ['W', 'done'],
      ['1', 'waiting'],
      ['2', 'next'],
      ['3', 'todo'],
    ])
    expect(progressOf(sets)).toBe('1 of 3')
    expect(progressOf(sets, false)).toBe('1 done')
  })
})

describe('what a logged set is called', () => {
  test('a warm-up, or its number among the working sets of its series', () => {
    const series = (isWarmup: boolean, entryId: string) => ({
      id: crypto.randomUUID(),
      entryId,
      exerciseId: 'squat',
      isWarmup,
    })
    const logs = [
      series(true, 'a'),
      series(true, 'a'),
      series(false, 'a'),
      series(false, 'b'),
      series(false, 'a'),
    ]
    expect(logs.map((l) => loggedLabel(l, logs))).toEqual([
      'warm-up',
      'warm-up',
      'set 1',
      'set 1',
      'set 2',
    ])
    expect(logs.map((l) => loggedTitle(l, logs))).toEqual([
      'Warm-up',
      'Warm-up',
      'Set 1',
      'Set 1',
      'Set 2',
    ])
  })
})

describe('the rest running', () => {
  const withRest = (e: FlowEntry, restSeconds: number | null) => ({ ...e, restSeconds })
  const day = {
    entries: [
      withRest(entry('squat', 0, { warmups: 1, working: 2 }), 180),
      withRest(entry('pull', 1, { working: 2 }, 'A'), 60),
      withRest(entry('raise', 2, { working: 2 }, 'A'), 60),
    ],
  }

  test("the entry's rest, from its working set logged last; none after a warm-up", () => {
    const warm = log('squat', true)
    expect(restOf(day, [warm])).toBeNull()
    const squat = log('squat')
    expect(restOf(day, [warm, squat])).toEqual({ since: squat.loggedAt, seconds: 180 })
  })

  test('none within a superset round; after it, the last entry’s', () => {
    const before = [log('squat'), log('squat')]
    const pull = log('pull')
    expect(restOf(day, [...before, pull])).toBeNull()
    const raise = log('raise')
    expect(restOf(day, [...before, pull, raise])).toEqual({ since: raise.loggedAt, seconds: 60 })
  })

  test('two minutes after a set with no plan entry — a session without a plan, or a swap', () => {
    const squat = log('squat')
    const swap = log(null)
    expect(restOf(day, [squat, swap])).toEqual({ since: swap.loggedAt, seconds: 120 })
    expect(restOf(null, [swap])).toEqual({ since: swap.loggedAt, seconds: 120 })
  })
})
