import { describe, expect, test } from 'bun:test'
import type { SessionEntryTarget } from './entry-target.ts'
import { loggerAsks } from './focus-logger.ts'
import { NO_TARGET, type SetTarget } from './progression.ts'
import { type FlowLog, adHocSetsOf, setsOf } from './session-flow.ts'
import type { Undone } from './workout-choices.ts'

/** What the logger asks of the focus (#24): the set it logs, the lines beside it, and its key. */

const at = (reps: number, kg: number, reserve: number | null = null): SetTarget => ({
  reps,
  weightG: kg * 1000,
  reserve,
  durationS: null,
  distanceMm: null,
})

/** A Manual entry: a warm-up, a top set, and two back-offs, each asking its own reserve. */
const bench = {
  id: 'bench',
  index: 0,
  exerciseId: 'press',
  supersetGroup: null,
  exercise: {},
  sets: [
    { index: 0, isWarmup: true, target: at(5, 40) },
    { index: 1, isWarmup: false, target: at(6, 90, 2) },
    { index: 2, isWarmup: false, target: at(8, 80, 1) },
    { index: 3, isWarmup: false, target: at(8, 80, 0) },
  ],
}

/** What this session asks of it: on Manual, the plan's own numbers, set by set. */
const asked: SessionEntryTarget = {
  entryId: 'bench',
  exerciseId: 'press',
  exerciseName: 'Bench Press',
  tracking: 'weight_reps',
  rule: { kind: 'none' },
  prescribed: at(6, 90, 2),
  target: at(6, 90, 2),
  changed: false,
  held: null,
  limit: null,
  sessions: 0,
  byHand: false,
  warmups: [at(5, 40)],
  working: [at(6, 90, 2), at(8, 80, 1), at(8, 80, 0)],
  last: null,
}

type Log = FlowLog & { readonly exerciseId: string }
let clock = Date.parse('2026-11-06T18:00:00Z')
/** A set logged: of the bench, or — no entry — of the curl added. */
const done = (entryId: string | null, isWarmup = false): Log => {
  clock += 60_000
  return {
    id: crypto.randomUUID(),
    entryId,
    exerciseId: entryId === null ? 'curl' : 'press',
    isWarmup,
    loggedAt: new Date(clock).toISOString(),
    reps: 8,
    weightG: 80_000,
    durationS: null,
    distanceMm: null,
  }
}
/** The bench's warm-up and every working set it asks. */
const allOfBench = (): Log[] => [done('bench', true), done('bench'), done('bench'), done('bench')]

/** The bench in focus, as `workoutView` gives it — with what the server asks of it, or nothing. */
const onBench = (
  logs: readonly Log[],
  ask: SessionEntryTarget | null = asked,
  undone: Undone | null = null,
) => ({
  kind: 'entry' as const,
  entry: bench,
  sets: setsOf(bench, logs, ask),
  asked: ask ?? undefined,
  undone,
})
/** The curl added in focus. */
const onCurl = (logs: readonly Log[], undone: Undone | null = null) => ({
  kind: 'added' as const,
  exercise: { id: 'curl' },
  sets: adHocSetsOf('curl', logs),
  undone,
})

const NONE: ReadonlySet<string> = new Set()
const asks = (focus: Parameters<typeof loggerAsks>[0], waiting = NONE) =>
  loggerAsks(focus, waiting, 'kg')

