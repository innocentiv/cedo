import type { SessionAttempts, SetTarget } from './progression.ts'

/**
 * What a session must do to clear a prescription, one predicate per dimension a rule advances —
 * each over the WORKING sets alone, in set order. Shared by the rules in progression.ts; not part
 * of the contract's surface. See docs/adr/0012-progression-rules.md.
 */

/**
 * A session clears a rep goal only when EVERY prescribed working set reached it at no less than the
 * target weight. A missing set, an unrecorded rep count, or a lighter load all mean "not cleared".
 */
export function clearsReps(
  session: SessionAttempts,
  repGoal: number | null,
  target: SetTarget,
  workingSets: number,
): boolean {
  if (repGoal === null) return false
  if (session.length < workingSets) return false

  return session.slice(0, workingSets).every((attempt) => {
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
  durationGoal: number | null,
  workingSets: number,
): boolean {
  if (durationGoal === null) return false
  if (session.length < workingSets) return false

  return session.slice(0, workingSets).every((attempt) => {
    const held = attempt.durationS ?? null
    return held !== null && held >= durationGoal
  })
}

/**
 * Every prescribed working set covered at least the target distance — and, when a time is
 * prescribed, within it: at no less than the target pace. Unrecorded is not covered.
 */
export function clearsDistance(
  session: SessionAttempts,
  target: SetTarget,
  workingSets: number,
): boolean {
  const { distanceMm: distanceGoal, durationS: timeLimit } = target
  if (distanceGoal === null) return false
  if (session.length < workingSets) return false

  return session.slice(0, workingSets).every((attempt) => {
    const distance = attempt.distanceMm ?? null
    if (distance === null || distance < distanceGoal) return false
    if (timeLimit === null) return true
    const time = attempt.durationS ?? null
    return time !== null && time <= timeLimit
  })
}
