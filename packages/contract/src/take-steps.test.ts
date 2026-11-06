import { describe, expect, test } from 'bun:test'
import { type Against, againstOf } from './against.ts'
import type { Load } from './load.ts'
import type { Progression, SetTarget } from './progression.ts'
import {
  type FinishedSet,
  type RuledEntry,
  type StoredStep,
  type Taken,
  takeSteps,
} from './take-steps.ts'

/**
 * Taking steps through the one interface production uses (ADR-0026): the entry, what is stored, and
 * what was logged in; the steps to write out. The rules' own truth tables are progression.test.ts;
 * these are what only a run of steps does — where it starts, what anchors it, what each session is
 * judged against, and the weights it lands on.
 */

const DOUBLE: Progression = { kind: 'double', repRange: [8, 12], incrementG: 2500 }
const LINEAR: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 1 }

/** `reps` × `weightG` as a target, asking nothing else. */
const t = (reps: number | null, weightG: number | null, reserve: number | null = null) => ({
  reps,
  weightG,
  reserve,
  durationS: null,
  distanceMm: null,
})

/** Three working sets of `reps` × `weightG`, each asking `reserve`, as a plan holds them. */
const plan = (reps: number, weightG: number, reserve: number | null = null) =>
  Array.from({ length: 3 }, () => ({
    targetReps: reps,
    targetWeightG: weightG,
    targetReserve: reserve,
    targetDurationS: null,
    targetDistanceMm: null,
  }))

const PLANNED = plan(8, 60_000)

const entry = (progression: Progression, working = PLANNED): RuledEntry => ({
  id: 'pulldown',
  progression,
  working,
})

/** What a step taken against `working` under `progression` was taken against. */
const against = (progression: Progression, working = PLANNED): Against =>
  againstOf(progression, working)

/** Day `n` of a block: what orders the sessions and the steps. */
const day = (n: number) => new Date(Date.UTC(2026, 10, n))

/** A session finished on day `n`: a working set at `weightG` for each of `reps`, rated `reserve`. */
const session = (
  n: number,
  weightG: number,
  reps: readonly number[],
  reserve: number | null = null,
): FinishedSet[] =>
  reps.map((r) => ({ sessionId: `day ${n}`, startedAt: day(n), weightG, reps: r, reserve }))

const stored = (
  step: Partial<StoredStep> & Pick<StoredStep, 'takenAt' | 'target' | 'against'>,
): StoredStep => ({ sessionId: null, kind: 'session', streak: 0, ...step })

/** Each step as taken: from the target as shown, to the one it left. */
const moves = (steps: readonly Taken[]): [SetTarget, SetTarget][] =>
  steps.map((s) => [s.from, s.target])

describe('a run carries on from the step before it', () => {
  test('the target and the streak a step left before the run are where it starts', () => {
    const rule: Progression = { kind: 'linear', incrementG: 2500, afterSuccesses: 2 }
    const before = stored({
      sessionId: 'day 1',
      takenAt: day(1),
      target: t(8, 62_500),
      streak: 1,
      against: against(rule),
    })
    const steps = takeSteps(entry(rule), [before], session(3, 62_500, [8, 8, 8]), day(2), null)
    // The second session running that cleared 62.5 kg: it advances, and the streak starts over.
    expect(moves(steps)).toEqual([[t(8, 62_500), t(8, 65_000)]])
    expect(steps.map((s) => s.streak)).toEqual([0])
  })
})

describe('a step set by hand', () => {
  test('anchors the sessions after it, wherever the run had taken the target', () => {
    const byHand = stored({
      kind: 'by_hand',
      takenAt: day(2),
      target: t(10, 60_000),
      against: against(DOUBLE),
    })
    const steps = takeSteps(
      entry(DOUBLE),
      [byHand],
      [...session(1, 60_000, [8, 8, 8]), ...session(3, 60_000, [10, 10, 10])],
      day(1),
      null,
    )
    // Day 1 climbed to 9; set to 10 by hand on day 2, day 3 climbs from 10 — not from 9.
    expect(moves(steps)).toEqual([
      [t(8, 60_000), t(9, 60_000)],
      [t(10, 60_000), t(11, 60_000)],
    ])
  })
})

describe('a step that no longer counts', () => {
  test('starts the target again from the prescription as it stands', () => {
    const before = stored({
      sessionId: 'day 1',
      takenAt: day(1),
      target: t(11, 55_000),
      against: against(DOUBLE, plan(8, 55_000)),
    })
    // The plan went from 55 to 60 kg since: 11 × 55 was taken against a plan that is gone.
    const steps = takeSteps(entry(DOUBLE), [before], session(3, 60_000, [8, 8, 8]), day(2), null)
    expect(moves(steps)).toEqual([[t(8, 60_000), t(9, 60_000)]])
  })
})

