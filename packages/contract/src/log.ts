import { z } from 'zod'
import { LoggedDistanceMm, LoggedDurationS, LoggedReps, LoggedWeightG, Rpe } from './measurement.ts'
import { Exercise, TrackingMode } from './exercise.ts'
import { Id, PaginationQuery, Timestamp } from './primitives.ts'
import { WorkoutDay, WorkoutEntry } from './workout.ts'

/**
 * What actually happened, as opposed to what was prescribed.
 *
 * `workoutId`, `dayId` and `entryId` are all nullable so ad-hoc logging — walking into the gym and
 * lifting without a plan — uses the same tables and feeds the same history. `exerciseId` is always
 * set, which is what makes per-exercise history (and, later, progress graphs) a single indexed read.
 *
 * Sessions belong to a user directly, not to a group: logs are personal and never shared.
 */

/**
 * The exercise a set was logged against — its name and how it is measured — as far as the caller
 * can STILL see it. Null once they cannot: the log is theirs for good, the exercise's name is not
 * (see docs/03-domain-model.md). Carried on the log so a screen never has to rebuild it from a plan
 * it may no longer load, or from exercises picked before a reload.
 */
export const LoggedExercise = Exercise.pick({ name: true, tracking: true })

/** The highest number a set takes in its series: a thousand sets, which no session approaches. */
export const MAX_SET_INDEX = 999
export type LoggedExercise = z.output<typeof LoggedExercise>

export const SetLog = z.object({
  id: Id,
  /**
   * The prescribed set this fulfils, when the session came from a workout day — as the reader sees
   * it: null once that entry is gone from the plan or out of their reach, like a set logged without
   * one. That is the series the set now counts in. See GLOSSARY.md, "Series".
   */
  entryId: Id.nullable(),
  exerciseId: Id,
  exercise: LoggedExercise.nullable(),
  setIndex: z.int().nonnegative().max(MAX_SET_INDEX),
  weightG: LoggedWeightG.nullable(),
  reps: LoggedReps.nullable(),
  rpe: Rpe.nullable(),
  durationS: LoggedDurationS.nullable(),
  distanceMm: LoggedDistanceMm.nullable(),
  isWarmup: z.boolean(),
  loggedAt: Timestamp,
})
export type SetLog = z.output<typeof SetLog>

/** An exercise a session is working through: enough to show its logger. */
export const SessionExercise = LoggedExercise.extend({ id: Id })
export type SessionExercise = z.output<typeof SessionExercise>

/**
 * The exercises a session is working through when no plan day is shown — a session without a
 * plan, or one whose plan is out of reach: those it has logged, in the order first logged, then any
 * picked since. The logs are the record, so a reload continues where it left off instead of starting
 * from an empty screen. A set logged this way names no plan entry; with the plan out of reach there
 * is no progression to count it toward. An exercise the caller can no longer see has no name to
 * show, and no logger: nothing new can be logged against it.
 */
export function exercisesInSession(
  logs: readonly SetLog[],
  picked: readonly SessionExercise[],
): SessionExercise[] {
  const byId = new Map<string, SessionExercise>()
  for (const log of logs) {
    if (log.exercise !== null && !byId.has(log.exerciseId)) {
      byId.set(log.exerciseId, { id: log.exerciseId, ...log.exercise })
    }
  }
  for (const exercise of picked) if (!byId.has(exercise.id)) byId.set(exercise.id, exercise)
  return [...byId.values()]
}

export const WorkoutSession = z.object({
  id: Id,
  workoutId: Id.nullable(),
  dayId: Id.nullable(),
  startedAt: Timestamp,
  endedAt: Timestamp.nullable(),
  notes: z.string().nullable(),
  logs: z.array(SetLog),
})
export type WorkoutSession = z.output<typeof WorkoutSession>

/** An entry of the day a session follows, and the working sets done in its series so far. */
export const SessionEntry = WorkoutEntry.extend({ done: z.int().nonnegative() })
export type SessionEntry = z.output<typeof SessionEntry>

/** The day a session follows: the plan's day, each entry with its done count. */
export const SessionDay = WorkoutDay.extend({ entries: z.array(SessionEntry) })
export type SessionDay = z.output<typeof SessionDay>

/**
 * The plan a session follows, as its reader can reach it — decided by the server, from the same
 * visible relations it numbers sets by:
 *
 * - `null`: it follows no day — started without one, or its day has since been removed;
 * - `reachable: false`: it follows a day the reader can no longer see — they left the group it
 *   lives in. Its sets count as logged without a plan, and the session goes on as one;
 * - `reachable: true`: the day, each entry with its exercise (null when unavailable) and done count.
 *
 * Decided here, not by a screen joining its own reads: a screen that failed to FETCH the plan took
 * that for a plan out of reach, and logged the next set into the wrong series.
 */
export const SessionPlan = z
  .discriminatedUnion('reachable', [
    z.object({ reachable: z.literal(false) }),
    z.object({ reachable: z.literal(true), day: SessionDay }),
  ])
  .nullable()
export type SessionPlan = z.output<typeof SessionPlan>

/** A session as read on its own: with the plan it follows. Writes answer the plain session. */
export const SessionDetail = WorkoutSession.extend({ plan: SessionPlan })
export type SessionDetail = z.output<typeof SessionDetail>

