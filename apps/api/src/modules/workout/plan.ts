import { type Transaction } from '../../db/client.ts'
import type { WorkoutPlanInput } from '@cedo/contract'
import { workoutDays, workoutEntries, workoutSets } from '../../db/schema.ts'

/** Three bulk inserts, one per level — never one statement per row. */
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

  const entryValues = plan.days.flatMap((day, dayIndex) =>
    day.entries.map((entry, index) => ({
      dayId: dayIdByIndex.get(dayIndex) ?? '',
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
      entry.sets.map((set, index) => ({
        entryId: entryIdByPosition.get(`${dayIdByIndex.get(dayIndex) ?? ''}:${entryIndex}`) ?? '',
        index,
        isWarmup: set.isWarmup,
        targetReps: set.targetReps,
        targetWeightG: set.targetWeightG,
        targetRpe: set.targetRpe,
        targetDurationS: set.targetDurationS,
        targetDistanceMm: set.targetDistanceMm,
      })),
    ),
  )
  if (setValues.length > 0) await tx.insert(workoutSets).values(setValues)
}
