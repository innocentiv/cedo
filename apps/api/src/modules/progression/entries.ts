import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises, visibleWorkoutSets } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { planEntries } from '../workout/plan.ts'

/**
 * What progression reads (#36 moved it here, for the plan's suggestions and a session's targets
 * alike): the entries, their prescribed sets, and the caller's logs against them.
 */

/**
 * How many past sessions a rule may look back over. `afterSuccesses` caps at 10, so ten is enough
 * for any rule, and it bounds the log read regardless of how long someone has been training.
 */
const HISTORY_DEPTH = 10

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
  const ranked = rankedLogs(caller, entryIds, before)
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
      reserve: ranked.reserve,
      startedAt: ranked.startedAt,
    })
    .from(ranked)
    .where(sql`${ranked.rank} <= ${HISTORY_DEPTH}`)
    .orderBy(desc(ranked.startedAt), asc(ranked.setIndex))
}

/**
 * The caller's logs against the entries, each ranked by its session's recency within its entry —
 * so the depth cap is applied in SQL, per entry, via a window function.
 *
 * Truncating to `HISTORY_DEPTH` in JavaScript instead reads every log for every entry first: a
 * 48-entry plan with two years behind it fetches tens of thousands of rows to use the newest ten
 * sessions of each. The cap has to be where the rows are selected.
 */
function rankedLogs(caller: Caller, entryIds: string[], before: Date | null) {
  return db
    .select({
      entryId: setLogs.entryId,
      sessionId: setLogs.sessionId,
      setIndex: setLogs.setIndex,
      isWarmup: setLogs.isWarmup,
      weightG: setLogs.weightG,
      reps: setLogs.reps,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
      reserve: setLogs.reserve,
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
}
