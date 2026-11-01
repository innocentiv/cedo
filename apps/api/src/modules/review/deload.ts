import {
  type EffortDrift,
  type Falling,
  type LoggedExercise,
  type RatedEffort,
  compareEfforts,
  estimatedMax,
  topSet,
} from '@cedo/contract'
import { type WorkingSet, sessionsByExercise, stalledOf } from './stalled.ts'

export type { WorkingSet } from './stalled.ts'

/**
 * The deload signals `training_review` gives the AI, which deloads by saving a lighter plan — the
 * progression rule never lowers a weight by itself (ADR-0012). The evidence's triggers, computed
 * rather than left to be read off raw logs: performance down across sessions, and effort up at the
 * same load (Bell et al., Sports Med Open 2023 — expert consensus; Rogerson et al., Sports Med
 * Open 2024). Pure, over the sets the review loads for stalls: each exercise's latest sessions.
 */

/** A fall is the estimated max lower in each of at least this many latest sessions. */
export const FALLING_SESSIONS = 2

/** Effort drift is RPE up by at least this much, at the same set. */
export const DRIFT_RPE = 1

/** The latest sessions that must each have drifted: one hard session is a bad day. */
export const DRIFT_SESSIONS = 2

/**
 * A weight lift whose best estimated max fell in each of its latest `FALLING_SESSIONS` sessions or
 * more, consecutively. A session with nothing to estimate ends the run: it says nothing either way.
 *
 * Estimated from what was LIFTED — weight and reps — with the reserve left out. Counted, the same
 * set rated half a point harder each time reads as a fall of rating noise, and as the one cause
 * effort drift already says. A bodyweight lift has no estimated max (`estimate.ts`), so cannot fall.
 */
export function fallingOf(sets: readonly WorkingSet[]): Falling[] {
  return sessionsByExercise(sets).flatMap(({ exercise, sessions }) => {
    const best = sessions.map((efforts) => bestLifted(efforts, exercise))
    // The first session not below the one before it; the oldest never is, having none.
    const drops = best.findIndex((now, s) => {
      const before = best[s + 1]
      return now === null || before == null || now >= before
    })
    const [toG] = best
    const fromG = best[drops]
    if (drops < FALLING_SESSIONS || toG == null || fromG == null) return []
    return [{ exercise, sessions: drops, fromG, toG }]
  })
}

function bestLifted(efforts: readonly RatedEffort[], exercise: LoggedExercise): number | null {
  const estimates = efforts.flatMap(
    (e) => estimatedMax({ ...e, rpe: null }, exercise.tracking) ?? [],
  )
  return estimates.length === 0 ? null : Math.max(...estimates)
}

/**
 * The same set — the latest top set, as its mode measures it — rated at least `DRIFT_RPE` higher
 * in EACH of the latest `DRIFT_SESSIONS` sessions than on average before them. Each session on its
 * own, so one hard set, or one hard session, is not drift: self-reported RPE is off by about one,
 * and is read across sessions (Halperin et al., Sports Med 2022). Every session weighs the same,
 * before and since, whatever its number of sets. A heavier set, or more reps, is harder by its load
 * and is not compared — so a latest session that added load has nothing before it to drift from.
 */
export function effortDriftOf(sets: readonly WorkingSet[]): EffortDrift[] {
  return sessionsByExercise(sets).flatMap(({ exercise, sessions }) => {
    const [latest] = sessions
    const target = latest === undefined ? undefined : topSet(latest, exercise.tracking)
    if (target === undefined) return []
    // Each session's average rating of that set, when it was logged and rated there.
    const rated = sessions.map((efforts) => {
      const ratings = efforts.flatMap((e) =>
        e.rpe != null && compareEfforts(e, target, exercise.tracking) === 0 ? [e.rpe] : [],
      )
      return ratings.length === 0 ? [] : [mean(ratings)]
    })
    const recent = rated.slice(0, DRIFT_SESSIONS).flat()
    const earlier = rated.slice(DRIFT_SESSIONS).flat()
    if (recent.length < DRIFT_SESSIONS || earlier.length === 0) return []
    const before = mean(earlier)
    if (recent.some((m) => m - before < DRIFT_RPE)) return []
    const { reps, weightG, durationS, distanceMm } = target
    return [
      {
        exercise,
        effort: { reps, weightG, durationS, distanceMm },
        fromRpe: oneDecimal(before),
        toRpe: oneDecimal(mean(recent)),
      },
    ]
  })
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length

const oneDecimal = (value: number): number => Math.round(value * 10) / 10

/** What the latest sessions say: stalled, falling, drifting — the AI's signals to change something. */
export const judgedOver = (sets: readonly WorkingSet[]) => ({
  stalled: stalledOf(sets),
  falling: fallingOf(sets),
  effortDrift: effortDriftOf(sets),
})
