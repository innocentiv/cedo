import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { type WorkoutDay, type WorkoutEntry, setTargetOf } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupBy } from '../../lib/keyset.ts'
import { exerciseFavourites } from '../../db/schema.ts'
import {
  type WorkoutSetRow,
  visibleExercises,
  visibleWorkoutDays,
  visibleWorkoutEntries,
  visibleWorkoutSets,
} from '../../db/visible.ts'
import { hydrate as hydrateExercises } from '../exercise/mapper.ts'
import type { Caller } from '../../plugins/auth.ts'

/** Day counts for many workouts in one grouped query, not one per workout. */
export async function dayCounts(
  caller: Caller,
  workoutIds: string[],
): Promise<Map<string, number>> {
  if (workoutIds.length === 0) return new Map()
  const days = visibleWorkoutDays(caller)
  const counts = await db
    .select({ workoutId: days.workoutId, days: count() })
    .from(days)
    .where(inArray(days.workoutId, workoutIds))
    .groupBy(days.workoutId)
  return new Map(counts.map((c) => [c.workoutId, c.days]))
}

/**
 * The entries of one workout that the caller can read, as a relation to select from or join onto:
 * each visible entry of a visible day of that workout.
 *
 * Every question about "the entries of this plan" asks it — reading the plan, progression, logging
 * against an entry, and what a transfer carries. Each used to write the entries ⋈ days join for
 * itself. Order by `dayIndex`, then `index`, for plan order: a subquery's own ORDER BY is not kept.
 *
 * No plan, no entries: a session without one can join this like any other, and finds nothing.
 */
export function planEntries(caller: Caller, workoutId: string | null) {
  const entries = visibleWorkoutEntries(caller)
  const days = visibleWorkoutDays(caller)
  return db
    .select({
      id: entries.id,
      dayId: entries.dayId,
      // Aliased: the day's `index` and the entry's would otherwise be two columns of one name.
      dayIndex: sql<number>`${days.index}`.as('day_index'),
      index: entries.index,
      exerciseId: entries.exerciseId,
      supersetGroup: entries.supersetGroup,
      restSeconds: entries.restSeconds,
      cue: entries.cue,
      progression: entries.progression,
    })
    .from(entries)
    .innerJoin(days, eq(days.id, entries.dayId))
    .where(workoutId === null ? sql`false` : eq(days.workoutId, workoutId))
    .as('plan_entries')
}

/** The plan's entries in plan order — of one day, when `dayId` names one. */
async function readEntries(caller: Caller, workoutId: string, dayId: string | null) {
  const entries = planEntries(caller, workoutId)
  return await db
    .select()
    .from(entries)
    .where(dayId === null ? undefined : eq(entries.dayId, dayId))
    .orderBy(asc(entries.dayIndex), asc(entries.index))
}

type PlanEntryRow = Awaited<ReturnType<typeof readEntries>>[number]

/**
 * A plan is three levels deep — days, entries, sets — with a full exercise on every entry. Loading
 * that per row is the worst N+1 in the codebase; done level by level it is a FIXED number of
 * queries no matter how large the plan:
 *
 *   1. days for the workout
 *   2. its entries — `planEntries`
 *   3. sets for all those entries, in one `inArray`
 *   4-8. the exercises: their rows, the caller's favourites among them, their muscles, their media,
 *        and what the athlete judged for has to train with — whether each is doable (#35)
 *
 * Eight queries for a workout with one day or with fourteen. `n1.test.ts` asserts exactly that.
 * See docs/adr/0018-n1-detection.md.
 *
 * Every level reads through its visible relation, so this needs no prior check on the workout to be
 * safe: a plan the caller cannot read has no days to return.
 */
export async function hydratePlan(
  caller: Caller,
  workoutId: string,
  /** Whose equipment says what is doable: the caller's, or an athlete's they plan for (#35). */
  judgedFor: string = caller.userId,
): Promise<WorkoutDay[]> {
  return await hydrate(caller, workoutId, null, judgedFor)
}

/**
 * One day of a plan, as the caller can reach it — the day a session follows — or null when they
 * cannot: the plan is in a group they have left, or the day is gone. The same reads as
 * `hydratePlan`, narrowed to the day, so its cost does not grow with the rest of the plan.
 */
export async function hydrateDay(
  caller: Caller,
  workoutId: string,
  dayId: string,
  judgedFor: string = caller.userId,
): Promise<WorkoutDay | null> {
  const [day] = await hydrate(caller, workoutId, dayId, judgedFor)
  return day ?? null
}

async function hydrate(
  caller: Caller,
  workoutId: string,
  dayId: string | null,
  judgedFor: string,
): Promise<WorkoutDay[]> {
  const loaded = await loadPlan(caller, workoutId, dayId, judgedFor)
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
async function loadPlan(
  caller: Caller,
  workoutId: string,
  dayId: string | null,
  judgedFor: string,
) {
  const visibleDays = visibleWorkoutDays(caller)
  const days = await db
    .select()
    .from(visibleDays)
    .where(
      and(
        eq(visibleDays.workoutId, workoutId),
        dayId === null ? undefined : eq(visibleDays.id, dayId),
      ),
    )
    .orderBy(asc(visibleDays.index))
  if (days.length === 0) return null

  const entries = await readEntries(caller, workoutId, dayId)

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
  const exerciseById = await hydrateExerciseRows(exerciseIds, caller, judgedFor)

  return { days, entries, sets, exerciseById }
}

type ExerciseById = Map<string, Awaited<ReturnType<typeof hydrateExercises>>[number]>

/**
 * An exercise can become invisible AFTER a workout was shared — a membership is removed, or the
 * exercise is transferred away. Reported as `exercise: null` rather than thrown or omitted: the
 * plan stays legible and the prescribed sets still make sense, while nothing about the hidden
 * exercise escapes. `assertPlanCanUse` blocks creating this state in the first place; this is the
 * defence for when it happens anyway. See docs/03-domain-model.md.
 */
function toEntry(
  entry: PlanEntryRow,
  sets: readonly WorkoutSetRow[],
  exerciseById: ExerciseById,
): WorkoutEntry {
  return {
    id: entry.id,
    index: entry.index,
    exerciseId: entry.exerciseId,
    exercise: exerciseById.get(entry.exerciseId) ?? null,
    supersetGroup: entry.supersetGroup,
    restSeconds: entry.restSeconds,
    cue: entry.cue,
    progression: entry.progression,
    sets: sets.map((set) => ({
      id: set.id,
      index: set.index,
      isWarmup: set.isWarmup,
      target: setTargetOf(set),
    })),
  }
}

async function hydrateExerciseRows(
  ids: string[],
  caller: Caller,
  judgedFor: string,
): Promise<ExerciseById> {
  if (ids.length === 0) return new Map()

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
    judgedFor,
  )
  return new Map(hydrated.map((e) => [e.id, e]))
}
