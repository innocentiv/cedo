import type { SetAttempt, SessionAttempts, SetTarget } from './progression.ts'

/**
 * What a session must do to clear a prescription, one predicate per dimension a rule advances —
 * each over the WORKING sets alone, in set order. Shared by the rules in progression.ts; not part
 * of the contract's surface. See docs/adr/0012-progression-rules.md.
 */

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
 * A session clears a rep goal only when EVERY prescribed working set reached it at no less than the
 * target weight. A missing set, an unrecorded rep count, or a lighter load all mean "not cleared".
 * The goal is its own argument: double progression asks for the top of its range, not the target.
 */
export function clearsReps(
  session: SessionAttempts,
  repGoal: number | null,
  target: SetTarget,
  workingSets: number,
): boolean {
  if (repGoal === null) return false
  return everyWorkingSet(session, workingSets, (attempt) => {
    const reps = attempt.reps ?? null
    if (reps === null || reps < repGoal) return false
    if (target.weightG === null) return true
    const weight = attempt.weightG ?? null
    // Against assistance (#19) — a bodyweight target only — unrecorded is no help: past any band.
    if (target.weightG < 0) return (weight ?? 0) >= target.weightG
    return weight !== null && weight >= target.weightG
  })
}

/** Every prescribed working set must have been held for at least the target duration. */
export function clearsDuration(
  session: SessionAttempts,
  target: SetTarget,
  workingSets: number,
): boolean {
  const { durationS: goal } = target
  if (goal === null) return false
  return everyWorkingSet(session, workingSets, (attempt) => {
    const held = attempt.durationS ?? null
    return held !== null && held >= goal
  })
}

/**
 * Every prescribed working set covered at least the target distance — and, when a time is
 * prescribed, at no less than its pace: 6 km in 33:00 clears 5 km in 30:00. Unrecorded is not
 * covered. Compared multiplied out, in integers, so no pace is rounded to decide it.
 */
export function clearsDistance(
  session: SessionAttempts,
  target: SetTarget,
  workingSets: number,
): boolean {
  const { distanceMm: goal, durationS: goalTime } = target
  if (goal === null) return false
  return everyWorkingSet(session, workingSets, (attempt) => {
    const distance = attempt.distanceMm ?? null
    if (distance === null || distance < goal) return false
    if (goalTime === null) return true
    const time = attempt.durationS ?? null
    return time !== null && time * goal <= goalTime * distance
  })
}
