import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { DIMENSION_FIELDS, gToKg } from '@cedo/contract'
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
   * Volume attributed to each muscle by its share of the load — this is what the muscle
   * percentages are FOR. Compared against the equivalent window immediately before.
   */
  readonly muscleVolume: {
    readonly muscle: string
    readonly volumeKg: number
    readonly changePct: number | null
  }[]
  /** Exercises whose logged top set has not moved. The signal for "change something". */
  readonly stalled: {
    readonly exercise: string
    readonly sessions: number
    readonly bestWeightKg: number | null
    readonly bestReps: number | null
  }[]
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
    muscleVolume: await muscleVolume(caller, since, previousSince),
    stalled: await stalled(caller, since),
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
 * `weight × reps × (load_pct / 100)`, summed per muscle. Warm-ups are excluded — they are not work.
 * One query for the current window and one for the window before it, so the trend is a comparison
 * rather than a number with no context.
 */
async function volumeBetween(caller: Caller, from: Date, to: Date) {
  /**
   * The third branch of this review, held to the same rule as `stalled` and `dayBalance`. Weaker
   * than those — it reveals a muscle slug, not a name — but it reads the CURRENT `load_pct` of an
   * exercise the caller may have lost access to, so their volume would shift to reflect an edit
   * they cannot see. The muscles carry their exercise's owner, so their relation alone is the
   * gate. Leaving one of three inconsistent is how the next session concludes the rule does not
   * apply here.
   */
  const exerciseMuscles = visibleExerciseMuscles(caller)
  return await db
    .select({
      muscle: exerciseMuscles.muscleSlug,
      volume:
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

async function muscleVolume(
  caller: Caller,
  since: Date,
  previousSince: Date,
): Promise<TrainingReview['muscleVolume']> {
  const current = await volumeBetween(caller, since, new Date())
  const previous = new Map(
    (await volumeBetween(caller, previousSince, since)).map((r) => [r.muscle, r.volume]),
  )

  /**
   * The UNION of both windows, not just the current one. Iterating `current` alone made a muscle
   * trained hard last period and abandoned this one simply disappear — indistinguishable from never
   * having been trained, and precisely the regression the comparison exists to surface.
   */
  const currentByMuscle = new Map(current.map((r) => [r.muscle, r.volume]))
  const muscles = new Set([...currentByMuscle.keys(), ...previous.keys()])

  return [...muscles]
    .map((muscle) => {
      const volume = currentByMuscle.get(muscle) ?? 0
      const before = previous.get(muscle) ?? 0
      return {
        muscle,
        volumeKg: gToKg(Math.round(volume)),
        changePct: before === 0 ? null : Math.round(((volume - before) / before) * 100),
      }
    })
    .toSorted((a, b) => b.volumeKg - a.volumeKg)
}

/** A set's measured dimensions, as columns — every one `DIMENSION_FIELDS` knows. */
const effortColumns = sql.join(
  Object.values(DIMENSION_FIELDS).map((field) => setLogs[field.key]),
  sql`, `,
)

/** `mapWith(Number)` would type a nullable aggregate as `number` while it stays null at runtime. */
const numberOrNull = (value: string | null) => (value === null ? null : Number(value))

/**
 * An exercise trained at least three times whose best logged set has not improved. Deliberately
 * judged on what was LOGGED, not on the prescription: a plan can say anything, the logs say what
 * actually happened.
 */
async function stalled(caller: Caller, since: Date): Promise<TrainingReview['stalled']> {
  const exercises = visibleExercises(caller)
  const rows = await db
    .select({
      exercise: exercises.name,
      sessions: sql<number>`count(distinct ${setLogs.sessionId})`.mapWith(Number),
      bestWeight: sql<number | null>`max(${setLogs.weightG})`.mapWith(numberOrNull),
      bestReps: sql<number | null>`max(${setLogs.reps})`.mapWith(numberOrNull),
      /**
       * Progress is a change in ANY measured dimension. `count(distinct weight_g)` was 0 for every
       * bodyweight and duration exercise, because `count(distinct NULL)` is 0, so a pull-up going
       * 8 -> 10 -> 12 reps read as stalled; the tuple that fixed it left out distance, and a run
       * going further each week did too. Built from the dimension table, so none can be missed.
       *
       * Still crude: one failed rep on a last set is a second effort, so "not stalled".
       */
      distinctEfforts: sql<number>`count(distinct (${effortColumns}))`.mapWith(Number),
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    /**
     * INNER, onto the visible relation. Own logs are not enough: an exercise can stop being visible
     * after it was logged, when a shared group loses the caller as a member. Omitted rather than
     * redacted, matching `progression/service.ts` — there is nothing useful to say about a
     * movement whose name the caller cannot read, and this output goes to an AI over MCP.
     */
    .innerJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    .where(
      and(
        eq(workoutSessions.userId, caller.userId),
        eq(setLogs.isWarmup, false),
        gte(workoutSessions.startedAt, since),
      ),
    )
    /**
     * By ID, not by name. Duplicate names are the NORMAL case here — `library_audit` exists because
     * "Bench Press" next to "Barbell Bench Press" is the expected library failure, and duplicating
     * a shared exercise into your own group produces an identical name by construction. Grouped on
     * the text, two sessions on the shared copy and two on your own became one row with
     * `sessions: 4`, clearing the `>= 3` threshold it never should have reached and telling the AI
     * a movement had stalled that was never trained three times.
     */
    .groupBy(exercises.id, exercises.name)
    .having(sql`count(distinct ${setLogs.sessionId}) >= 3`)
    .orderBy(asc(exercises.name))

  return rows.filter((r) => r.distinctEfforts <= 1).map((r) => toStalled(r))
}

interface StalledRow {
  readonly exercise: string
  readonly sessions: number
  /** Null for a movement that logs no weight — `max()` over nothing but NULLs. */
  readonly bestWeight: number | null
  readonly bestReps: number | null
}

function toStalled(r: StalledRow): TrainingReview['stalled'][number] {
  return {
    exercise: r.exercise,
    sessions: r.sessions,
    // Drizzle does not run `mapWith` on a SQL NULL, so it arrives as null — not NaN, as this once
    // assumed, which let `Math.round(null)` report a stalled pull-up as "0kg".
    bestWeightKg: r.bestWeight === null ? null : gToKg(Math.round(r.bestWeight)),
    bestReps: r.bestReps,
  }
}
