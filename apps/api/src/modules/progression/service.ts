import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { ProgressionSuggestion } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises, visibleWorkoutSets, visibleWorkouts } from '../../db/visible.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { heldBy } from '../equipment/held.ts'
import { planEntries } from '../workout/plan.ts'
import { suggest } from './evaluate.ts'

/**
 * How many past sessions a rule may look back over. `afterSuccesses` caps at 10, so ten is enough
 * for any rule, and it bounds the log read regardless of how long someone has been training.
 */
const HISTORY_DEPTH = 10

/**
 * Evaluates every entry in a workout against its logged history: loaded here, evaluated by the
 * pure `suggest` in ./evaluate.ts, whose maths is `nextTarget` from `@cedo/contract`. The
 * `workout_progression` MCP tool renders this answer. See docs/adr/0012-progression-rules.md.
 *
 * Deliberately batched: one query for the entries, one for their prescribed sets, one for the
 * caller's logs across all of them. A per-entry history query would be an N+1 that grows with the
 * size of the plan.
 */
export async function suggestForWorkout(
  caller: Caller,
  workoutId: string,
): Promise<ProgressionSuggestion[]> {
  const workouts = visibleWorkouts(caller)
  const [workout] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(eq(workouts.id, workoutId))
    .limit(1)
  if (workout === undefined) throw notFound('workout')

  const loaded = await loadEntries(caller, workoutId, null, null)
  if (loaded === null) return []
  return suggest(loaded.entries, loaded.prescribed, loaded.logs, await heldBy(caller.userId))
}

/**
 * The entries to evaluate — of one day when `dayId` names one — their prescribed sets, and the
 * caller's logs against them, from sessions started before `before` when it is given. Null when
 * there is no entry the caller can see.
 */
export async function loadEntries(
  caller: Caller,
  workoutId: string,
  dayId: string | null,
  before: Date | null,
) {
  const plan = planEntries(caller, workoutId)
  const exercises = visibleExercises(caller)
  const entries = await db
    .select({
      id: plan.id,
      exerciseId: plan.exerciseId,
      exerciseName: exercises.name,
      tracking: exercises.tracking,
      equipment: exercises.equipment,
      progression: plan.progression,
    })
    .from(plan)
    /**
     * An INNER join onto the visible exercises: without it a suggestion returns the name and
     * prescribed load of an exercise the caller cannot see. Entries whose exercise is hidden simply
     * do not appear — there is nothing useful to advise about a movement you cannot read.
     */
    .innerJoin(exercises, eq(exercises.id, plan.exerciseId))
    .where(dayId === null ? undefined : eq(plan.dayId, dayId))
    .orderBy(asc(plan.dayIndex), asc(plan.index))
  if (entries.length === 0) return null

  const entryIds = entries.map((e) => e.id)

  const sets = visibleWorkoutSets(caller)
  const prescribed = await db
    .select()
    .from(sets)
    .where(inArray(sets.entryId, entryIds))
    .orderBy(asc(sets.index))

  return { entries, prescribed, logs: await loadLogs(caller, entryIds, before) }
}

/**
 * Only the CALLER's own logs. Sessions are personal, so one user's history must never influence
 * another's suggestions, even when they share the workout.
 */
async function loadLogs(caller: Caller, entryIds: string[], before: Date | null) {
  /**
   * The depth cap is applied in SQL, per entry, via a window function.
   *
   * Truncating to `HISTORY_DEPTH` in JavaScript instead reads every log for every entry first: a
   * 48-entry plan with two years behind it fetches tens of thousands of rows to use the newest ten
   * sessions of each. The cap has to be where the rows are selected.
   */
  const ranked = db
    .select({
      entryId: setLogs.entryId,
      sessionId: setLogs.sessionId,
      setIndex: setLogs.setIndex,
      isWarmup: setLogs.isWarmup,
      weightG: setLogs.weightG,
      reps: setLogs.reps,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
      startedAt: workoutSessions.startedAt,
      rank: sql<number>`dense_rank() over (partition by ${setLogs.entryId} order by ${workoutSessions.startedAt} desc)`.as(
        'rank',
      ),
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(
      and(
        eq(workoutSessions.userId, caller.userId),
        inArray(setLogs.entryId, entryIds),
        before === null ? undefined : lt(workoutSessions.startedAt, before),
      ),
    )
    .as('ranked')

  return await db
    .select({
      entryId: ranked.entryId,
      sessionId: ranked.sessionId,
      setIndex: ranked.setIndex,
      isWarmup: ranked.isWarmup,
      weightG: ranked.weightG,
      reps: ranked.reps,
      durationS: ranked.durationS,
      distanceMm: ranked.distanceMm,
      startedAt: ranked.startedAt,
    })
    .from(ranked)
    .where(sql`${ranked.rank} <= ${HISTORY_DEPTH}`)
    .orderBy(desc(ranked.startedAt), asc(ranked.setIndex))
}
