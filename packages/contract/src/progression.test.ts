import { describe, expect, test } from 'bun:test'
import type { Held, Progression, SessionAttempts, SetTarget } from './progression.ts'
import { type FinishedSet, type RuledEntry, takeSteps } from './take-steps.ts'
import { MAX_DURATION_S, MAX_WEIGHT_G } from './measurement.ts'
import { formatWeight, kgToG, mToMm } from './units.ts'

/**
 * A run of finished sessions, MOST RECENT FIRST — the shape these tables are written in — from an
 * entry whose `workingSets` working sets ask `target`, each the reserve `reserves` gives it, or the
 * target's when it gives none. Nothing was stored before them.
 */
interface Run {
  readonly rule: Progression
  readonly target: SetTarget
  readonly workingSets: number
  readonly reserves?: readonly (number | null)[]
  readonly sessions: readonly SessionAttempts[]
}

const DAY_MS = 86_400_000

/**
 * The run taken as steps are (`takeSteps`), a day apart, with no load known: the target the newest
 * session left, and why it held it, if it did. A run that took no step leaves the target it asked.
 */
function progressed(run: Run): { readonly target: SetTarget; readonly held: Held | null } {
  const entry: RuledEntry = {
    id: 'entry',
    progression: run.rule,
    working: Array.from({ length: run.workingSets }, (_, i) => ({
      targetReps: run.target.reps,
      targetWeightG: run.target.weightG,
      targetReserve: run.reserves === undefined ? run.target.reserve : (run.reserves[i] ?? null),
      targetDurationS: run.target.durationS,
      targetDistanceMm: run.target.distanceMm,
    })),
  }
  const sets: FinishedSet[] = run.sessions.toReversed().flatMap((session, i) =>
    session.map((set) => ({
      ...set,
      sessionId: `session ${i + 1}`,
      startedAt: new Date((i + 1) * DAY_MS),
    })),
  )
  const newest = takeSteps(entry, [], sets, new Date(0), null).at(-1)
  return newest === undefined
    ? { target: run.target, held: null }
    : { target: newest.target, held: newest.held }
}

/** The next prescription alone: most of these tables are about where it goes, not why. */
const targetOf = (run: Run): SetTarget => progressed(run).target

/** `sets(60)(12, 12, 10)` -> three attempts at 60 kg; `sets(60, 0)(…)`, each with none in reserve. */
const sets =
  (weightKg: number, reserve: number | null = null) =>
  (...reps: number[]): SessionAttempts =>
    reps.map((r) => ({ weightG: kgToG(weightKg), reps: r, reserve }))

const at60 = sets(60)
/** Working sets at 60 kg, each `[reps, reserve]`. */
const rated = (...efforts: (readonly [number, number | null])[]): SessionAttempts =>
  efforts.map(([reps, reserve]) => ({ weightG: kgToG(60), reps, reserve }))
/** Working sets at 60 kg, every one leaving `reserve`. */
const all = (reserve: number | null, ...reps: number[]): SessionAttempts =>
  sets(60, reserve)(...reps)
const target = (reps: number | null, weightKg: number | null): SetTarget => ({
  reps,
  weightG: weightKg === null ? null : kgToG(weightKg),
  reserve: null,
  durationS: null,
  distanceMm: null,
})

/** A timed prescription: held `seconds` — a plank, a dead hang. */
const timed = (seconds: number | null): SetTarget => ({
  reps: null,
  weightG: null,
  reserve: null,
  durationS: seconds,
  distanceMm: null,
})

const DOUBLE: Progression = { kind: 'double', repRange: [8, 12], incrementG: kgToG(2.5) }

/** What a set did, as a hold names it: an attempt with every dimension said, unrecorded as null. */
const did = (attempt: SessionAttempts[number]): SetTarget => ({
  reps: attempt.reps ?? null,
  weightG: attempt.weightG ?? null,
  reserve: attempt.reserve ?? null,
  durationS: attempt.durationS ?? null,
  distanceMm: attempt.distanceMm ?? null,
})
/** Held short of the targets at working set `set` (from 1): what it did — null, not done — and was asked. */
const short = (set: number, done: SetTarget | null, asked: SetTarget) =>
  ({ reason: 'targets', set, did: done, asked }) as const
