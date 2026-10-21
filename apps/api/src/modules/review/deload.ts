import {
  type Effort,
  type LoggedExercise,
  compareEfforts,
  estimatedMax,
  topSet,
} from '@cedo/contract'
import { type RatedEffort, type WorkingSet, sessionsByExercise } from './stalled.ts'

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

export interface Falling {
  readonly exercise: LoggedExercise
  /** How many latest sessions running each fell below the one before. */
  readonly sessions: number
  /** The estimated max before the fall, and now — grams. */
  readonly from: number
  readonly to: number
}

export interface EffortDrift {
  readonly exercise: LoggedExercise
  /** The set compared: the latest top set, as its mode measures it. */
  readonly effort: Effort
  /** Its average RPE before, and over the latest sessions — to one decimal. */
  readonly from: number
  readonly to: number
}

/**
 * A weight lift whose best estimated max fell in each of its latest `FALLING_SESSIONS` sessions or
 * more, consecutively. A session with nothing to estimate breaks the run: it says nothing either way.
 */
export function fallingOf(sets: readonly WorkingSet[]): Falling[] {
  return sessionsByExercise(sets).flatMap(({ exercise, sessions }) => {
    const best = sessions.map((efforts) => bestEstimate(efforts, exercise))
    let drops = 0
    for (;;) {
      const [now, before] = [best[drops], best[drops + 1]]
      if (now === undefined || now === null || before === undefined || before === null) break
      if (now >= before) break
      drops += 1
    }
    const [to, from] = [best[0], best[drops]]
    if (drops < FALLING_SESSIONS || to === undefined || to === null) return []
    if (from === undefined || from === null) return []
    return [{ exercise, sessions: drops, from, to }]
  })
}

function bestEstimate(efforts: readonly RatedEffort[], exercise: LoggedExercise): number | null {
  const estimates = efforts.flatMap(
    (e) => estimatedMax({ ...e, rpe: e.rpe ?? null }, exercise.tracking) ?? [],
  )
  return estimates.length === 0 ? null : Math.max(...estimates)
}

/**
 * The same set — the latest top set, as its mode measures it — rated at least `DRIFT_RPE` higher
 * in EACH of the latest `DRIFT_SESSIONS` sessions than on average before them. Each session on its
 * own, so one hard set, or one hard session, is not drift: self-reported RPE is off by about one,
 * and is read across sessions (Halperin et al., Sports Med 2022). A heavier set, or more reps, is
 * harder by its load, and is not compared.
 */
export function effortDriftOf(sets: readonly WorkingSet[]): EffortDrift[] {
  return sessionsByExercise(sets).flatMap(({ exercise, sessions }) => {
    const [latest] = sessions
    const target = latest === undefined ? undefined : topSet(latest, exercise.tracking)
    if (target === undefined) return []
    const ratings = sessions.map((efforts) =>
      efforts.flatMap((e) =>
        e.rpe != null && compareEfforts(e, target, exercise.tracking) === 0 ? [e.rpe] : [],
      ),
    )
    const recent = ratings.slice(0, DRIFT_SESSIONS)
    const earlier = ratings.slice(DRIFT_SESSIONS).flat()
    if (recent.length < DRIFT_SESSIONS || recent.some((r) => r.length === 0)) return []
    if (earlier.length === 0) return []
    const before = mean(earlier)
    const sessionMeans = recent.map((r) => mean(r))
    if (sessionMeans.some((m) => m - before < DRIFT_RPE)) return []
    const { reps, weightG, durationS, distanceMm } = target
    return [
      {
        exercise,
        effort: { reps, weightG, durationS, distanceMm },
        from: oneDecimal(before),
        to: oneDecimal(mean(sessionMeans)),
      },
    ]
  })
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length

const oneDecimal = (value: number): number => Math.round(value * 10) / 10
