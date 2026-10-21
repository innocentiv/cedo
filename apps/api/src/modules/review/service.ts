import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { type LoggedExercise, STALL_DEPTH } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import {
  visibleExerciseMuscles,
  visibleExercises,
  visibleWorkoutDays,
  visibleWorkouts,
} from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { adherenceOf } from './adherence.ts'
import { muscleWorkOf } from './muscle-work.ts'
import { type EffortDrift, type Falling, effortDriftOf, fallingOf } from './deload.ts'

/** The thresholds the review judges by, for whoever says its signals. */
export { DRIFT_RPE, DRIFT_SESSIONS, FALLING_SESSIONS } from './deload.ts'
import { type RatedEffort, type WorkingSet, stalledOf } from './stalled.ts'

/**
 * A READ MODEL for coaching, not new domain rules.
 *
 * Everything here is aggregation over data the API already exposes. It exists because the
 * alternative — the AI paging through every session and every log and doing date arithmetic itself
 * — is slow, expensive in context, and a reliable source of quiet mistakes. One call returns what a
 * coach would actually look at. See docs/07-mcp.md.
 */

const DAY_MS = 86_400_000

export interface TrainingReview {
  readonly weeks: number
  readonly adherence: {
    readonly sessions: number
    readonly perWeek: number
    readonly currentStreakDays: number
    readonly longestGapDays: number
    readonly lastSessionAt: string | null
  }
  /** Which planned days actually get trained, and which get skipped. */
  readonly dayBalance: {
    readonly day: string
    readonly workout: string
    readonly sessions: number
  }[]
  /**
   * The work each muscle got, by its share of each exercise's load — this is what the muscle
   * percentages are FOR — compared against the equivalent window immediately before. What is worth
   * saying, not every muscle: the most worked, every declined muscle, and a count of the rest.
   * See muscle-work.ts.
   */
  readonly muscleWork: {
    /** The muscles worked most in this window, at most `TOP_MUSCLES`, most first. */
    readonly top: readonly MuscleWork[]
    /** Declined muscles not already in `top`, the most sets lost first. See GLOSSARY.md. */
    readonly declined: readonly MuscleWork[]
    /** Muscles worked in either window that neither list names. */
    readonly omitted: number
  }
  /**
   * Exercises that have stalled: the signal for "change something". See GLOSSARY.md, "Stalled".
   * Each carries the top set it keeps repeating, and how its exercise is measured — so it reads as
   * the app shows it: `6 × bodyweight +20 kg`, not a 20 kg lift; `1:00` for a plank, not nothing.
   */
  readonly stalled: {
    readonly exercise: LoggedExercise
    /** How many sessions running, the latest included, have shared that top set — at most ten. */
    readonly sessions: number
    /** The top set, and its RPE when one was said: its estimated max counts the reserve. */
    readonly effort: RatedEffort
  }[]
  /**
   * The deload triggers: weight lifts falling, and effort drift at the same set — see GLOSSARY.md
   * for each, and ./deload.ts for the thresholds. The AI's to act on, by saving a lighter plan
   * (ADR-0012).
   */
  readonly falling: readonly Falling[]
  readonly effortDrift: readonly EffortDrift[]
}

/**
 * Measured in WORKING SETS: a set of a 70/30 exercise is 0.7 of a set for one muscle and 0.3 for
 * the other. It used to be weight × reps alone, which a plank, a run or an unweighted pull-up
 * cannot register: a muscle trained only by those read "0 kg", as if untrained. Sets count every
 * tracking mode alike; weight × reps stays beside them as what was LIFTED, for loaded work.
 */
export interface MuscleWork {
  readonly muscle: string
  /**
   * Working sets, each counted by this muscle's share of the exercise's load — so fractional: a
   * set of a 70/30 exercise is 0.7 here. To one decimal; `changePct` compares the unrounded sums.
   */
  readonly weightedSets: number
  /** Weight × reps, in grams — 0 for work that carries no load. */
  readonly liftedG: number
  readonly changePct: number | null
}

