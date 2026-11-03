import { z } from 'zod'
import { TargetDistanceMm, TargetDurationS, TargetReps, TargetWeightG } from './measurement.ts'
import { Progression, type SetTarget } from './progression.ts'
import { Reserve } from './rpe.ts'

/**
 * What a step was taken against (ADR-0026): the prescription's dimensions — shared by every working
 * set under a rule — each working set's reps in reserve, and the rule with its settings. Stored on
 * the step, so a step counts only while they stand, and a correction re-judges a session against
 * the plan as it was then.
 */
export const Against = z.object({
  rule: Progression,
  reps: TargetReps.nullable(),
  weightG: TargetWeightG.nullable(),
  durationS: TargetDurationS.nullable(),
  distanceMm: TargetDistanceMm.nullable(),
  /** One per working set, in set order; how many there were is not compared. */
  reserves: z.array(Reserve.nullable()),
})
export type Against = z.output<typeof Against>

/**
 * How a step came about: a finished session judged by the entry's rule, or the person setting their
 * target themselves (GLOSSARY.md, "Step").
 */
export const STEP_KINDS = ['session', 'by_hand'] as const
export type StepKind = (typeof STEP_KINDS)[number]

/** A prescribed working set, as a plan holds it. */
interface WorkingSet {
  readonly targetReps: number | null
  readonly targetWeightG: number | null
  readonly targetReserve: number | null
  readonly targetDurationS: number | null
  readonly targetDistanceMm: number | null
}

/** What a step taken now is taken against: the entry's rule and its WORKING sets, in order. */
export function againstOf(rule: Progression, working: readonly WorkingSet[]): Against {
  const [first] = working
  return {
    rule,
    reps: first?.targetReps ?? null,
    weightG: first?.targetWeightG ?? null,
    durationS: first?.targetDurationS ?? null,
    distanceMm: first?.targetDistanceMm ?? null,
    reserves: working.map((s) => s.targetReserve),
  }
}

/** The prescription a step was taken against: where a target starts when no step counts. */
export const prescriptionIn = (against: Against): SetTarget => ({
  reps: against.reps,
  weightG: against.weightG,
  reserve: against.reserves[0] ?? null,
  durationS: against.durationS,
  distanceMm: against.distanceMm,
})

/**
 * Whether a step still counts: what it was taken against stands as the plan does now. Not the
 * number of working sets — adding a fourth keeps the target — but the reserve of every set both
 * have. Nothing is written when it stops counting, so putting the plan back restores it.
 */
export function stillCounts(taken: Against, now: Against): boolean {
  const shared = Math.min(taken.reserves.length, now.reserves.length)
  return (
    sameRule(taken.rule, now.rule) &&
    taken.reps === now.reps &&
    taken.weightG === now.weightG &&
    taken.durationS === now.durationS &&
    taken.distanceMm === now.distanceMm &&
    taken.reserves.slice(0, shared).every((reserve, i) => reserve === now.reserves[i])
  )
}

/** One rule, whatever order JSONB kept its settings in: compared as the schema writes it. */
const sameRule = (a: Progression, b: Progression): boolean =>
  JSON.stringify(Progression.parse(a)) === JSON.stringify(Progression.parse(b))
