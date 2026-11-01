import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { STALL_DEPTH, type TrainingReview } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import {
  visibleExerciseMuscles,
  visibleExercises,
  visibleWorkoutDays,
  visibleWorkouts,
} from '../../db/visible.ts'
import { type Training, sessionsOf } from '../session/service.ts'
import { aboutThem } from './about.ts'
import { adherenceOf } from './adherence.ts'
import { muscleWorkOf } from './muscle-work.ts'
import { judgedOver } from './deload.ts'

/** The thresholds the review judges by, for whoever says its signals. */
export { DRIFT_RPE, DRIFT_SESSIONS, FALLING_SESSIONS } from './deload.ts'
import type { WorkingSet } from './deload.ts'

/**
 * A READ MODEL for coaching, not new domain rules.
 *
 * Everything here is aggregation over data the API already exposes. It exists because the
 * alternative — the AI paging through every session and every log and doing date arithmetic itself
 * — is slow, expensive in context, and a reliable source of quiet mistakes. One call returns what a
 * coach would actually look at. See docs/07-mcp.md.
 */

const DAY_MS = 86_400_000

export async function trainingReview(training: Training, weeks: number): Promise<TrainingReview> {
  const since = new Date(Date.now() - weeks * 7 * DAY_MS)
  const previousSince = new Date(Date.now() - weeks * 14 * DAY_MS)

  const sessions = await db
    .select({
      id: workoutSessions.id,
      startedAt: workoutSessions.startedAt,
      dayId: workoutSessions.dayId,
    })
    .from(workoutSessions)
    .where(and(sessionsOf(training), gte(workoutSessions.startedAt, since)))
    .orderBy(desc(workoutSessions.startedAt))

  return {
    weeks,
    adherence: adherenceOf(sessions, weeks),
    dayBalance: await dayBalance(training, since),
    muscleWork: muscleWorkOf(
      await workBetween(training, since, new Date()),
      await workBetween(training, previousSince, since),
    ),
    ...judgedOver(await latestWorkingSets(training, since)),
    ...(await aboutThem(training, weeks)),
  }
}

/**
 * Every planned day of the workouts trained in the period, and how often each was — none, for a day
 * skipped every time (#28): a day never trained is the one most worth seeing, and counting from the
 * sessions alone left it out. In plan order, workout by workout.
 */
async function dayBalance(training: Training, since: Date): Promise<TrainingReview['dayBalance']> {
  const days = visibleWorkoutDays(training.reader)
  const workouts = visibleWorkouts(training.reader)
  const inPeriod = and(sessionsOf(training), gte(workoutSessions.startedAt, since))
  const trained = db
    .selectDistinct({ id: workoutSessions.workoutId })
    .from(workoutSessions)
    .where(inPeriod)
  const rows = await db
    .select({
      day: days.name,
      workout: workouts.name,
      sessions: sql<number>`count(${workoutSessions.id})`.mapWith(Number),
    })
    /**
     * INNER joins onto the visible relations, so a day whose workout is unreachable drops out
     * entirely — you cannot balance days you cannot see. A correlated subquery for the workout's
     * name (`select name from workouts where id = …`) is how this once named a workout the caller
     * had lost access to; there is no raw table left to write one against.
     */
    .from(days)
    .innerJoin(workouts, eq(workouts.id, days.workoutId))
    .leftJoin(workoutSessions, and(eq(workoutSessions.dayId, days.id), inPeriod))
    .where(inArray(days.workoutId, trained))
    /**
     * By ID, not by name. Two days can share a name across two plans, and two plans can share a
     * name outright — duplicating one is the documented way to get an editable copy. Grouping on
     * the text merges them into one row whose session count is the sum of both.
     */
    .groupBy(days.id, days.name, days.index, workouts.id, workouts.name)
    .orderBy(asc(workouts.name), asc(workouts.id), asc(days.index))

  return rows.map((r) => ({ day: r.day, workout: r.workout, sessions: r.sessions }))
}

