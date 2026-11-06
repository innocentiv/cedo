import type { Held, SetAttempt, SessionAttempts, SetTarget } from './progression.ts'

/**
 * Judging what was logged against a prescription: whether a session clears it, one judge per
 * dimension a rule advances, each over the WORKING sets alone, in set order (warm-ups dropped by
 * `working`); and, when not, why it was held — named by the working set that held it (ADR-0026).
 * Shared by the rules in step.ts; not part of the contract's surface. See
 * docs/adr/0012-progression-rules.md.
 */

/** What a session did to a prescription: cleared it, or held it, and why. */
export type Verdict = 'cleared' | Held

/** What a set did, as a hold names it: every dimension said, unrecorded as null. */
const didOf = (attempt: SetAttempt): SetTarget => ({
  reps: attempt.reps ?? null,
  weightG: attempt.weightG ?? null,
  reserve: attempt.reserve ?? null,
  durationS: attempt.durationS ?? null,
  distanceMm: attempt.distanceMm ?? null,
})

/**
 * Every prescribed working set met `goal` — or the first that did not, held short of `asked`, with
 * what it did, or null when it was not done. A session with fewer sets than prescribed cannot clear
 * it — logging one set of an intended three is not a promotion — and sets past them are not judged.
 */
function firstShort(
  session: SessionAttempts,
  workingSets: number,
  asked: SetTarget,
  goal: (attempt: SetAttempt) => boolean,
): Held | null {
  // No working set done at all is short at the first, however many were prescribed.
  if (session.length === 0) return { reason: 'targets', set: 1, did: null, asked }
  for (let i = 0; i < workingSets; i += 1) {
    const attempt = session[i]
    if (attempt === undefined) return { reason: 'targets', set: i + 1, did: null, asked }
    if (!goal(attempt)) return { reason: 'targets', set: i + 1, did: didOf(attempt), asked }
  }
  return null
}

/**
 * Whether a working set left fewer reps in reserve than its OWN set asked (ADR-0026): effort ramps
 * across sets, so set 3 may ask what set 1 does not. Both sides are whole (ADR-0027), so one rep
 * fewer than asked is past it, with no allowance. An unrated set, or a set that asks no reserve,
 * has nothing to go past.
 */
const pastItsReserve = (attempt: SetAttempt, asked: number | null): boolean => {
  const left = attempt.reserve ?? null
  return asked !== null && left !== null && left < asked
}

/**
 * The working set ground out furthest past what its own set asked — the one that left the fewest
 * reps in reserve, the first of them on a tie — or null when none was.
 */
function groundOut(session: SessionAttempts, asked: readonly (number | null)[]): Held | null {
  let worst: Held | null = null
  asked.forEach((reserve, i) => {
    const attempt = session[i]
    if (reserve === null || attempt === undefined || !pastItsReserve(attempt, reserve)) return
    const left = attempt.reserve ?? 0
    if (worst?.reason === 'effort' && worst.reserve <= left) return
    worst = { reason: 'effort', set: i + 1, reserve: left, asked: reserve }
  })
  return worst
}

/**
 * A session clears a rep goal only when EVERY prescribed working set reached it at no less than the
 * target weight, and none was ground out past the reserve its own set asked — `asked`, one per
 * working set, in set order. A missing set, an unrecorded rep count, or a lighter load fall short
 * of the targets — which outranks the effort: a session that missed its reps is told so, however
 * hard it was. The goal is its own argument: double progression asks for the top of its range, not
 * the target, at the top of it.
 */
export function judgeReps(
  session: SessionAttempts,
  repGoal: number | null,
  target: SetTarget,
  asked: readonly (number | null)[],
): Verdict {
  const goal: SetTarget = { ...target, reps: repGoal }
  const short = firstShort(session, asked.length, goal, (attempt) => {
    const reps = attempt.reps ?? null
    if (repGoal === null || reps === null || reps < repGoal) return false
    if (target.weightG === null) return true
    const weight = attempt.weightG ?? null
    // Against assistance (#19) — a bodyweight target only — unrecorded is no help: past any band.
    if (target.weightG < 0) return (weight ?? 0) >= target.weightG
    return weight !== null && weight >= target.weightG
  })
  return short ?? groundOut(session, asked) ?? 'cleared'
}

/**
 * Every prescribed working set must have been held for at least the target duration. A hold has no
 * reps to leave in reserve (#24), so it is never rated, and its effort is not judged.
 */
export function judgeDuration(
  session: SessionAttempts,
  target: SetTarget,
  workingSets: number,
): Verdict {
  const { durationS: goal } = target
  const short = firstShort(session, workingSets, target, (attempt) => {
    const time = attempt.durationS ?? null
    return goal !== null && time !== null && time >= goal
  })
  return short ?? 'cleared'
}

/**
 * Every prescribed working set covered at least the target distance — and, when a time is
 * prescribed, at no less than its pace: 6 km in 33:00 clears 5 km in 30:00. Unrecorded is not
 * covered. Compared multiplied out, in integers, so no pace is rounded to decide it. Like a hold, a
 * run is never rated.
 */
export function judgeDistance(
  session: SessionAttempts,
  target: SetTarget,
  workingSets: number,
): Verdict {
  const { distanceMm: goal, durationS: goalTime } = target
  const short = firstShort(session, workingSets, target, (attempt) => {
    const distance = attempt.distanceMm ?? null
    if (goal === null || distance === null || distance < goal) return false
    if (goalTime === null) return true
    const time = attempt.durationS ?? null
    return time !== null && time * goal <= goalTime * distance
  })
  return short ?? 'cleared'
}

/** Drop warm-ups. Returns null when the session recorded nothing that counts. */
export function working(session: SessionAttempts): SessionAttempts | null {
  const sets = session.filter((s) => s.isWarmup !== true)
  return sets.length === 0 ? null : sets
}
