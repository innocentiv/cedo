import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Workout, WorkoutDay, WorkoutSummary } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupBy } from '../../lib/keyset.ts'
import { exerciseFavourites } from '../../db/schema.ts'
import {
  type WorkoutEntryRow,
  type WorkoutRow,
  type WorkoutSetRow,
  visibleExercises,
  visibleWorkoutDays,
  visibleWorkoutEntries,
  visibleWorkoutSets,
} from '../../db/visible.ts'
import { hydrate as hydrateExercises } from '../exercise/mapper.ts'
import type { Caller } from '../../plugins/auth.ts'
import { ownableFieldsOf } from '../ownable/service.ts'

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
 *
 * Every level reads through its visible relation, so this needs no prior check on the workout to be
 * safe: a plan the caller cannot read has no days to return.
 */
export async function hydratePlan(caller: Caller, workoutId: string): Promise<WorkoutDay[]> {
  const loaded = await loadPlan(caller, workoutId)
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
async function loadPlan(caller: Caller, workoutId: string) {
  const visibleDays = visibleWorkoutDays(caller)
  const days = await db
    .select()
    .from(visibleDays)
    .where(eq(visibleDays.workoutId, workoutId))
    .orderBy(asc(visibleDays.index))
  if (days.length === 0) return null

  const visibleEntries = visibleWorkoutEntries(caller)
  const entries = await db
    .select()
    .from(visibleEntries)
    .where(
      inArray(
        visibleEntries.dayId,
        days.map((d) => d.id),
      ),
    )
    .orderBy(asc(visibleEntries.index))

  const visibleSets = visibleWorkoutSets(caller)
  const sets =
    entries.length === 0
      ? []
      : await db
          .select()
          .from(visibleSets)
          .where(
            inArray(
              visibleSets.entryId,
              entries.map((e) => e.id),
            ),
          )
          .orderBy(asc(visibleSets.index))

  /**
   * Exercises are fetched once for the DISTINCT ids, then shared between entries. The same
   * exercise on day 1 and day 3 is one row read, not two.
   */
  const exerciseIds = [...new Set(entries.map((e) => e.exerciseId))]
  const exerciseById = await hydrateExerciseRows(exerciseIds, caller)

  return { days, entries, sets, exerciseById }
}

type EntryRow = WorkoutEntryRow
type SetRow = WorkoutSetRow
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
   * Through the visible relation, never by id alone. A workout shared with a group would otherwise
   * hand every member the full record — name, description, instructions, media — of exercises
   * they cannot see, which is invariant 5 in CLAUDE.md. Anything absent is redacted by the caller.
   */
  const visible = visibleExercises(caller)
  const rows = await db.select().from(visible).where(inArray(visible.id, ids))

  // Fetched rather than assumed: passing an empty set would report `isFavourite: false` for an
  // exercise the caller has actually pinned.
  const pinned = await db
    .select({ targetId: exerciseFavourites.targetId })
    .from(exerciseFavourites)
    .where(
      and(eq(exerciseFavourites.userId, caller.userId), inArray(exerciseFavourites.targetId, ids)),
    )

  const pinnedIds = new Set(pinned.map((p) => p.targetId))
  const hydrated = await hydrateExercises(
    caller,
    rows.map((row) => ({ row, isFavourite: pinnedIds.has(row.id) })),
  )
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
    ...ownableFieldsOf(row, isFavourite, caller),
  }
}

export function toWorkout(summary: WorkoutSummary, days: WorkoutDay[]): Workout {
  return { ...summary, days }
}
