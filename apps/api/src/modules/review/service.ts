import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { gToKg } from '@cedo/contract'
import { db } from '../../db/client.ts'
import {
  exerciseMuscles,
  exercises,
  setLogs,
  workoutDays,
  workoutSessions,
} from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'

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

function adherenceOf(
  sessions: readonly { startedAt: Date }[],
  weeks: number,
): TrainingReview['adherence'] {
  const times = sessions.map((s) => s.startedAt.getTime())
  const last = times[0]

  let longestGapDays = 0
  for (let i = 0; i + 1 < times.length; i++) {
    const a = times[i]
    const b = times[i + 1]
    if (a === undefined || b === undefined) continue
    longestGapDays = Math.max(longestGapDays, Math.round((a - b) / DAY_MS))
  }

  /**
   * Counted in DISTINCT CALENDAR DAYS, not sessions. Counting sessions reported a two-day streak
   * for a morning and an evening workout on the same date, while the field is named `...Days` and
   * an AI coach reasons about it as days.
   *
   * A one-day rest does not break it: training every other day is a streak, which a naive
   * consecutive-days count would miss.
   */
  const days = [...new Set(times.map((t) => Math.floor(t / DAY_MS)))].toSorted((a, b) => b - a)
  let currentStreakDays = 0
  const today = Math.floor(Date.now() / DAY_MS)
  if (days[0] !== undefined && today - days[0] <= 1) {
    currentStreakDays = 1
    for (let i = 0; i + 1 < days.length; i++) {
      const a = days[i]
      const b = days[i + 1]
      if (a === undefined || b === undefined) break
      if (a - b > 2) break
      currentStreakDays += 1
    }
  }

  return {
    sessions: sessions.length,
    perWeek: Math.round((sessions.length / weeks) * 10) / 10,
    currentStreakDays,
    longestGapDays,
    lastSessionAt: last === undefined ? null : new Date(last).toISOString(),
  }
}

async function dayBalance(caller: Caller, since: Date): Promise<TrainingReview['dayBalance']> {
  const rows = await db
    .select({
      day: workoutDays.name,
      workout: sql<string>`coalesce((select name from workouts where id = ${workoutDays.workoutId}), '')`,
      sessions: sql<number>`count(*)`.mapWith(Number),
    })
    .from(workoutSessions)
    .innerJoin(workoutDays, eq(workoutDays.id, workoutSessions.dayId))
    .where(and(eq(workoutSessions.userId, caller.userId), gte(workoutSessions.startedAt, since)))
    .groupBy(workoutDays.name, workoutDays.workoutId)
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
        sql<number>`coalesce(sum(${setLogs.weightG} * ${setLogs.reps} * ${exerciseMuscles.loadPct} / 100.0), 0)`.mapWith(
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
      bestWeight: sql<number | null>`max(${setLogs.weightG})`.mapWith(Number),
      bestReps: sql<number | null>`max(${setLogs.reps})`.mapWith(Number),
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
      ),
    )
    .groupBy(exercises.name)
    .having(sql`count(distinct ${setLogs.sessionId}) >= 3`)
    .orderBy(asc(exercises.name))

  return rows
    .filter((r) => r.distinctEfforts <= 1)
    .map((r) => ({
      exercise: r.exercise,
      sessions: r.sessions,
      // `mapWith(Number)` turns a SQL NULL into NaN, never null.
      bestWeightKg: Number.isNaN(r.bestWeight) ? null : gToKg(Math.round(r.bestWeight)),
      bestReps: Number.isNaN(r.bestReps) ? null : r.bestReps,
    }))
}