/** Held for effort at working set `set`: the reserve it left, and the reserve it asked. */
const effort = (set: number, reserve: number, asked: number) =>
  ({ reason: 'effort', set, reserve, asked }) as const
const LINEAR: Progression = { kind: 'linear', incrementG: kgToG(2.5), afterSuccesses: 1 }

describe('progress — double progression (3 sets of 8-12, +2.5kg)', () => {
  const run = (t: SetTarget, ...sessions: SessionAttempts[]) =>
    targetOf({ rule: DOUBLE, target: t, workingSets: 3, sessions })

  /**
   * Steps accumulate (ADR-0026): each session is judged against the target the last one left, not
   * against the plan — which left 8, 9, 10 asking 9 for ever.
   */
  test('a run of sessions climbs a rep each, from where the last one left it', () => {
    expect(run(target(8, 60), at60(10, 10, 10), at60(9, 9, 9), at60(8, 8, 8))).toEqual(
      target(11, 60),
    )
    expect(run(target(11, 60), at60(12, 12, 12), at60(11, 11, 11))).toEqual(target(8, 62.5))
  })

  // These four cases are the agreed truth table. See docs/adr/0012-progression-rules.md.
  test('all sets clear the top of the range -> add weight, restart at the bottom', () => {
    expect(run(target(12, 60), at60(12, 12, 12))).toEqual(target(8, 62.5))
  })

  /** Assisted (#19): each step takes assistance away, toward bodyweight and on into added load. */
  test('an assisted target steps toward bodyweight, then past it', () => {
    expect(run(target(12, -20), sets(-20)(12, 12, 12))).toEqual(target(8, -17.5))
    expect(run(target(12, -1), sets(-1)(12, 12, 12))).toEqual(target(8, 1.5))
  })

  /** On a bodyweight movement no added weight is 0, which clears any assisted target. */
  test('sets with no band clear an assisted target', () => {
    const unassisted: SessionAttempts = [12, 12, 12].map((reps) => ({ weightG: null, reps }))
    expect(run(target(12, -20), unassisted)).toEqual(target(8, -17.5))
  })

  /** Only against assistance: on a weight lift an unrecorded weight still meets no target. */
  test('a weight lift with no weight recorded clears nothing, even a 0 kg target', () => {
    const unrecorded: SessionAttempts = [12, 12, 12].map((reps) => ({ weightG: null, reps }))
    expect(run(target(12, 0), unrecorded)).toEqual(target(12, 0))
  })

  test('one set misses the top -> hold', () => {
    expect(run(target(12, 60), at60(12, 12, 10))).toEqual(target(12, 60))
  })

  test('all sets meet the current target below the top -> climb one rep', () => {
    expect(run(target(10, 60), at60(10, 10, 10))).toEqual(target(11, 60))
  })

  test('one set misses the current target -> hold', () => {
    expect(run(target(10, 60), at60(10, 10, 8))).toEqual(target(10, 60))
  })

  test('exceeding the target still only climbs one rep', () => {
    expect(run(target(10, 60), at60(15, 15, 15))).toEqual(target(11, 60))
  })

  test('a partially logged session cannot earn a promotion', () => {
    expect(run(target(12, 60), at60(12, 12))).toEqual(target(12, 60))
  })

  test('lifting lighter than prescribed does not count', () => {
    expect(run(target(12, 60), sets(55)(12, 12, 12))).toEqual(target(12, 60))
  })

  test('lifting heavier than prescribed does count', () => {
    expect(run(target(12, 60), sets(65)(12, 12, 12))).toEqual(target(8, 62.5))
  })

  test('an unrecorded rep count blocks advancement', () => {
    const partial: SessionAttempts = [
      { weightG: kgToG(60), reps: 12 },
      { weightG: kgToG(60), reps: null },
      { weightG: kgToG(60), reps: 12 },
    ]
    expect(run(target(12, 60), partial)).toEqual(target(12, 60))
  })

  test('no history at all -> unchanged', () => {
    expect(run(target(12, 60))).toEqual(target(12, 60))
  })

  test('bodyweight (no target weight) climbs reps but never adds weight', () => {
    const bw: SessionAttempts = [
      { weightG: null, reps: 12 },
      { weightG: null, reps: 12 },
      { weightG: null, reps: 12 },
    ]
    expect(run(target(10, null), bw)).toEqual(target(11, null))
    expect(run(target(12, null), bw)).toEqual(target(12, null))
  })

  test('a null rep target starts from the bottom of the range', () => {
    expect(run(target(null, 60), at60(12, 12, 12))).toEqual(target(9, 60))
  })
})

