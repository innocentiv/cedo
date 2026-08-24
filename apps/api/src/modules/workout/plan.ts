import { type Transaction } from '../../db/client.ts'
import type { WorkoutPlanInput } from '@cedo/contract'
import { workoutDays, workoutEntries, workoutSets } from '../../db/schema.ts'

/**
 * Writes a whole plan as THREE bulk inserts — one per level, never one statement per row.
 *
 * Each level needs the ids the level above just generated, so every insert takes them back with
 * `returning()` and the next level looks them up by POSITION: a day by its index, an entry by
 * `dayId:index`. Position is the only handle available, because the input carries no indices at all
 * — order is array position and the server assigns it. See docs/06-api.md.
 *
 * A missed lookup is a bug in this function and nothing else, so it throws rather than defaulting.
 * Feeding `''` to a uuid column instead produces a Postgres cast error three frames away that reads
 * like a caller's fault.
 */
export async function insertPlan(
  tx: Transaction,
  workoutId: string,
  plan: WorkoutPlanInput,
): Promise<void> {
  const days = await tx
    .insert(workoutDays)
    .values(plan.days.map((day, index) => ({ workoutId, index, name: day.name })))
    .returning({ id: workoutDays.id, index: workoutDays.index })

  const dayIdByIndex = new Map(days.map((d) => [d.index, d.id]))
  const dayId = (index: number): string => required(dayIdByIndex.get(index), `day ${index}`)

  const entryValues = plan.days.flatMap((day, dayIndex) =>
    day.entries.map((entry, index) => ({
      dayId: dayId(dayIndex),
      index,
      exerciseId: entry.exerciseId,
      supersetGroup: entry.supersetGroup,
      restSeconds: entry.restSeconds,
      progression: entry.progression,
    })),
  )
  if (entryValues.length === 0) return

  const insertedEntries = await tx
    .insert(workoutEntries)
    .values(entryValues)
    .returning({ id: workoutEntries.id, dayId: workoutEntries.dayId, index: workoutEntries.index })

  const entryIdByPosition = new Map(insertedEntries.map((e) => [`${e.dayId}:${e.index}`, e.id]))

  const setValues = plan.days.flatMap((day, dayIndex) =>
    day.entries.flatMap((entry, entryIndex) =>
      setsFor(
        entry,
        required(
          entryIdByPosition.get(`${dayId(dayIndex)}:${entryIndex}`),
          `entry ${dayIndex}:${entryIndex}`,
        ),
      ),
    ),
  )
  if (setValues.length > 0) await tx.insert(workoutSets).values(setValues)
}

/** Flattens one entry's prescribed sets. `index` is array position, as at every other level. */
function setsFor(entry: WorkoutPlanInput['days'][number]['entries'][number], entryId: string) {
  return entry.sets.map((set, index) => ({
    entryId,
    index,
    isWarmup: set.isWarmup,
    targetReps: set.targetReps,
    targetWeightG: set.targetWeightG,
    targetRpe: set.targetRpe,
    targetDurationS: set.targetDurationS,
    targetDistanceMm: set.targetDistanceMm,
  }))
}

/** Names what went missing, because "invalid input syntax for type uuid" names nothing. */
function required(id: string | undefined, what: string): string {
  if (id === undefined) throw new Error(`insertPlan lost the id for ${what}`)
  return id
}