describe('a session judged before', () => {
  test('is judged again against the plan as it stood; one not judged, against the plan now', () => {
    const then = plan(8, 55_000)
    const judged = stored({
      sessionId: 'day 1',
      takenAt: day(1),
      target: t(9, 55_000),
      against: against(DOUBLE, then),
    })
    // Corrected from day 1: day 1 was trained on the 55 kg plan, day 3 on today's 60 kg one.
    const steps = takeSteps(
      entry(DOUBLE),
      [judged],
      [...session(1, 55_000, [8, 8, 8]), ...session(3, 60_000, [9, 9, 9])],
      day(1),
      null,
    )
    expect(steps.map((s) => s.against)).toEqual([against(DOUBLE, then), against(DOUBLE)])
    // Day 1's step does not count against today's plan, so day 3 starts again from it, mid-run.
    expect(moves(steps)).toEqual([
      [t(8, 55_000), t(9, 55_000)],
      [t(8, 60_000), t(9, 60_000)],
    ])
  })
})

/** Dumbbells from 2 to 30 kg, 2 kg at a time. */
const dumbbells: Load = { stepG: 2000, minG: 2000, maxG: 30_000, assisted: false, unit: 'kg' }

/** A run of one session on day 1 against `working`, on the dumbbells. */
const onDumbbells = (
  progression: Progression,
  working: ReturnType<typeof plan>,
  sets: FinishedSet[],
  load: Load | null = dumbbells,
) => takeSteps(entry(progression, working), [], sets, day(1), load)

describe('steps in weights the athlete can load (ADR-0024)', () => {
  test('22 kg logged on a 22.5 kg plan meets it, and the next is a weight that can be loaded', () => {
    const steps = onDumbbells(LINEAR, plan(8, 22_500), session(1, 22_000, [8, 8, 8]))
    // 22 + 2.5 is 24.5, which no dumbbell weighs: the heaviest not above it.
    expect(moves(steps)).toEqual([[t(8, 22_000), t(8, 24_000)]])
  })

  test('with no load known, 22 kg on a 22.5 kg plan is still short, as it always was', () => {
    const steps = onDumbbells(LINEAR, plan(8, 22_500), session(1, 22_000, [8, 8, 8]), null)
    expect(moves(steps)).toEqual([[t(8, 22_500), t(8, 22_500)]])
    expect(steps[0]?.held).toMatchObject({ reason: 'targets', set: 1 })
  })

  test('why it held is told as the rule told it (#45)', () => {
    const ground = onDumbbells(LINEAR, plan(8, 22_500, 2), session(1, 22_000, [8, 8, 8], 0))
    expect(moves(ground)).toEqual([[t(8, 22_000, 2), t(8, 22_000, 2)]])
    expect(ground[0]?.held).toEqual({ reason: 'effort', set: 1, reserve: 0, asked: 2 })
    const cleared = onDumbbells(LINEAR, plan(8, 22_500), session(1, 22_000, [8, 8, 8]))
    expect(cleared[0]?.held).toBeNull()
  })

  test('at the heaviest dumbbell, a step stops there', () => {
    const steps = onDumbbells(LINEAR, plan(8, 30_000), session(1, 30_000, [8, 8, 8]))
    expect(moves(steps)).toEqual([[t(8, 30_000), t(8, 30_000)]])
    expect(steps[0]?.held).toBeNull()
  })

  test('double progression climbs a rep at the weight shown', () => {
    const steps = onDumbbells(DOUBLE, plan(8, 22_500), session(1, 22_000, [8, 8, 8]))
    expect(moves(steps)).toEqual([[t(8, 22_000), t(9, 22_000)]])
  })

  test('an increase under one step still moves one weight up — never held there for good', () => {
    const rule: Progression = { ...LINEAR, incrementG: 1000 }
    const steps = onDumbbells(rule, plan(8, 20_000), session(1, 20_000, [8, 8, 8]))
    expect(moves(steps)).toEqual([[t(8, 20_000), t(8, 22_000)]])
  })

  test('an increase of several steps lands on the heaviest weight not above it', () => {
    const rule: Progression = { ...LINEAR, incrementG: 5000 }
    const steps = onDumbbells(rule, plan(8, 20_000), session(1, 20_000, [8, 8, 8]))
    // 20 + 5 is 25: 24 is the heaviest dumbbell not above it — not just the next one up, 22.
    expect(moves(steps)).toEqual([[t(8, 20_000), t(8, 24_000)]])
  })

  test('double progression at the top of its reps moves one weight up, not round its reps again', () => {
    const rule: Progression = { ...DOUBLE, incrementG: 1000 }
    const steps = onDumbbells(rule, plan(12, 22_000), session(1, 22_000, [12, 12, 12]))
    expect(moves(steps)).toEqual([[t(12, 22_000), t(8, 24_000)]])
  })
})
