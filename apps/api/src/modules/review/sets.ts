import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { STALL_DEPTH, type TrainingReview } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visibleExerciseMuscles, visibleExercises } from '../../db/visible.ts'
import type { Training } from '../coaching/training.ts'
import { liftedOf, setsOf } from '../session/sets-of.ts'
import { type WorkingSet, judgedOver } from './deload.ts'
import { muscleWorkOf } from './muscle-work.ts'

/**
 * What the review reads of the sets of a training (`setsOf`): the work per muscle of two periods,
 * and each exercise's latest working sets, judged.
 */

/** Each muscle's work this period beside the one before it: a trend, not a number on its own. */
export async function muscleWorkOver(
  training: Training,
  period: { readonly previousSince: Date; readonly since: Date; readonly until: Date },
): Promise<TrainingReview['muscleWork']> {
  return muscleWorkOf(
    await workBetween(training, period.since, period.until),
    await workBetween(training, period.previousSince, period.since),
  )
}

/** Each exercise's stall, fall and drift, judged over its latest working sets of the window. */
export const latestJudged = async (training: Training, since: Date) =>
  judgedOver(await latestWorkingSets(training, since))

/**
 * Per muscle: working sets, each counted by `load_pct / 100`, and `weight × reps × load_pct / 100`.
 * Warm-ups are excluded — they are not work. One query for the current window and one for the
 * window before it, so the trend is a comparison rather than a number with no context.
 */
async function workBetween(training: Training, from: Date, to: Date) {
  /**
   * A branch of this review held to the same rule as the latest working sets below and the day
   * balance (service.ts). Weaker
   * than those — it reveals a muscle slug, not a name — but it reads the CURRENT `load_pct` of an
   * exercise the caller may have lost access to, so their work would shift to reflect an edit
   * they cannot see. The muscles carry their exercise's owner, so their relation alone is the
   * gate. Leaving one of three inconsistent is how the next session concludes the rule does not
   * apply here.
   */
  const exerciseMuscles = visibleExerciseMuscles(training.reader)
  const sets = setsOf(training)
  return await db
    .select({
      muscle: exerciseMuscles.muscleSlug,
      sets: sql<number>`sum(${exerciseMuscles.loadPct}) / 100.0`.mapWith(Number),
      // What each set lifted (`liftedOf`: a bigint, assistance none), by the muscle's share of it.
      // One heavy sled set overflowing int4 once 500'd the whole window's review.
      lifted:
        sql<number>`coalesce(sum(${liftedOf(sets)} * ${exerciseMuscles.loadPct} / 100.0), 0)`.mapWith(
          Number,
        ),
    })
    .from(sets)
    .innerJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, sets.exerciseId))
    .where(
      and(
        eq(sets.isWarmup, false),
        gte(sets.startedAt, from),
        // `lt`, not raw sql: a JS Date interpolated into a template serialises via toString
        // ("Sun Aug 23 2026 ...") which Postgres cannot parse in a timestamp comparison.
        lt(sets.startedAt, to),
      ),
    )
    .groupBy(exerciseMuscles.muscleSlug)
}

/**
 * Each exercise's working sets in its latest `STALL_DEPTH` sessions of the window — what a stall,
 * a fall and a drift are all judged over (./stalled.ts, ./deload.ts), read once.
 */
async function latestWorkingSets(training: Training, since: Date): Promise<WorkingSet[]> {
  const ranked = latestSessions(training, since)
  const rows = await db
    .select()
    .from(ranked)
    .where(sql`${ranked.rank} <= ${STALL_DEPTH}`)
    // Newest session first, each session's sets together and in the order logged.
    .orderBy(desc(ranked.startedAt), desc(ranked.sessionId), asc(ranked.setIndex))
  return rows.map((r) => ({
    exerciseId: r.exerciseId,
    exercise: { name: r.name, tracking: r.tracking },
    sessionId: r.sessionId,
    effort: {
      reps: r.reps,
      weightG: r.weightG,
      durationS: r.durationS,
      distanceMm: r.distanceMm,
      reserve: r.reserve,
    },
  }))
}

/**
 * The athlete's working sets in the window, each with its exercise as the reader can still see it — an
 * INNER join onto the visible relation: an exercise can stop being visible after it was logged,
 * when a shared group loses them as a member, and there is nothing useful to say about a movement
 * whose name they cannot read. Omitted, as progression omits it (`step-rows.ts`).
 *
 * Each set is ranked by how recent its session is among that exercise's, so the loader keeps only
 * the latest `STALL_DEPTH` — capped in SQL with a window function, as progression's load is: two
 * years of a main lift reads ten sessions, not all. Ranked by start and then by id, so two sessions
 * started in the same instant still take two ranks, and the cap is exact.
 */
function latestSessions(training: Training, since: Date) {
  const exercises = visibleExercises(training.reader)
  const sets = setsOf(training)
  return db
    .select({
      exerciseId: exercises.id,
      name: exercises.name,
      tracking: exercises.tracking,
      sessionId: sets.sessionId,
      startedAt: sets.startedAt,
      reps: sets.reps,
      weightG: sets.weightG,
      durationS: sets.durationS,
      distanceMm: sets.distanceMm,
      reserve: sets.reserve,
      setIndex: sets.setIndex,
      rank: sql<number>`dense_rank() over (partition by ${exercises.id} order by ${sets.startedAt} desc, ${sets.sessionId} desc)`.as(
        'rank',
      ),
    })
    .from(sets)
    .innerJoin(exercises, eq(exercises.id, sets.exerciseId))
    .where(and(eq(sets.isWarmup, false), gte(sets.startedAt, since)))
    .as('ranked')
}
