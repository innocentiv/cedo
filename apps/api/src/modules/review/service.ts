import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { gToKg } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visible } from '../../db/ownable.ts'
import {
  exerciseMuscles,
  exercises,
  setLogs,
  workoutDays,
  workoutSessions,
  workouts,
} from '../../db/schema.ts'
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
  const rows = await db
    .select({
      day: workoutDays.name,
      workout: workouts.name,
      sessions: sql<number>`count(*)`.mapWith(Number),
    })
    .from(workoutSessions)
    .innerJoin(workoutDays, eq(workoutDays.id, workoutSessions.dayId))
    /**
     * Joined rather than fetched by correlated subquery, so `visible()` applies to it. The subquery
     * this replaces read `select name from workouts where id = …` with no ACL at all, and named a
     * workout the caller had lost access to. Inner, so a day whose workout is unreachable drops out
     * entirely — you cannot balance days you cannot see.
     */
    .innerJoin(workouts, and(eq(workouts.id, workoutDays.workoutId), visible(workouts, caller)))
    .where(and(eq(workoutSessions.userId, caller.userId), gte(workoutSessions.startedAt, since)))
    /**
     * By ID, not by name. Two days can share a name across two plans, and two plans can share a
     * name outright — duplicating one is the documented way to get an editable copy. Grouping on
     * the text merges them into one row whose session count is the sum of both.
     */
    .groupBy(workoutDays.id, workoutDays.name, workouts.name)
    .orderBy(desc(sql`count(*)`))

  return rows.map((r) => ({ day: r.day, workout: r.workout, sessions: r.sessions }))
}

/**
 * `weight × reps × (load_pct / 100)`, summed per muscle. Warm-ups are excluded — they are not work.
 * One query for the current window and one for the window before it, so the trend is a comparison
 * rather than a number with no context.
 */
async function volumeBetween(caller: Caller, from: Date, to: Date) {
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
    .innerJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    .where(
      and(
        eq(workoutSessions.userId, caller.userId),
        eq(setLogs.isWarmup, false),
        gte(workoutSessions.startedAt, from),
        /**
         * The third branch of this review, held to the same rule as `stalled` and `dayBalance`.
         * Weaker than those — it reveals a muscle slug, not a name — but it reads the CURRENT
         * `load_pct` of an exercise the caller may have lost access to, so their volume shifts to
         * reflect an edit they cannot see. Leaving one of three inconsistent is how the next
         * session concludes the rule does not apply here.
         */
        visible(exercises, caller),
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

/** `mapWith(Number)` would type a nullable aggregate as `number` while it stays null at runtime. */
const numberOrNull = (value: string | null) => (value === null ? null : Number(value))

/**
 * An exercise trained at least three times whose best logged set has not improved. Deliberately
 * judged on what was LOGGED, not on the prescription: a plan can say anything, the logs say what
 * actually happened.
 */
async function stalled(caller: Caller, since: Date): Promise<TrainingReview['stalled']> {
  const rows = await db
    .select({
      exercise: exercises.name,
      sessions: sql<number>`count(distinct ${setLogs.sessionId})`.mapWith(Number),
      bestWeight: sql<number | null>`max(${setLogs.weightG})`.mapWith(numberOrNull),
      bestReps: sql<number | null>`max(${setLogs.reps})`.mapWith(numberOrNull),
      /**
       * Progress is any improvement in weight OR reps OR duration — not weight alone.
       * `count(distinct weight_g)` was 0 for every bodyweight and duration exercise, because
       * `count(distinct NULL)` is 0, so a pull-up progressing 8 -> 10 -> 12 reps was reported as
       * stalled: the tool advised changing the one movement that was actually working.
       */
      distinctEfforts:
        sql<number>`count(distinct (${setLogs.weightG}, ${setLogs.reps}, ${setLogs.durationS}))`.mapWith(
          Number,
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
        /**
         * Own logs are not enough: an exercise can stop being visible after it was logged, when a
         * shared group loses the caller as a member. Omitted rather than redacted, matching
         * `progression/service.ts` — there is nothing useful to say about a movement whose name the
         * caller cannot read, and this output goes to an AI over MCP.
         */
        visible(exercises, caller),
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
