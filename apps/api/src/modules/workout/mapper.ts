import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Workout, WorkoutDay, WorkoutSummary } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupBy } from '../../lib/keyset.ts'
import {
  exerciseFavourites,
  exercises,
  workoutDays,
  workoutEntries,
  workoutSets,
} from '../../db/schema.ts'
import type { workouts } from '../../db/schema.ts'
import { visible } from '../../db/ownable.ts'
import { hydrate as hydrateExercises } from '../exercise/mapper.ts'
import type { Caller } from '../../plugins/auth.ts'

export type WorkoutRow = typeof workouts.$inferSelect

/**
 * A plan is three levels deep — days, entries, sets — with a full exercise on every entry. Loading
 * that per row is the worst N+1 in the codebase; done level by level it is a FIXED number of
 * queries no matter how large the plan:
 *
 *   1. days for the workout
 *   2. entries for all those days, in one `inArray`
 *   3. sets for all those entries, in one `inArray`
 *   4-7. the exercises: their rows, the caller's favourites among them, their muscles, their media
 *
 * Seven queries for a workout with one day or with fourteen. `n1.test.ts` asserts exactly that.
 * See docs/adr/0018-n1-detection.md.
 */
export async function hydratePlan(workoutId: string, caller: Caller): Promise<WorkoutDay[]> {
  const loaded = await loadPlan(workoutId, caller)
  if (loaded === null) return []
  const { days, entries, sets, exerciseById } = loaded

  const setsByEntry = groupBy(sets, (s) => s.entryId)
  const entriesByDay = groupBy(entries, (e) => e.dayId)

  return days.map((day) => ({
    id: day.id,
    index: day.index,
    name: day.name,
    entries: (entriesByDay.get(day.id) ?? []).map((entry) =>
      toEntry(entry, setsByEntry.get(entry.id) ?? [], exerciseById),
    ),
  }))
}

/** The four reads. Separated so the assembly above stays readable. */
async function loadPlan(workoutId: string, caller: Caller) {
  const days = await db
    .select()
    .from(workoutDays)
    .where(eq(workoutDays.workoutId, workoutId))
    .orderBy(asc(workoutDays.index))
  if (days.length === 0) return null

  const entries = await db
    .select()
    .from(workoutEntries)
    .where(
      inArray(
        workoutEntries.dayId,
        days.map((d) => d.id),
      ),
    )
    .orderBy(asc(workoutEntries.index))

  const sets =
    entries.length === 0
      ? []
      : await db
          .select()
          .from(workoutSets)
          .where(
            inArray(
              workoutSets.entryId,
              entries.map((e) => e.id),
            ),
          )
          .orderBy(asc(workoutSets.index))

  /**
   * Exercises are fetched once for the DISTINCT ids, then shared between entries. The same
   * exercise on day 1 and day 3 is one row read, not two.
   */
  const exerciseIds = [...new Set(entries.map((e) => e.exerciseId))]
  const exerciseById = await hydrateExerciseRows(exerciseIds, caller)

  return { days, entries, sets, exerciseById }
}

type EntryRow = typeof workoutEntries.$inferSelect
type SetRow = typeof workoutSets.$inferSelect
type ExerciseById = Map<string, Awaited<ReturnType<typeof hydrateExercises>>[number]>

/**
 * An exercise can become invisible AFTER a workout was shared — a membership is removed, or the
 * exercise is transferred away. Reported as `exercise: null` rather than thrown or omitted: the
 * plan stays legible and the prescribed sets still make sense, while nothing about the hidden
 * exercise escapes. `transfer` blocks creating this state in the first place; this is the defence
 * for when it happens anyway. See docs/03-domain-model.md.
 */
function toEntry(entry: EntryRow, sets: SetRow[], exerciseById: ExerciseById) {
  return {
    id: entry.id,
    index: entry.index,
    exerciseId: entry.exerciseId,
    exercise: exerciseById.get(entry.exerciseId) ?? null,
    supersetGroup: entry.supersetGroup,
    restSeconds: entry.restSeconds,
    progression: entry.progression,
    sets: sets.map((set) => ({
      id: set.id,
      index: set.index,
      isWarmup: set.isWarmup,
      target: {
        reps: set.targetReps,
        weightG: set.targetWeightG,
        rpe: set.targetRpe,
        durationS: set.targetDurationS,
        distanceMm: set.targetDistanceMm,
      },
    })),
  }
}

async function hydrateExerciseRows(ids: string[], caller: Caller) {
  if (ids.length === 0)
    return new Map<string, Awaited<ReturnType<typeof hydrateExercises>>[number]>()

  /**
   * `visible()` is NOT optional here. Without it a workout shared with a group hands every member
   * the full record — name, description, instructions, media — of exercises they cannot otherwise
   * see, which is invariant 5 in CLAUDE.md. Anything filtered out is redacted by the caller.
   */
  const rows = await db
    .select()
    .from(exercises)
    .where(and(visible(exercises, caller), inArray(exercises.id, ids)))

  // Fetched rather than assumed: passing an empty set would report `isFavourite: false` for an
  // exercise the caller has actually pinned.
  const pinned = await db
    .select({ targetId: exerciseFavourites.targetId })
    .from(exerciseFavourites)
    .where(
      and(eq(exerciseFavourites.userId, caller.userId), inArray(exerciseFavourites.targetId, ids)),
    )

  const hydrated = await hydrateExercises(rows, new Set(pinned.map((p) => p.targetId)), caller)
  return new Map(hydrated.map((e) => [e.id, e]))
}

export function toSummary(
  row: WorkoutRow,
  dayCount: number,
  isFavourite: boolean,
  caller: Caller,
): WorkoutSummary {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    dayCount,
    ownerGroupId: row.ownerGroupId,
    createdBy: row.createdBy,
    canEdit: caller.editorGroupIds.includes(row.ownerGroupId),
    isFavourite,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toWorkout(summary: WorkoutSummary, days: WorkoutDay[]): Workout {
  return { ...summary, days }
}