describe('progress — linear progression', () => {
  test('a session that clears the prescription adds weight', () => {
    const result = targetOf({
      rule: LINEAR,
      target: target(5, 100),
      workingSets: 3,
      sessions: [sets(100)(5, 5, 5)],
    })
    expect(result).toEqual(target(5, 102.5))
  })

  test('a missed rep holds', () => {
    const result = targetOf({
      rule: LINEAR,
      target: target(5, 100),
      workingSets: 3,
      sessions: [sets(100)(5, 5, 4)],
    })
    expect(result).toEqual(target(5, 100))
  })

  test('afterSuccesses=2 requires two consecutive sessions that clear it', () => {
    const rule: Progression = { kind: 'linear', incrementG: kgToG(2.5), afterSuccesses: 2 }
    const t = target(5, 100)
    const cleared = sets(100)(5, 5, 5)
    const missed = sets(100)(5, 5, 4)

    expect(targetOf({ rule, target: t, workingSets: 3, sessions: [cleared] })).toEqual(t)
    expect(targetOf({ rule, target: t, workingSets: 3, sessions: [cleared, cleared] })).toEqual(
      target(5, 102.5),
    )
    // Most recent first: a miss in the most recent session blocks it.
    expect(targetOf({ rule, target: t, workingSets: 3, sessions: [missed, cleared] })).toEqual(t)
    expect(targetOf({ rule, target: t, workingSets: 3, sessions: [cleared, missed] })).toEqual(t)
  })
})

/**
 * A prescribed reserve is a floor (#45): reps ground out past it are not the reps the plan asked for.
 * A set that left fewer in reserve than asked holds; an unrated set, or an unprescribed reserve, is
 * judged on its reps and weight alone. Whole, both sides (ADR-0027), so there is no allowance. See
 * docs/adr/0012-progression-rules.md.
 */
