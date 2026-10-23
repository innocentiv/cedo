import { describe, expect, test } from 'bun:test'
import {
  type Progression,
  type SessionAttempts,
  type SetTarget,
  nextTarget,
} from './progression.ts'
import { formatWeight, kgToG } from './units.ts'

/** `sets(12, 12, 10)` at 60kg -> three attempts. */
const sets =
  (weightKg: number) =>
  (...reps: number[]): SessionAttempts =>
    reps.map((r) => ({ weightG: kgToG(weightKg), reps: r }))

const at60 = sets(60)
const target = (reps: number | null, weightKg: number | null): SetTarget => ({
  reps,
  weightG: weightKg === null ? null : kgToG(weightKg),
  rpe: null,
  durationS: null,
  distanceMm: null,
})

const held = (seconds: number | null): SetTarget => ({
  reps: null,
  weightG: null,
  rpe: null,
  durationS: seconds,
  distanceMm: null,
})

const DOUBLE: Progression = { kind: 'double', repRange: [8, 12], incrementG: kgToG(2.5) }
const LINEAR: Progression = { kind: 'linear', incrementG: kgToG(2.5), afterSuccesses: 1 }

describe('nextTarget — double progression (3 sets of 8-12, +2.5kg)', () => {
  const run = (t: SetTarget, ...sessions: SessionAttempts[]) =>
    nextTarget({ rule: DOUBLE, target: t, workingSets: 3, sessions })

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

  test('a reversed range is tolerated rather than producing nonsense', () => {
    const reversed: Progression = { kind: 'double', repRange: [12, 8], incrementG: kgToG(2.5) }
    const result = nextTarget({
      rule: reversed,
      target: target(12, 60),
      workingSets: 3,
      sessions: [at60(12, 12, 12)],
    })
    expect(result).toEqual(target(8, 62.5))
  })
})

describe('nextTarget — linear progression', () => {
  test('a clean session adds weight', () => {
    const result = nextTarget({
      rule: LINEAR,
      target: target(5, 100),
      workingSets: 3,
      sessions: [sets(100)(5, 5, 5)],
    })
    expect(result).toEqual(target(5, 102.5))
  })

  test('a missed rep holds', () => {
    const result = nextTarget({
      rule: LINEAR,
      target: target(5, 100),
      workingSets: 3,
      sessions: [sets(100)(5, 5, 4)],
    })
    expect(result).toEqual(target(5, 100))
  })

  test('afterSuccesses=2 requires two consecutive clean sessions', () => {
    const rule: Progression = { kind: 'linear', incrementG: kgToG(2.5), afterSuccesses: 2 }
    const t = target(5, 100)
    const clean = sets(100)(5, 5, 5)
    const missed = sets(100)(5, 5, 4)

    expect(nextTarget({ rule, target: t, workingSets: 3, sessions: [clean] })).toEqual(t)
    expect(nextTarget({ rule, target: t, workingSets: 3, sessions: [clean, clean] })).toEqual(
      target(5, 102.5),
    )
    // Most recent first: a miss in the most recent session blocks it.
    expect(nextTarget({ rule, target: t, workingSets: 3, sessions: [missed, clean] })).toEqual(t)
    expect(nextTarget({ rule, target: t, workingSets: 3, sessions: [clean, missed] })).toEqual(t)
  })
})

describe('nextTarget — invariants that must hold for every rule', () => {
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
        const next = nextTarget({ rule, target: t, workingSets: 3, sessions })

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
      expect(nextTarget({ rule: { kind: 'none' }, target: t, workingSets: 3, sessions })).toEqual(t)
    }
  })

  test('weight increases always land on the increment grid', () => {
    const t = target(12, 60)
    const next = nextTarget({
      rule: DOUBLE,
      target: t,
      workingSets: 3,
      sessions: [at60(12, 12, 12)],
    })
    expect(formatWeight(next.weightG ?? 0, 'kg')).toBe('62.5 kg')
  })
})

describe('nextTarget — warm-up sets are excluded entirely', () => {
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
      nextTarget({ rule: DOUBLE, target: target(12, 60), workingSets: 3, sessions: [session] }),
    ).toEqual(target(8, 62.5))
  })

  test('warm-ups do not count toward the working-set requirement', () => {
    const session: SessionAttempts = [warmup(20, 10), warmup(40, 5), ...at60(12, 12)]
    expect(
      nextTarget({ rule: DOUBLE, target: target(12, 60), workingSets: 3, sessions: [session] }),
    ).toEqual(target(12, 60))
  })

  test('a session of nothing but warm-ups is not a session', () => {
    const session: SessionAttempts = [warmup(20, 10), warmup(40, 5)]
    expect(
      nextTarget({ rule: LINEAR, target: target(5, 100), workingSets: 1, sessions: [session] }),
    ).toEqual(target(5, 100))
  })
})

