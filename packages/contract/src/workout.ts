import { z } from 'zod'
import { Exercise } from './exercise.ts'
import { Rpe, TargetDistanceMm, TargetDurationS, TargetReps, TargetWeightG } from './measurement.ts'
import { Progression, SetTarget } from './progression.ts'
import { Id, NonEmptyString, OrderIndex, PaginationQuery, Timestamp } from './primitives.ts'

/**
 * A workout is a sequence of days; a day is a sequence of entries; an entry is one exercise with
 * its prescribed sets. Entries sharing a `supersetGroup` letter are performed alternating; a null
 * group means performed alone. See docs/adr for why this is a tag rather than a nesting level.
 *
 * INPUT SHAPES CARRY NO INDICES. Order is array position, and the server assigns indices on write.
 * That removes a whole class of bug — duplicate indices, gaps, reorder endpoints — and makes
 * reordering a plain array move in the editor.
 */

export const SupersetGroup = z
  .string()
  .regex(/^[A-Z]$/u, 'Must be a single uppercase letter')
  .nullable()

export const WorkoutSetInput = z.strictObject({
  targetReps: TargetReps.nullable().default(null),
  targetWeightG: TargetWeightG.nullable().default(null),
  targetRpe: Rpe.nullable().default(null),
  targetDurationS: TargetDurationS.nullable().default(null),
  targetDistanceMm: TargetDistanceMm.nullable().default(null),
  /** Ramp-up sets. Excluded from progression and from volume totals. */
  isWarmup: z.boolean().default(false),
})
export type WorkoutSetInput = z.output<typeof WorkoutSetInput>

export const WorkoutEntryInput = z
  .strictObject({
    exerciseId: Id,
    supersetGroup: SupersetGroup.default(null),
    restSeconds: z.int().nonnegative().max(3600).nullable().default(null),
    progression: Progression.default({ kind: 'none' }),
    sets: z.array(WorkoutSetInput).min(1).max(20),
  })
  .refine((e) => e.sets.some((s) => !s.isWarmup), {
    path: ['sets'],
    message: 'An entry must prescribe at least one working set',
  })
export type WorkoutEntryInput = z.output<typeof WorkoutEntryInput>

export const WorkoutDayInput = z.strictObject({
  name: NonEmptyString.max(80),
  entries: z.array(WorkoutEntryInput).max(40),
})
export type WorkoutDayInput = z.output<typeof WorkoutDayInput>

/** `PUT /workouts/:id/plan` replaces the entire plan in one transaction. See docs/06-api.md. */
export const WorkoutPlanInput = z.strictObject({
  days: z.array(WorkoutDayInput).min(1).max(14),
})
export type WorkoutPlanInput = z.output<typeof WorkoutPlanInput>

export const WorkoutSet = z.object({
  id: Id,
  index: OrderIndex,
  isWarmup: z.boolean(),
  target: SetTarget,
})
export type WorkoutSet = z.output<typeof WorkoutSet>

export const WorkoutEntry = z.object({
  id: Id,
  index: OrderIndex,
  exerciseId: Id,
  /**
   * Resolved so a day renders without an extra request per entry.
   *
   * **Null when the caller cannot see the exercise.** A workout can be shared with a group while
   * one of its exercises is not — usually because the exercise was transferred away afterwards.
   * The prescription stays legible (the sets are still there) but nothing about the hidden exercise
   * is disclosed. A screen renders this as an unavailable row.
   * See docs/03-domain-model.md.
   */
  exercise: Exercise.nullable(),
  supersetGroup: SupersetGroup,
  restSeconds: z.int().nonnegative().nullable(),
  progression: Progression,
  sets: z.array(WorkoutSet),
})
export type WorkoutEntry = z.output<typeof WorkoutEntry>

export const WorkoutDay = z.object({
  id: Id,
  index: OrderIndex,
  name: z.string(),
  entries: z.array(WorkoutEntry),
})
export type WorkoutDay = z.output<typeof WorkoutDay>

export const WorkoutCreate = z.strictObject({
  name: NonEmptyString.max(120),
  notes: z.string().max(4000).nullable().default(null),
})
export type WorkoutCreate = z.output<typeof WorkoutCreate>

export const WorkoutUpdate = WorkoutCreate.partial()
export type WorkoutUpdate = z.output<typeof WorkoutUpdate>

/** List rows: no nested plan, because a list of full plans is a large and useless payload. */
export const WorkoutSummary = z.object({
  id: Id,
  name: z.string(),
  notes: z.string().nullable(),
  dayCount: z.int().nonnegative(),
  ownerGroupId: Id,
  createdBy: Id,
  canEdit: z.boolean(),
  isFavourite: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type WorkoutSummary = z.output<typeof WorkoutSummary>

export const Workout = WorkoutSummary.extend({
  days: z.array(WorkoutDay),
})
export type Workout = z.output<typeof Workout>

export const WORKOUT_SCOPES = ['all', 'mine', 'favourites', 'group'] as const
export const WorkoutScope = z.enum(WORKOUT_SCOPES)
export type WorkoutScope = z.output<typeof WorkoutScope>

export const WorkoutQuery = PaginationQuery.extend({
  scope: WorkoutScope.default('all'),
  groupId: Id.optional(),
  q: z.string().trim().max(100).optional(),
}).refine((v) => v.scope !== 'group' || v.groupId !== undefined, {
  path: ['groupId'],
  message: "groupId is required when scope is 'group'",
})
export type WorkoutQuery = z.output<typeof WorkoutQuery>