describe('progress — a prescribed reserve is a floor', () => {
  const at = (reserve: number | null, t: SetTarget): SetTarget => ({ ...t, reserve })
  const double = (t: SetTarget, ...sessions: SessionAttempts[]) =>
    targetOf({ rule: DOUBLE, target: t, workingSets: 3, sessions })
  const linear = (t: SetTarget, ...sessions: SessionAttempts[]) =>
    targetOf({ rule: LINEAR, target: t, workingSets: 3, sessions })

  // The truth table's effort rows. See docs/adr/0012-progression-rules.md.
  test('the top of the range ground out past the reserve holds', () => {
    expect(double(at(2, target(12, 60)), all(0, 12, 12, 12))).toEqual(at(2, target(12, 60)))
  })

  test('the top of the range at the reserve adds weight', () => {
    expect(double(at(2, target(12, 60)), all(2, 12, 12, 12))).toEqual(at(2, target(8, 62.5)))
  })

  test('one rep fewer in reserve than prescribed holds', () => {
    expect(double(at(2, target(12, 60)), all(1, 12, 12, 12))).toEqual(at(2, target(12, 60)))
  })

  test('a rep climb ground out past the reserve holds too', () => {
    expect(double(at(2, target(10, 60)), all(0, 10, 10, 10))).toEqual(at(2, target(10, 60)))
    expect(double(at(2, target(10, 60)), all(2, 10, 10, 10))).toEqual(at(2, target(11, 60)))
  })

  test('one working set ground out past it holds the session', () => {
    expect(double(at(2, target(12, 60)), rated([12, 3], [12, 2], [12, 1]))).toEqual(
      at(2, target(12, 60)),
    )
  })

  test('an unrated set is judged on its reps and weight alone', () => {
    expect(double(at(2, target(12, 60)), all(null, 12, 12, 12))).toEqual(at(2, target(8, 62.5)))
    expect(double(at(2, target(12, 60)), rated([12, null], [12, 2], [12, null]))).toEqual(
      at(2, target(8, 62.5)),
    )
    expect(double(at(2, target(12, 60)), rated([12, null], [12, 0], [12, null]))).toEqual(
      at(2, target(12, 60)),
    )
  })

  test('with no reserve prescribed, a rated set is judged on its reps and weight alone', () => {
    expect(double(target(12, 60), all(0, 12, 12, 12))).toEqual(target(8, 62.5))
  })

  test('far more in reserve than asked still advances one step, never faster', () => {
    expect(double(at(2, target(12, 60)), all(4, 12, 12, 12))).toEqual(at(2, target(8, 62.5)))
  })

  test('a set past those prescribed is not judged, nor is a warm-up', () => {
    const session: SessionAttempts = [
      { weightG: kgToG(40), reps: 5, reserve: 0, isWarmup: true },
      ...all(2, 12, 12, 12),
      { weightG: kgToG(60), reps: 12, reserve: 0 },
    ]
    expect(double(at(2, target(12, 60)), session)).toEqual(at(2, target(8, 62.5)))
  })

  test('linear holds a session that met its reps but was ground out past the reserve', () => {
    expect(linear(at(2, target(5, 100)), sets(100, 0)(5, 5, 5))).toEqual(at(2, target(5, 100)))
    expect(linear(at(2, target(5, 100)), sets(100, 2)(5, 5, 5))).toEqual(at(2, target(5, 102.5)))
  })

  test('linear waits out a session ground out past the reserve, however long the run', () => {
    const rule: Progression = { kind: 'linear', incrementG: kgToG(2.5), afterSuccesses: 2 }
    const t = at(2, target(5, 100))
    const within = sets(100, 2)(5, 5, 5)
    const ground = sets(100, 0)(5, 5, 5)
    expect(targetOf({ rule, target: t, workingSets: 3, sessions: [within, ground] })).toEqual(t)
  })
})

/**
 * Effort ramps across sets (ADR-0026): each working set may ask its own reserve, and is judged
 * against its own — not every set against the first's. A plan whose last set may go to failure
 * held for effort every session while it was judged against set 1.
 */
describe('progress — each working set is judged against its own reserve', () => {
  const ramp = { ...target(12, 60), reserve: 2 }
  const judged = (reserves: readonly (number | null)[], session: SessionAttempts) =>
    progressed({ rule: DOUBLE, target: ramp, workingSets: 3, reserves, sessions: [session] })

  test('a ramp to failure, done as asked, advances', () => {
    expect(judged([2, 1, 0], rated([12, 2], [12, 1], [12, 0])).target).toEqual({
      ...target(8, 62.5),
      reserve: 2,
    })
  })

  test('an early set ground out past its own reserve holds, though a later set asks less', () => {
    expect(judged([2, 1, 0], rated([12, 1], [12, 1], [12, 0]))).toEqual({
      target: ramp,
      held: effort(1, 1, 2),
    })
  })

  test('a set that asks no reserve has nothing to go past', () => {
    expect(judged([2, 2, null], rated([12, 2], [12, 2], [12, 0])).held).toBeNull()
  })
})

/**
 * Why a rule held (#45): short of the targets, or ground out past the reserve — so neither the
 * athlete nor the AI reads a prescription held for effort as a stall. None when it advanced, or had
 * nothing to judge.
 */