describe('what the logger asks of an entry of the day', () => {
  test('the next set as the session asks it, counted as the plan does: warm-ups first', () => {
    expect(asks(onBench([])).next).toEqual({
      target: at(5, 40),
      isWarmup: true,
      title: 'Warm-up 1 of 1',
      action: 'Log warm-up',
    })
    expect(asks(onBench([done('bench', true), done('bench')])).next).toEqual({
      target: at(8, 80, 1),
      isWarmup: false,
      title: 'Set 2 of 3',
      action: 'Log set 2',
    })
  })

  /** As `setsOf` asks a set past the plan: what the last working set asked — not the top set. */
  test('once every set it asked for is logged, another: as the last working set asked', () => {
    const another = {
      target: at(8, 80, 0),
      isWarmup: false,
      title: 'Another set',
      action: 'Log another set',
    }
    expect(asks(onBench(allOfBench())).next).toEqual(another)
    expect(asks(onBench(allOfBench())).progressed).toBe('Prescribed 8 × 80 kg')
    // With nothing from the server, the plan's own numbers.
    expect(asks(onBench(allOfBench(), null)).next).toEqual(another)
    // And one more after it, the same.
    expect(asks(onBench([...allOfBench(), done('bench')])).next).toEqual(another)
  })

  test('beside it, the target — the entry’s on a warm-up — and last time', () => {
    expect(asks(onBench([])).progressed).toBe('Prescribed 6 × 90 kg')
    expect(asks(onBench([done('bench', true), done('bench')])).progressed).toBe(
      'Prescribed 8 × 80 kg',
    )
    expect(loggerAsks(onBench([]), NONE, 'lb').progressed).toBe('Prescribed 6 × 198.42 lb')
    const moved = { ...asked, target: at(6, 92.5, 2), changed: true }
    expect(asks(onBench([], moved)).progressed).toBe(
      'Progressed to 6 × 92.5 kg · the plan says 6 × 90 kg',
    )
    expect(asks(onBench([])).last).toBeNull()
    const last = [at(6, 90), at(8, 80), at(7, 80)]
    expect(asks(onBench([], { ...asked, last })).last).toBe(
      'Last time 6 × 90 kg, 8 × 80 kg, 7 × 80 kg',
    )
  })

  test('with nothing from the server, nothing beside it', () => {
    const plain = asks(onBench([], null))
    expect([plain.progressed, plain.last]).toEqual([null, null])
  })

  test('logged against the entry and its exercise', () => {
    expect(asks(onBench([])).logsAgainst).toEqual({ exerciseId: 'press', entryId: 'bench' })
  })
})

describe('what the logger asks of an exercise added', () => {
  test('one more set from the last — from nothing, the first time — never "of" a count', () => {
    expect(asks(onCurl([])).next).toEqual({
      target: NO_TARGET,
      isWarmup: false,
      title: 'Set 1',
      action: 'Log set 1',
    })
    expect(asks(onCurl([done(null)])).next).toEqual({
      target: at(8, 80),
      isWarmup: false,
      title: 'Set 2',
      action: 'Log set 2',
    })
  })

  test('nothing beside it, and logged against the exercise, with no entry', () => {
    const curl = asks(onCurl([]))
    expect([curl.progressed, curl.last]).toEqual([null, null])
    expect(curl.logsAgainst).toEqual({ exerciseId: 'curl', entryId: null })
  })
})

describe('what the logger asks of either', () => {
  test('its sets marked: one waiting for a signal, as waiting', () => {
    const logs = [done('bench', true), done('bench')]
    const waiting = new Set([logs[1]?.id ?? ''])
    expect(asks(onBench(logs), waiting).marks.map((m) => [m.label, m.mark])).toEqual([
      ['W', 'done'],
      ['1', 'waiting'],
      ['2', 'next'],
      ['3', 'todo'],
    ])
  })

  test('a set just undone: the numbers start from what it said', () => {
    const undone: Undone = { entryId: null, exerciseId: 'curl', effort: at(9, 30), reserve: 1 }
    expect(asks(onCurl([], undone)).from).toBe(undone)
    expect(asks(onBench([])).from).toBeNull()
  })
})

/** The logger starts again from what the next set asks when its key changes — and only then. */
describe('the key the logger starts again by', () => {
  test('changes when a set is logged; not when one waiting lands with the server’s id', () => {
    const sent = done('bench', true)
    const landed = { ...sent, id: 'from-the-server' }
    const before = asks(onBench([])).key
    const waiting = asks(onBench([sent]), new Set([sent.id])).key
    expect(waiting).not.toBe(before)
    expect(asks(onBench([landed])).key).toBe(waiting)
  })

  test('changes when a set is undone; not when one lands on another entry', () => {
    const logs = [done('bench', true), done('bench')]
    const now = asks(onBench(logs)).key
    expect(asks(onBench(logs.slice(0, 1))).key).not.toBe(now)
    // Logged elsewhere — another device, the AI — what is typed here stays.
    expect(asks(onBench([...logs, done('squat')])).key).toBe(now)
  })

  test('changes with each another set logged', () => {
    const all = allOfBench()
    expect(asks(onBench([...all, done('bench')])).key).not.toBe(asks(onBench(all)).key)
  })

  test('of an exercise added, changes with each set logged', () => {
    expect(asks(onCurl([done(null)])).key).not.toBe(asks(onCurl([])).key)
  })
})