describe('nextTarget — linear_duration (planks, dead hangs, carries)', () => {
  const RULE: Progression = { kind: 'linear_duration', incrementS: 5, afterSuccesses: 1 }
  const hold = (...seconds: number[]): SessionAttempts =>
    seconds.map((durationS) => ({ durationS }))

  test('holding the target on every set adds time', () => {
    expect(
      nextTarget({ rule: RULE, target: held(60), workingSets: 3, sessions: [hold(60, 60, 60)] }),
    ).toEqual(held(65))
  })

  test('holding longer than target still advances by exactly one increment', () => {
    expect(
      nextTarget({ rule: RULE, target: held(60), workingSets: 3, sessions: [hold(90, 90, 90)] }),
    ).toEqual(held(65))
  })

  test('a short hold on any set holds the target', () => {
    expect(
      nextTarget({ rule: RULE, target: held(60), workingSets: 3, sessions: [hold(60, 60, 45)] }),
    ).toEqual(held(60))
  })

  test('an unrecorded hold blocks advancement', () => {
    const partial: SessionAttempts = [{ durationS: 60 }, { durationS: null }, { durationS: 60 }]
    expect(
      nextTarget({ rule: RULE, target: held(60), workingSets: 3, sessions: [partial] }),
    ).toEqual(held(60))
  })

  test('no duration target -> unchanged', () => {
    expect(
      nextTarget({
        rule: RULE,
        target: target(10, 60),
        workingSets: 3,
        sessions: [hold(60, 60, 60)],
      }),
    ).toEqual(target(10, 60))
  })
})

/**
 * Runs and rows (#14) go further at the pace the plan prescribes: the time grows with the distance,
 * so a volume step never hides a pace jump. Going faster is left to the user or the AI — a shorter
 * target time would break advance-or-hold. See docs/adr/0012-progression-rules.md.
 */
describe('nextTarget — linear_distance (runs, rows)', () => {
  const RULE: Progression = { kind: 'linear_distance', incrementMm: 500_000, afterSuccesses: 1 }
  const covered = (metres: number, seconds: number | null): SetTarget => ({
    reps: null,
    weightG: null,
    rpe: null,
    durationS: seconds,
    distanceMm: metres * 1000,
  })
  const ran = (...efforts: [metres: number, seconds: number | null][]): SessionAttempts =>
    efforts.map(([metres, durationS]) => ({ distanceMm: metres * 1000, durationS }))
  const next = (t: SetTarget, sessions: SessionAttempts[], workingSets = 1, rule = RULE) =>
    nextTarget({ rule, target: t, workingSets, sessions })

  test('the distance within the time adds distance, at the same pace', () => {
    expect(next(covered(5000, 1800), [ran([5000, 1800])])).toEqual(covered(5500, 1980))
  })

  test('faster than prescribed still advances by one step, at the prescribed pace', () => {
    expect(next(covered(5000, 1800), [ran([5000, 1740])])).toEqual(covered(5500, 1980))
  })

  test('the distance outside the time holds', () => {
    expect(next(covered(5000, 1800), [ran([5000, 1860])])).toEqual(covered(5000, 1800))
  })

  test('short of the distance holds, however fast', () => {
    expect(next(covered(5000, 1800), [ran([4800, 1680])])).toEqual(covered(5000, 1800))
  })

  test('no time recorded against a prescribed time holds', () => {
    expect(next(covered(5000, 1800), [ran([5000, null])])).toEqual(covered(5000, 1800))
  })

  test('with no time prescribed, the distance alone advances it, and no time is added', () => {
    expect(next(covered(5000, null), [ran([5000, null])])).toEqual(covered(5500, null))
  })

  test('the time grows to whole seconds', () => {
    // 3 km in 1000 s is 0.333 s/m: 3.5 km takes 1166.67 s.
    expect(next(covered(3000, 1000), [ran([3000, 1000])])).toEqual(covered(3500, 1167))
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

  test('afterSuccesses=2 requires two consecutive clean sessions', () => {
    const rule: Progression = { ...RULE, afterSuccesses: 2 }
    const t = covered(5000, 1800)
    const clean = ran([5000, 1800])
    const missed = ran([4000, 1800])
    expect(next(t, [clean], 1, rule)).toEqual(t)
    expect(next(t, [clean, missed], 1, rule)).toEqual(t)
    expect(next(t, [clean, clean], 1, rule)).toEqual(covered(5500, 1980))
  })

  test('warm-ups are excluded', () => {
    const session: SessionAttempts = [
      { distanceMm: 1_000_000, durationS: 420, isWarmup: true },
      ...ran([5000, 1800]),
    ]
    expect(next(covered(5000, 1800), [session])).toEqual(covered(5500, 1980))
  })

  test('no distance target, or no history -> unchanged', () => {
    expect(next(held(60), [ran([5000, 1800])])).toEqual(held(60))
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