describe('progress — why a prescription held', () => {
  const top = { ...target(12, 60), reserve: 2 }
  const why = (rule: Progression, t: SetTarget, ...sessions: SessionAttempts[]) =>
    progressed({ rule, target: t, workingSets: 3, sessions }).held

  test('it gives the next prescription, with no reason when it advanced', () => {
    expect(
      progressed({ rule: DOUBLE, target: top, workingSets: 3, sessions: [all(2, 12, 12, 12)] }),
    ).toEqual({ target: { ...target(8, 62.5), reserve: 2 }, held: null })
  })

  test('short of the targets', () => {
    expect(why(DOUBLE, top, all(2, 12, 12, 10))).toEqual(
      short(3, did({ weightG: kgToG(60), reps: 10, reserve: 2 }), top),
    )
    expect(why(DOUBLE, top, all(2, 12, 12))).toEqual(short(3, null, top))
  })

  test('ground out past the reserve: the set that left the fewest, and what it asked', () => {
    expect(why(DOUBLE, top, rated([12, 3], [12, 0], [12, 1]))).toEqual(effort(2, 0, 2))
  })

  test('under double, the first set short of its reps is named, with what it did', () => {
    const below = { ...target(9, 60), reserve: 2 }
    expect(why(DOUBLE, below, all(2, 9, 8, 9))).toEqual(
      short(2, did({ weightG: kgToG(60), reps: 8, reserve: 2 }), below),
    )
  })

  test('short of the targets outranks the effort', () => {
    expect(why(DOUBLE, top, all(0, 12, 12, 10))).toEqual(
      short(3, did({ weightG: kgToG(60), reps: 10, reserve: 0 }), top),
    )
  })

  /** It prescribed working sets and none were done — not "nothing to judge", under either rule. */
  test('a session of nothing but warm-ups is short of the targets, under either rule', () => {
    const warmups: SessionAttempts = [{ weightG: kgToG(40), reps: 5, isWarmup: true }]
    expect(why(DOUBLE, top, warmups)).toEqual(short(1, null, top))
    expect(why(LINEAR, top, warmups)).toEqual(short(1, null, top))
  })

  test('none when it advanced, had nothing to judge, or could not move', () => {
    expect(why(DOUBLE, top, all(2, 12, 12, 12))).toBeNull()
    expect(why(DOUBLE, top)).toBeNull()
    expect(why({ kind: 'none' }, top, all(0, 12, 12, 10))).toBeNull()
    // Bodyweight at the top of its range: cleared, but there is no weight to add.
    expect(why(DOUBLE, { ...top, weightG: null }, all(2, 12, 12, 12))).toBeNull()
  })

  test("none at a target's ceiling: it was cleared, and stopped only by the limit", () => {
    const t: SetTarget = { ...target(5, null), weightG: MAX_WEIGHT_G - 1000 }
    const session: SessionAttempts = [{ reps: 5, weightG: t.weightG }]
    expect(progressed({ rule: LINEAR, target: t, workingSets: 1, sessions: [session] })).toEqual({
      target: t,
      held: null,
    })
  })

  /** Each step says its own session's reason (ADR-0026): a cleared one, waiting on a run, has none. */
  test('over a run, the newest session says why — none while it only waits for more', () => {
    const rule: Progression = { kind: 'linear', incrementG: kgToG(2.5), afterSuccesses: 2 }
    const t = { ...target(5, 100), reserve: 2 }
    const at100 = (reserve: number, ...reps: number[]): SessionAttempts =>
      reps.map((r) => ({ weightG: kgToG(100), reps: r, reserve }))
    expect(why(rule, t, at100(0, 5, 5, 5), at100(2, 5, 5, 5))).toEqual(effort(1, 0, 2))
    expect(why(rule, t, at100(0, 5, 5, 4), at100(0, 5, 5, 5))).toEqual(
      short(3, did({ weightG: kgToG(100), reps: 4, reserve: 0 }), t),
    )
    expect(why(rule, t, at100(2, 5, 5, 5), at100(0, 5, 5, 5))).toBeNull()
    expect(why(rule, t, at100(2, 5, 5, 5))).toBeNull()
  })

  test('a hold or a run is only ever short of its targets', () => {
    const rule: Progression = { kind: 'linear_duration', incrementS: 15, afterSuccesses: 1 }
    expect(
      progressed({ rule, target: timed(60), workingSets: 1, sessions: [[{ durationS: 45 }]] }).held,
    ).toEqual(short(1, did({ durationS: 45 }), timed(60)))
  })
})

