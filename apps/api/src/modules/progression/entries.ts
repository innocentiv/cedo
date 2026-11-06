import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { type Database, type Transaction, db } from '../../db/client.ts'
import { progressionSteps } from '../../db/schema.ts'
import { visibleExercises, visibleWorkoutEntries, visibleWorkoutSets } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { planEntries } from '../workout/plan.ts'
import type { LatestStep } from './evaluate.ts'

/**
 * What progression reads (#36 moved it here, for a plan's targets and a session's alike): the
 * entries, their prescribed sets, and the caller's latest step on each.
 */

/**
 * The entries to evaluate — of one day when `dayId` names one — their prescribed sets, and the
 * caller's latest step on each. Null when there is no entry the caller can see.
 */
export async function loadEntries(
  caller: Caller,
  workoutId: string,
  dayId: string | null,
  /** A write's transaction, when one reads: its connection, and what it has written. */
  on: Database | Transaction = db,
) {
  const plan = planEntries(caller, workoutId)
  const exercises = visibleExercises(caller)
  const entries = await on
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
     * An INNER join onto the visible exercises: without it a target returns the name and
     * prescribed load of an exercise the caller cannot see. Entries whose exercise is hidden simply
     * do not appear — there is nothing useful to advise about a movement you cannot read.
     */
    .innerJoin(exercises, eq(exercises.id, plan.exerciseId))
    .where(dayId === null ? undefined : eq(plan.dayId, dayId))
    .orderBy(asc(plan.dayIndex), asc(plan.index))
  if (entries.length === 0) return null

  const entryIds = entries.map((e) => e.id)

  const sets = visibleWorkoutSets(caller)
  const prescribed = await on
    .select()
    .from(sets)
    .where(inArray(sets.entryId, entryIds))
    .orderBy(asc(sets.index))

  return { entries, prescribed, steps: await latestSteps(caller, entryIds, on) }
}

/**
 * The caller's latest step on each entry, and how many finished sessions took one there — one
 * query for a whole plan, walking `progression_steps_target_idx`. Only the CALLER's own: steps are
 * personal, so one person's progress never moves another's target on a shared plan.
 */
async function latestSteps(
  caller: Caller,
  entryIds: readonly string[],
  on: Database | Transaction,
): Promise<LatestStep[]> {
  // Through the visible entries (ADR-0019): a target is advice about an entry the caller can see.
  const visible = visibleWorkoutEntries(caller)
  const ranked = db
    .select({
      entryId: progressionSteps.entryId,
      target: progressionSteps.target,
      held: progressionSteps.held,
      against: progressionSteps.against,
      rank: sql<number>`row_number() over (partition by ${progressionSteps.entryId} order by ${progressionSteps.takenAt} desc, ${progressionSteps.id} desc)`.as(
        'rank',
      ),
      sessions:
        sql<number>`count(*) filter (where ${progressionSteps.kind} = 'session') over (partition by ${progressionSteps.entryId})`
          .mapWith(Number)
          .as('sessions'),
    })
    .from(progressionSteps)
    .innerJoin(visible, eq(visible.id, progressionSteps.entryId))
    .where(
      and(
        eq(progressionSteps.userId, caller.userId),
        inArray(progressionSteps.entryId, [...entryIds]),
      ),
    )
    .as('ranked_steps')
  return await on
    .select({
      entryId: ranked.entryId,
      target: ranked.target,
      held: ranked.held,
      against: ranked.against,
      sessions: ranked.sessions,
    })
    .from(ranked)
    .where(sql`${ranked.rank} = 1`)
}