/**
 * Per muscle: working sets, each counted by `load_pct / 100`, and `weight × reps × load_pct / 100`.
 * Warm-ups are excluded — they are not work. One query for the current window and one for the
 * window before it, so the trend is a comparison rather than a number with no context.
 */
async function workBetween(training: Training, from: Date, to: Date) {
  /**
   * The third branch of this review, held to the same rule as `stalled` and `dayBalance`. Weaker
   * than those — it reveals a muscle slug, not a name — but it reads the CURRENT `load_pct` of an
   * exercise the caller may have lost access to, so their work would shift to reflect an edit
   * they cannot see. The muscles carry their exercise's owner, so their relation alone is the
   * gate. Leaving one of three inconsistent is how the next session concludes the rule does not
   * apply here.
   */
  const exerciseMuscles = visibleExerciseMuscles(training.reader)
  return await db
    .select({
      muscle: exerciseMuscles.muscleSlug,
      sets: sql<number>`sum(${exerciseMuscles.loadPct}) / 100.0`.mapWith(Number),
      lifted:
        /**
         * `::bigint` on the first factor, or the PER-ROW product overflows int4 before the divide
         * ever happens: 500 kg × 50 reps × 100% is 2.5e9 against a 2.147e9 ceiling, and both those
         * inputs are well inside what the contract allows. It is not a rounding artefact — Postgres
         * raises `integer out of range`, so a single heavy sled set 500s that user's review for the
         * whole window, and the one before it, until the log is deleted. `greatest(…, 0)`:
         * negative added weight is assistance (#19) — help, not load, so it lifts nothing.
         */
        sql<number>`coalesce(sum(greatest(${setLogs.weightG}, 0)::bigint * ${setLogs.reps} * ${exerciseMuscles.loadPct} / 100.0), 0)`.mapWith(
          Number,
        ),
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .innerJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, setLogs.exerciseId))
    .where(
      and(
        sessionsOf(training),
        eq(setLogs.isWarmup, false),
        gte(workoutSessions.startedAt, from),
        // `lt`, not raw sql: a JS Date interpolated into a template serialises via toString
        // ("Sun Aug 23 2026 ...") which Postgres cannot parse in a timestamp comparison.
        lt(workoutSessions.startedAt, to),
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
      rpe: r.rpe,
    },
  }))
}

/**
 * The athlete's working sets in the window, each with its exercise as the reader can still see it — an
 * INNER join onto the visible relation: an exercise can stop being visible after it was logged,
 * when a shared group loses them as a member, and there is nothing useful to say about a movement
 * whose name they cannot read. Omitted, matching `progression/service.ts`.
 *
 * Each set is ranked by how recent its session is among that exercise's, so the loader keeps only
 * the latest `STALL_DEPTH` — capped in SQL with a window function, as progression's load is: two
 * years of a main lift reads ten sessions, not all. Ranked by start and then by id, so two sessions
 * started in the same instant still take two ranks, and the cap is exact.
 */
function latestSessions(training: Training, since: Date) {
  const exercises = visibleExercises(training.reader)
  return db
    .select({
      exerciseId: exercises.id,
      name: exercises.name,
      tracking: exercises.tracking,
      sessionId: setLogs.sessionId,
      startedAt: workoutSessions.startedAt,
      reps: setLogs.reps,
      weightG: setLogs.weightG,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
      rpe: setLogs.rpe,
      setIndex: setLogs.setIndex,
      rank: sql<number>`dense_rank() over (partition by ${exercises.id} order by ${workoutSessions.startedAt} desc, ${setLogs.sessionId} desc)`.as(
        'rank',
      ),
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .innerJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    .where(
      and(sessionsOf(training), eq(setLogs.isWarmup, false), gte(workoutSessions.startedAt, since)),
    )
    .as('ranked')
}