describe('progress — invariants that must hold for every rule', () => {
  const rules: Progression[] = [{ kind: 'none' }, LINEAR, DOUBLE]
  const histories: SessionAttempts[][] = [
    [],
    [at60(12, 12, 12)],
    [at60(1, 1, 1)],
    [[], []],
    [sets(0)(0, 0, 0)],
  ]

  test('never decreases weight or reps', () => {
    const t = target(10, 60)
    for (const rule of rules) {
      for (const sessions of histories) {
        const next = targetOf({ rule, target: t, workingSets: 3, sessions })

        if (next.weightG !== null && t.weightG !== null) {
          expect(next.weightG).toBeGreaterThanOrEqual(t.weightG)
        }
        // The only legitimate rep decrease is the double-progression reset back to the
        // bottom of the range, and that always comes with a weight increase.
        if (next.reps !== null && t.reps !== null && next.reps < t.reps) {
          expect(next.weightG).toBeGreaterThan(t.weightG ?? 0)
        }
      }
    }
  })

  test("'none' is always the identity", () => {
    const t = target(10, 60)
    for (const sessions of histories) {
      expect(targetOf({ rule: { kind: 'none' }, target: t, workingSets: 3, sessions })).toEqual(t)
    }
  })

  test('weight increases always land on the increment grid', () => {
    const t = target(12, 60)
    const next = targetOf({
      rule: DOUBLE,
      target: t,
      workingSets: 3,
      sessions: [at60(12, 12, 12)],
    })
    expect(formatWeight(next.weightG ?? 0, 'kg')).toBe('62.5 kg')
  })
})

describe('progress — warm-up sets are excluded entirely', () => {
  const warmup = (weightKg: number, reps: number) => ({
    weightG: kgToG(weightKg),
    reps,
    isWarmup: true,
  })

  /**
   * The reason warm-ups exist in the model at all: without the flag, a ramp logged before the
   * working sets is evaluated AS the working sets, and the lifter never progresses.
   * See docs/adr/0012-progression-rules.md.
   */
  test('a ramp logged before the working sets does not block progression', () => {
    const session: SessionAttempts = [warmup(20, 10), warmup(40, 5), ...at60(12, 12, 12)]
    expect(
      targetOf({ rule: DOUBLE, target: target(12, 60), workingSets: 3, sessions: [session] }),
    ).toEqual(target(8, 62.5))
  })

  test('warm-ups do not count toward the working-set requirement', () => {
    const session: SessionAttempts = [warmup(20, 10), warmup(40, 5), ...at60(12, 12)]
    expect(
      targetOf({ rule: DOUBLE, target: target(12, 60), workingSets: 3, sessions: [session] }),
    ).toEqual(target(12, 60))
  })

  test('a session of nothing but warm-ups is not a session', () => {
    const session: SessionAttempts = [warmup(20, 10), warmup(40, 5)]
    expect(
      targetOf({ rule: LINEAR, target: target(5, 100), workingSets: 1, sessions: [session] }),
    ).toEqual(target(5, 100))
  })
})

