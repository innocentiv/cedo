import type { WorkoutPlanInput } from '@cedo/contract'

/**
 * The pure parts of writing a plan: rows from its input, and the guard that names an id the write
 * lost. Beside `write-plan.ts`, which holds the statements.
 */

/** One entry of a plan as it is written. */
export type EntryInput = WorkoutPlanInput['days'][number]['entries'][number]

/** Flattens one entry's prescribed sets. `index` is array position, as at every other level. */
export function setsFor(entry: EntryInput, entryId: string, ownerGroupId: string) {
  return entry.sets.map((set, index) => ({
    entryId,
    ownerGroupId,
    index,
    isWarmup: set.isWarmup,
    targetReps: set.targetReps,
    targetWeightG: set.targetWeightG,
    targetReserve: set.targetReserve,
    targetDurationS: set.targetDurationS,
    targetDistanceMm: set.targetDistanceMm,
  }))
}

/** Names what went missing, because "invalid input syntax for type uuid" names nothing. */
export function required(id: string | undefined, what: string): string {
  if (id === undefined) throw new Error(`writePlan lost the id for ${what}`)
  return id
}
