import { z } from 'zod'
import { TargetDistanceMm, TargetDurationS, TargetReps, TargetWeightG } from './measurement.ts'
import type { Progression, SetTarget } from './progression.ts'
import { PLAN_WORDS } from './plan-words.ts'
import { unhandledKind } from './stored-rule.ts'

/**
 * A target set by hand (ADR-0026): what a person may say of where they are — `PUT
 * /workouts/:id/entries/:entryId/target`, and MCP's `target_set`. Only what the entry's rule moves;
 * reps in reserve are the plan's, which no rule moves.
 */
export const TargetByHand = z.strictObject({
  reps: TargetReps.optional().describe(
    'Reps your next session asks. Under double, inside its range.',
  ),
  weightG: TargetWeightG.optional().describe(PLAN_WORDS.targetWeightG),
  durationS: TargetDurationS.optional().describe(
    'Seconds your next session holds, under linear_duration.',
  ),
  distanceMm: TargetDistanceMm.optional().describe(
    'Distance in millimetres your next session covers, under linear_distance — its time follows at the plan’s pace.',
  ),
})
export type TargetByHand = z.output<typeof TargetByHand>

type Dimension = keyof TargetByHand
const DIMENSIONS: readonly Dimension[] = ['reps', 'weightG', 'durationS', 'distanceMm']

/**
 * The target a person sets by hand, from the one they have now — or why it is refused: a target
 * differs from its prescription only in what the rule moves (ADR-0026), so anything else is a plan
 * edit, and the refusal says so. Under double the reps stay inside the range; under a distance rule
 * the time follows the distance at the plan's pace, as an advance would.
 */
export function targetByHand(
  rule: Progression,
  from: SetTarget,
  input: TargetByHand,
): { readonly target: SetTarget } | { readonly refused: string } {
  const moves = movedBy(rule)
  if (moves === null) {
    return {
      refused: 'A manual entry has no target: its numbers are the plan’s, so change the plan',
    }
  }
  const fixed = DIMENSIONS.find(
    (d) => input[d] !== undefined && !moves.dimensions.includes(d) && input[d] !== from[d],
  )
  if (fixed !== undefined) return { refused: moves.refusal }
  if (rule.kind === 'double' && input.reps !== undefined) {
    const [low, high] = rule.repRange
    if (input.reps < low || input.reps > high) {
      return { refused: `Double ${low}–${high} asks ${low} to ${high} reps, not ${input.reps}` }
    }
  }
  const target: SetTarget = {
    reps: input.reps ?? from.reps,
    weightG: input.weightG ?? from.weightG,
    reserve: from.reserve,
    durationS: input.durationS ?? from.durationS,
    distanceMm: input.distanceMm ?? from.distanceMm,
  }
  if (rule.kind !== 'linear_distance' || input.distanceMm === undefined) return { target }
  return { target: { ...target, durationS: atPace(from, input.distanceMm) } }
}

/** What each rule moves, and what to say when something else is set. Null: no rule, no target. */
function movedBy(
  rule: Progression,
): { readonly dimensions: readonly Dimension[]; readonly refusal: string } | null {
  switch (rule.kind) {
    case 'none':
      return null
    case 'linear':
      return {
        dimensions: ['weightG'],
        refusal: 'Linear moves only the weight: change the plan to ask other reps',
      }
    case 'double':
      return { dimensions: ['reps', 'weightG'], refusal: 'Double moves only reps and weight' }
    case 'linear_duration':
      return {
        dimensions: ['durationS'],
        refusal: 'Linear duration moves only the time: change the plan for anything else',
      }
    case 'linear_distance':
      return {
        dimensions: ['distanceMm'],
        refusal:
          'Distance moves only the distance, its time at the plan’s pace: change the plan to ask another pace',
      }
    default:
      return unhandledKind(rule)
  }
}

/** The time a distance asks at `from`'s pace, to whole seconds rounded up — never a hair faster. */
const atPace = (from: SetTarget, distanceMm: number): number | null =>
  from.durationS === null || from.distanceMm === null
    ? null
    : Math.ceil((from.durationS * distanceMm) / from.distanceMm)