describe('progress — linear_duration (planks, dead hangs, carries)', () => {
  const RULE: Progression = { kind: 'linear_duration', incrementS: 5, afterSuccesses: 1 }
  const timedSets = (...seconds: number[]): SessionAttempts =>
    seconds.map((durationS) => ({ durationS }))

  test('holding the target on every set adds time', () => {
    expect(
      targetOf({
        rule: RULE,
        target: timed(60),
        workingSets: 3,
        sessions: [timedSets(60, 60, 60)],
      }),
    ).toEqual(timed(65))
  })

  test('holding longer than target still advances by exactly one increment', () => {
    expect(
      targetOf({
        rule: RULE,
        target: timed(60),
        workingSets: 3,
        sessions: [timedSets(90, 90, 90)],
      }),
    ).toEqual(timed(65))
  })

  test('a short hold on any set holds the target', () => {
    expect(
      targetOf({
        rule: RULE,
        target: timed(60),
        workingSets: 3,
        sessions: [timedSets(60, 60, 45)],
      }),
    ).toEqual(timed(60))
  })

  test('an unrecorded hold blocks advancement', () => {
    const partial: SessionAttempts = [{ durationS: 60 }, { durationS: null }, { durationS: 60 }]
    expect(
      targetOf({ rule: RULE, target: timed(60), workingSets: 3, sessions: [partial] }),
    ).toEqual(timed(60))
  })

  test('no duration target -> unchanged', () => {
    expect(
      targetOf({
        rule: RULE,
        target: target(10, 60),
        workingSets: 3,
        sessions: [timedSets(60, 60, 60)],
      }),
    ).toEqual(target(10, 60))
  })
})

/**
 * Runs and rows (#14) go further at the pace the plan prescribes: the time grows with the distance,
 * so a volume step never hides a pace jump. Going faster is left to the user or the AI — a shorter
 * target time would break advance-or-hold. See docs/adr/0012-progression-rules.md.
 */