/** List rows omit the logs, which are only needed when a single session is opened. */
export const WorkoutSessionSummary = WorkoutSession.omit({ logs: true }).extend({
  workoutName: z.string().nullable(),
  dayName: z.string().nullable(),
  setCount: z.int().nonnegative(),
  /**
   * Weight × reps over its working sets, in grams. Work with no load — a plank, a run, an
   * unweighted pull-up — adds nothing, so 0 is a session that lifted nothing, not one that did no
   * work: `setCount` says that. See GLOSSARY.md, "Weight lifted".
   */
  liftedG: z.int().nonnegative(),
})
export type WorkoutSessionSummary = z.output<typeof WorkoutSessionSummary>

/** Both null starts an ad-hoc session. */
export const SessionStart = z.strictObject({
  workoutId: Id.nullable().default(null),
  dayId: Id.nullable().default(null),
})
export type SessionStart = z.output<typeof SessionStart>

export const SessionUpdate = z.strictObject({
  endedAt: Timestamp.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
})
export type SessionUpdate = z.output<typeof SessionUpdate>

/**
 * One set as done. No `setIndex`: the server numbers every set within its series (`nextSetIndex`),
 * so the app and an AI cannot number them two different ways. Strict, so a caller still sending
 * one is told, not ignored.
 */
export const LogSetInput = z.strictObject({
  exerciseId: Id,
  entryId: Id.nullable().default(null),
  weightG: LoggedWeightG.nullable().default(null),
  reps: LoggedReps.nullable().default(null),
  rpe: Rpe.nullable().default(null),
  durationS: LoggedDurationS.nullable().default(null),
  distanceMm: LoggedDistanceMm.nullable().default(null),
  isWarmup: z.boolean().default(false),
})
export type LogSetInput = z.output<typeof LogSetInput>

/**
 * A whole, finished session in one write — how an AI records training it was told about. All or
 * nothing: one invalid set and nothing is logged, so a retry cannot duplicate the valid ones.
 */
export const SessionLogInput = z.strictObject({
  workoutId: Id.nullable().default(null),
  dayId: Id.nullable().default(null),
  notes: z.string().max(4000).nullable().default(null),
  sets: z.array(LogSetInput).min(1).max(200),
})
export type SessionLogInput = z.output<typeof SessionLogInput>

/**
 * What says which SERIES a set counts in: its plan entry, or — logged with none — its exercise.
 * Two entries for one exercise in a day are two series; a set of that exercise logged without an
 * entry is a third. See GLOSSARY.md, "Series".
 */
export interface SeriesMember {
  readonly entryId: string | null
  readonly exerciseId: string
}

export const sameSeries = (a: SeriesMember, b: SeriesMember): boolean =>
  a.entryId === null ? b.entryId === null && a.exerciseId === b.exerciseId : a.entryId === b.entryId

/**
 * The index the next set of `member`'s series takes: one past the highest logged in it, warm-ups
 * included — one sequence, in the order performed. Not a count: counting reused an index after an
 * undo — log sets 1-3, undo set 2, log again, and there were two "Set 3" and no "Set 2" — because a
 * count does not know which one was removed. So a number below the highest is never given again;
 * undoing the LAST set frees its number, and the next set takes it, as a correction would.
 *
 * The server numbers every set with this — under the session's lock, over the logs as the caller
 * sees them, or in a whole session's order sent — and nothing else does. The lock is what keeps a number unique: a
 * database constraint could not, because an entry can be removed from a plan underneath its logs,
 * and those logs then join the exercise's entry-free series with the numbers they already had.
 */
export const nextSetIndex = (
  logs: readonly (SeriesMember & { readonly setIndex: number })[],
  member: SeriesMember,
): number =>
  logs
    .filter((log) => sameSeries(log, member))
    .reduce((next, log) => Math.max(next, log.setIndex + 1), 0)

/** The working sets done in `member`'s series — what a logger shows as "N done". */
export const workingSetsDone = (
  logs: readonly (SeriesMember & { readonly isWarmup: boolean })[],
  member: SeriesMember,
): number => logs.filter((log) => !log.isWarmup && sameSeries(log, member)).length

export const SessionQuery = PaginationQuery.extend({
  workoutId: Id.optional(),
  since: Timestamp.optional(),
})
export type SessionQuery = z.output<typeof SessionQuery>

/**
 * One past performance of an exercise, grouped by session. This is the shape progression rules
 * consume, and the shape a progress chart will consume later without a schema change.
 */
export const ExerciseHistoryEntry = z.object({
  sessionId: Id,
  performedAt: Timestamp,
  sets: z.array(
    z.object({
      setIndex: z.int().nonnegative(),
      weightG: LoggedWeightG.nullable(),
      reps: LoggedReps.nullable(),
      rpe: Rpe.nullable(),
      durationS: LoggedDurationS.nullable(),
      distanceMm: LoggedDistanceMm.nullable(),
      isWarmup: z.boolean(),
    }),
  ),
})
export type ExerciseHistoryEntry = z.output<typeof ExerciseHistoryEntry>

/** Most recent session first. */
export const ExerciseHistory = z.object({
  exerciseId: Id,
  /** So a reader renders the sets in the exercise's terms — `formatEffort(set, tracking, unit)`. */
  tracking: TrackingMode,
  sessions: z.array(ExerciseHistoryEntry),
})
export type ExerciseHistory = z.output<typeof ExerciseHistory>

export const ExerciseHistoryQuery = z.strictObject({
  since: Timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})
export type ExerciseHistoryQuery = z.output<typeof ExerciseHistoryQuery>
