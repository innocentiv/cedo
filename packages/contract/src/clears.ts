import type { Held, SetAttempt, SessionAttempts, SetTarget } from './progression.ts'

/**
 * Judging what was logged against a prescription: whether a session clears it, one judge per
 * dimension a rule advances, each over the WORKING sets alone, in set order (warm-ups dropped by
 * `working`); whether a run of sessions does (`judgeRun`); and, when not, why it was held. Shared
 * by the rules in progression.ts; not part of the contract's surface. See
 * docs/adr/0012-progression-rules.md.
 */

/** What a session did to a prescription: cleared it, or held it, and why. */
export type Verdict = 'cleared' | Held

/** Held short of the targets — the reason with nothing to add to it. */
export const SHORT_OF_TARGETS: Held = { reason: 'targets' }

/**
 * How far past a prescribed RPE a set may be rated and still count (#45). Half a point: a person
 * logs whole reps in reserve, so against a whole RPE one rep fewer in reserve than prescribed holds,
 * and against a half — 7.5, written by a coach or an AI — the whole reserve just above it clears.
 */
const RPE_ALLOWANCE = 0.5

/**
 * Every prescribed working set met `goal`. A session with fewer sets than prescribed cannot clear
 * it — logging one set of an intended three is not a promotion — and sets past them are not judged.
 */
const everyWorkingSet = (
  session: SessionAttempts,
  workingSets: number,
  goal: (attempt: SetAttempt) => boolean,
): boolean =>
  session.length >= workingSets && session.slice(0, workingSets).every((attempt) => goal(attempt))

/**
 * No prescribed working set was rated more than the allowance past a prescribed RPE — the hardest
 * decides. An unrated set, or a prescription with no RPE, has nothing to go past.
 */
const withinEffort = (
  session: SessionAttempts,
  target: SetTarget,
  workingSets: number,
): boolean => {
  const { rpe: ceiling } = target
  if (ceiling === null) return true
  return session.slice(0, workingSets).every((attempt) => {
    const rpe = attempt.rpe ?? null
    return rpe === null || rpe <= ceiling + RPE_ALLOWANCE
  })
}

/**
 * The RPE of the hardest rated set of `sets` — the prescribed working sets of a session held for
 * effort, so at least one is rated past the RPE.
 */
const hardestRpe = (sets: SessionAttempts): number =>
  Math.max(...sets.map((attempt) => attempt.rpe ?? 0))

/**
 * A session clears a rep goal only when EVERY prescribed working set reached it at no less than the
 * target weight, and none was ground out past the prescribed RPE. A missing set, an unrecorded rep
 * count, or a lighter load fall short of the targets — which outranks the effort: a session that
 * missed its reps is told so, however hard it was. The goal is its own argument: double progression
 * asks for the top of its range, not the target.
 */
export function judgeReps(
  session: SessionAttempts,
  repGoal: number | null,
  target: SetTarget,
  workingSets: number,
): Verdict {
  if (repGoal === null) return SHORT_OF_TARGETS
  const reached = everyWorkingSet(session, workingSets, (attempt) => {
    const reps = attempt.reps ?? null
    if (reps === null || reps < repGoal) return false
    if (target.weightG === null) return true
    const weight = attempt.weightG ?? null
    // Against assistance (#19) — a bodyweight target only — unrecorded is no help: past any band.
    if (target.weightG < 0) return (weight ?? 0) >= target.weightG
    return weight !== null && weight >= target.weightG
  })
  if (!reached) return SHORT_OF_TARGETS
  if (withinEffort(session, target, workingSets)) return 'cleared'
  return { reason: 'effort', rpe: hardestRpe(session.slice(0, workingSets)) }
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
  if (goal === null) return SHORT_OF_TARGETS
  const held = everyWorkingSet(session, workingSets, (attempt) => {
    const time = attempt.durationS ?? null
    return time !== null && time >= goal
  })
  return held ? 'cleared' : SHORT_OF_TARGETS
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
  if (goal === null) return SHORT_OF_TARGETS
  const covered = everyWorkingSet(session, workingSets, (attempt) => {
    const distance = attempt.distanceMm ?? null
    if (distance === null || distance < goal) return false
    if (goalTime === null) return true
    const time = attempt.durationS ?? null
    return time !== null && time * goal <= goalTime * distance
  })
  return covered ? 'cleared' : SHORT_OF_TARGETS
}

/**
 * The most recent `count` sessions must all clear: `cleared` when they did, else the verdict of the
 * newest that did not — or null when none held it, and there are only too few of them yet.
 */
export function judgeRun(
  count: number,
  sessions: readonly SessionAttempts[],
  judge: (session: SessionAttempts) => Verdict,
): Verdict | null {
  for (const session of sessions.slice(0, count)) {
    const sets = working(session)
    const verdict = sets === null ? SHORT_OF_TARGETS : judge(sets)
    if (verdict !== 'cleared') return verdict
  }
  return sessions.length >= count ? 'cleared' : null
}

/** Drop warm-ups. Returns null when the session recorded nothing that counts. */
export function working(session: SessionAttempts): SessionAttempts | null {
  const sets = session.filter((s) => s.isWarmup !== true)
  return sets.length === 0 ? null : sets
}