describe('progress — linear_distance (runs, rows)', () => {
  const RULE: Progression = { kind: 'linear_distance', incrementMm: 500_000, afterSuccesses: 1 }
  const covered = (metres: number, seconds: number | null): SetTarget => ({
    reps: null,
    weightG: null,
    reserve: null,
    durationS: seconds,
    distanceMm: mToMm(metres),
  })
  const ran = (...efforts: [metres: number, seconds: number | null][]): SessionAttempts =>
    efforts.map(([metres, durationS]) => ({ distanceMm: mToMm(metres), durationS }))
  const next = (t: SetTarget, sessions: SessionAttempts[], workingSets = 1, rule = RULE) =>
    targetOf({ rule, target: t, workingSets, sessions })

  test('the distance exactly at the pace adds distance, at the same pace', () => {
    expect(next(covered(5000, 1800), [ran([5000, 1800])])).toEqual(covered(5500, 1980))
  })

  test('faster than prescribed still advances by one step, at the prescribed pace', () => {
    expect(next(covered(5000, 1800), [ran([5000, 1740])])).toEqual(covered(5500, 1980))
  })

  test('the distance outside the time holds', () => {
    expect(next(covered(5000, 1800), [ran([5000, 1860])])).toEqual(covered(5000, 1800))
  })

  test('further, and faster than the pace, advances — the pace is what was asked of it', () => {
    expect(next(covered(5000, 1800), [ran([6000, 1980])])).toEqual(covered(5500, 1980))
  })

  test('further, but slower than the pace, holds', () => {
    expect(next(covered(5000, 1800), [ran([6000, 2190])])).toEqual(covered(5000, 1800))
  })

  test('short of the distance holds, however fast', () => {
    expect(next(covered(5000, 1800), [ran([4800, 1680])])).toEqual(covered(5000, 1800))
  })

  test('no time recorded against a prescribed time holds', () => {
    expect(next(covered(5000, 1800), [ran([5000, null])])).toEqual(covered(5000, 1800))
  })

  test('with no time prescribed, the distance alone advances it, and no time is added', () => {
    expect(next(covered(5000, null), [ran([5000, null])])).toEqual(covered(5500, null))
    expect(next(covered(5000, null), [ran([5000, 2400])])).toEqual(covered(5500, null))
  })

  test('the time grows to whole seconds, rounded up — never a hair faster than the pace', () => {
    // 3 km in 1000 s is 0.333 s/m: 3.5 km takes 1166.67 s.
    expect(next(covered(3000, 1000), [ran([3000, 1000])])).toEqual(covered(3500, 1167))
    // 5 km in 1801 s: 5.5 km takes 1981.1 s — 1981 would be faster than prescribed.
    expect(next(covered(5000, 1801), [ran([5000, 1801])])).toEqual(covered(5500, 1982))
  })

  test('intervals advance only when every working set made it', () => {
    const step: Progression = { ...RULE, incrementMm: 100_000 }
    const t = covered(500, 105)
    expect(next(t, [ran([500, 104], [500, 105], [500, 103], [500, 105])], 4, step)).toEqual(
      covered(600, 126),
    )
    expect(next(t, [ran([500, 104], [500, 105], [500, 108], [500, 105])], 4, step)).toEqual(t)
    expect(next(t, [ran([500, 104], [500, 105], [500, 103])], 4, step)).toEqual(t)
  })

  test('afterSuccesses=2 requires two consecutive sessions that clear it', () => {
    const rule: Progression = { ...RULE, afterSuccesses: 2 }
    const t = covered(5000, 1800)
    const cleared = ran([5000, 1800])
    const missed = ran([4000, 1800])
    expect(next(t, [cleared], 1, rule)).toEqual(t)
    expect(next(t, [cleared, missed], 1, rule)).toEqual(t)
    expect(next(t, [cleared, cleared], 1, rule)).toEqual(covered(5500, 1980))
  })

  test('warm-ups are excluded', () => {
    const session: SessionAttempts = [
      { distanceMm: 1_000_000, durationS: 420, isWarmup: true },
      ...ran([5000, 1800]),
    ]
    expect(next(covered(5000, 1800), [session])).toEqual(covered(5500, 1980))
  })

  test('no distance target, or no history -> unchanged', () => {
    expect(next(timed(60), [ran([5000, 1800])])).toEqual(timed(60))
    expect(next(covered(5000, 1800), [])).toEqual(covered(5000, 1800))
  })

  test('never shortens the distance or the time', () => {
    for (const sessions of [[], [ran([9000, 100])], [ran([1, 99_999])], [[]]]) {
      const t = covered(5000, 1800)
      const after = next(t, sessions)
      expect(after.distanceMm ?? 0).toBeGreaterThanOrEqual(t.distanceMm ?? 0)
      expect(after.durationS ?? 0).toBeGreaterThanOrEqual(t.durationS ?? 0)
    }
  })
})

/**
 * A suggestion past what a target may hold would be refused by the API's own response schema — a
 * 500 for the whole plan's progression, and for the logger's pre-fill. At the ceiling, every rule
 * holds instead.
 */
describe('progress — a target at its ceiling holds', () => {
  test('a weight that would pass the heaviest target', () => {
    const t: SetTarget = { ...target(5, null), weightG: MAX_WEIGHT_G - 1000 }
    expect(
      targetOf({
        rule: LINEAR,
        target: t,
        workingSets: 1,
        sessions: [[{ reps: 5, weightG: t.weightG }]],
      }),
    ).toEqual(t)
  })

  test('a hold that would pass the longest target', () => {
    const rule: Progression = { kind: 'linear_duration', incrementS: 15, afterSuccesses: 1 }
    const t = timed(MAX_DURATION_S - 5)
    expect(
      targetOf({ rule, target: t, workingSets: 1, sessions: [[{ durationS: t.durationS }]] }),
    ).toEqual(t)
  })

  test('a run whose time, kept at its pace, would pass the longest target', () => {
    const rule: Progression = { kind: 'linear_distance', incrementMm: 500_000, afterSuccesses: 1 }
    const t: SetTarget = { ...timed(80_000), distanceMm: mToMm(1000) }
    expect(
      targetOf({
        rule,
        target: t,
        workingSets: 1,
        sessions: [[{ distanceMm: t.distanceMm, durationS: 80_000 }]],
      }),
    ).toEqual(t)
  })
})
