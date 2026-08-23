import { z } from 'zod'
import { Id, PaginationQuery, Timestamp } from './primitives.ts'

/**
 * What actually happened, as opposed to what was prescribed.
 *
 * `workoutId`, `dayId` and `entryId` are all nullable so ad-hoc logging — walking into the gym and
 * lifting without a plan — uses the same tables and feeds the same history. `exerciseId` is always
 * set, which is what makes per-exercise history (and, later, progress graphs) a single indexed read.
 *
 * Sessions belong to a user directly, not to a group: logs are personal and never shared.
 */

export const SetLog = z.object({
  id: Id,
  /** The prescribed set this fulfils, when the session came from a workout day. */
  entryId: Id.nullable(),
  exerciseId: Id,
  setIndex: z.int().nonnegative().max(999),
  weightG: z.int().nonnegative().nullable(),
  reps: z.int().nonnegative().max(1000).nullable(),
  rpe: z.int().min(1).max(10).nullable(),
  durationS: z.int().nonnegative().max(86_400).nullable(),
  distanceMm: z.int().nonnegative().max(1_000_000_000).nullable(),
  isWarmup: z.boolean(),
  loggedAt: Timestamp,
})
export type SetLog = z.output<typeof SetLog>

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

/** List rows omit the logs, which are only needed when a single session is opened. */
export const WorkoutSessionSummary = WorkoutSession.omit({ logs: true }).extend({
  workoutName: z.string().nullable(),
  dayName: z.string().nullable(),
  setCount: z.int().nonnegative(),
  totalVolumeG: z.int().nonnegative(),
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

export const LogSetInput = z.strictObject({
  exerciseId: Id,
  entryId: Id.nullable().default(null),
  setIndex: z.int().nonnegative().max(999),
  weightG: z.int().nonnegative().nullable().default(null),
  reps: z.int().nonnegative().max(1000).nullable().default(null),
  rpe: z.int().min(1).max(10).nullable().default(null),
  durationS: z.int().nonnegative().max(86_400).nullable().default(null),
  distanceMm: z.int().nonnegative().max(1_000_000_000).nullable().default(null),
  isWarmup: z.boolean().default(false),
})
export type LogSetInput = z.output<typeof LogSetInput>

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
      weightG: z.int().nonnegative().nullable(),
      reps: z.int().nonnegative().nullable(),
      rpe: z.int().min(1).max(10).nullable(),
      durationS: z.int().nonnegative().nullable(),
      distanceMm: z.int().nonnegative().nullable(),
      isWarmup: z.boolean(),
    }),
  ),
})
export type ExerciseHistoryEntry = z.output<typeof ExerciseHistoryEntry>

/** Most recent session first. */
export const ExerciseHistory = z.object({
  exerciseId: Id,
  sessions: z.array(ExerciseHistoryEntry),
})
export type ExerciseHistory = z.output<typeof ExerciseHistory>

export const ExerciseHistoryQuery = z.strictObject({
  since: Timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})
export type ExerciseHistoryQuery = z.output<typeof ExerciseHistoryQuery>