export async function trainingReview(caller: Caller, weeks: number): Promise<TrainingReview> {
  const since = new Date(Date.now() - weeks * 7 * DAY_MS)
  const previousSince = new Date(Date.now() - weeks * 14 * DAY_MS)

  const sessions = await db
    .select({
      id: workoutSessions.id,
      startedAt: workoutSessions.startedAt,
      dayId: workoutSessions.dayId,
    })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, caller.userId), gte(workoutSessions.startedAt, since)))
    .orderBy(desc(workoutSessions.startedAt))

  return {
    weeks,
    adherence: adherenceOf(sessions, weeks),
    dayBalance: await dayBalance(caller, since),
    muscleWork: muscleWorkOf(
      await workBetween(caller, since, new Date()),
      await workBetween(caller, previousSince, since),
    ),
    ...judgedOver(await latestWorkingSets(caller, since)),
  }
}

async function dayBalance(caller: Caller, since: Date): Promise<TrainingReview['dayBalance']> {
  const days = visibleWorkoutDays(caller)
  const workouts = visibleWorkouts(caller)
  const rows = await db
    .select({
      day: days.name,
      workout: workouts.name,
      sessions: sql<number>`count(*)`.mapWith(Number),
    })
    .from(workoutSessions)
    /**
     * INNER joins onto the visible relations, so a day whose workout is unreachable drops out
     * entirely — you cannot balance days you cannot see. A correlated subquery for the workout's
     * name (`select name from workouts where id = …`) is how this once named a workout the caller
     * had lost access to; there is no raw table left to write one against.
     */
    .innerJoin(days, eq(days.id, workoutSessions.dayId))
    .innerJoin(workouts, eq(workouts.id, days.workoutId))
    .where(and(eq(workoutSessions.userId, caller.userId), gte(workoutSessions.startedAt, since)))
    /**
     * By ID, not by name. Two days can share a name across two plans, and two plans can share a
     * name outright — duplicating one is the documented way to get an editable copy. Grouping on
     * the text merges them into one row whose session count is the sum of both.
     */
    .groupBy(days.id, days.name, workouts.name)
    .orderBy(desc(sql`count(*)`))

  return rows.map((r) => ({ day: r.day, workout: r.workout, sessions: r.sessions }))
}

/**
 * Per muscle: working sets, each counted by `load_pct / 100`, and `weight × reps × load_pct / 100`.
 * Warm-ups are excluded — they are not work. One query for the current window and one for the
 * window before it, so the trend is a comparison rather than a number with no context.
 */
async function workBetween(caller: Caller, from: Date, to: Date) {
  /**
   * The third branch of this review, held to the same rule as `stalled` and `dayBalance`. Weaker
   * than those — it reveals a muscle slug, not a name — but it reads the CURRENT `load_pct` of an
   * exercise the caller may have lost access to, so their work would shift to reflect an edit
   * they cannot see. The muscles carry their exercise's owner, so their relation alone is the
   * gate. Leaving one of three inconsistent is how the next session concludes the rule does not
   * apply here.
   */
  const exerciseMuscles = visibleExerciseMuscles(caller)
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
         * whole window, and the one before it, until the log is deleted.
         */
        sql<number>`coalesce(sum(${setLogs.weightG}::bigint * ${setLogs.reps} * ${exerciseMuscles.loadPct} / 100.0), 0)`.mapWith(
          Number,
        ),
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .innerJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, setLogs.exerciseId))
    .where(
      and(
        eq(workoutSessions.userId, caller.userId),
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
async function latestWorkingSets(caller: Caller, since: Date): Promise<WorkingSet[]> {
  const ranked = latestSessions(caller, since)
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

/** What the latest sessions say: stalled, falling, drifting — the AI's signals to change something. */
const judgedOver = (sets: readonly WorkingSet[]) => ({
  stalled: stalledOf(sets),
  falling: fallingOf(sets),
  effortDrift: effortDriftOf(sets),
})

/**
 * The caller's working sets in the window, each with its exercise as they can still see it — an
 * INNER join onto the visible relation: an exercise can stop being visible after it was logged,
 * when a shared group loses them as a member, and there is nothing useful to say about a movement
 * whose name they cannot read. Omitted, matching `progression/service.ts`.
 *
 * Each set is ranked by how recent its session is among that exercise's, so the loader keeps only
 * the latest `STALL_DEPTH` — capped in SQL with a window function, as progression's load is: two
 * years of a main lift reads ten sessions, not all. Ranked by start and then by id, so two sessions
 * started in the same instant still take two ranks, and the cap is exact.
 */
function latestSessions(caller: Caller, since: Date) {
  const exercises = visibleExercises(caller)
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
      and(
        eq(workoutSessions.userId, caller.userId),
        eq(setLogs.isWarmup, false),
        gte(workoutSessions.startedAt, since),
      ),
    )
    .as('ranked')
}
