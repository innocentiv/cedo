import { z } from 'zod'
import { Media } from './media.ts'
import { MuscleSlug } from './muscle.ts'
import { Id, NonEmptyString, PaginationQuery, Timestamp } from './primitives.ts'

/** How much of a movement's load a given muscle carries, as a percentage of the total. */
export const MuscleLoad = z.object({
  muscle: MuscleSlug,
  loadPct: z.int().min(1).max(100),
})
export type MuscleLoad = z.output<typeof MuscleLoad>

const MUSCLE_LOAD_TOTAL = 100

/**
 * How an exercise is measured. The UI reads this to decide which inputs to render, so screens
 * never guess. Progression rules act on whichever dimension the mode designates.
 */
export const TRACKING_MODES = [
  'weight_reps',
  'bodyweight_reps',
  'duration',
  'distance_duration',
] as const
export const TrackingMode = z.enum(TRACKING_MODES)
export type TrackingMode = z.output<typeof TrackingMode>

/**
 * Two invariants, enforced here so the API, the MCP tools and the UI form all reject the same
 * input with the same message — rather than the database raising a primary-key violation that
 * nobody can act on.
 */
function checkMuscles(muscles: MuscleLoad[], ctx: z.RefinementCtx): void {
  const total = muscles.reduce((sum, m) => sum + m.loadPct, 0)
  if (total !== MUSCLE_LOAD_TOTAL) {
    ctx.addIssue({
      code: 'custom',
      path: ['muscles'],
      message: `Muscle loads must sum to ${MUSCLE_LOAD_TOTAL}, got ${total}`,
    })
  }
  const slugs = muscles.map((m) => m.muscle)
  if (new Set(slugs).size !== slugs.length) {
    ctx.addIssue({ code: 'custom', path: ['muscles'], message: 'Each muscle may appear only once' })
  }
}

const exerciseFields = {
  name: NonEmptyString.max(120),
  /**
   * For `bodyweight_reps`, a logged `weightG` means weight ADDED to bodyweight (a +20 kg pull-up),
   * not total system load. Documented here because it is the only place the convention lives.
   */
  tracking: TrackingMode.default('weight_reps'),
  description: z.string().max(4000).default(''),
  instructions: z.string().max(8000).default(''),
  equipment: z.string().max(80).nullable().default(null),
  /** Performed one limb at a time, so logged weight is per side. */
  isUnilateral: z.boolean().default(false),
  muscles: z.array(MuscleLoad).min(1).max(12),
  mediaIds: z.array(Id).max(8).default([]),
}

const ExerciseFields = z.strictObject(exerciseFields)

export const ExerciseCreate = ExerciseFields.superRefine((value, ctx) => {
  checkMuscles(value.muscles, ctx)
})
export type ExerciseCreate = z.output<typeof ExerciseCreate>

/** Every field optional; the muscle invariants apply only when `muscles` is actually being set. */
export const ExerciseUpdate = ExerciseFields.partial().superRefine((value, ctx) => {
  if (value.muscles !== undefined) checkMuscles(value.muscles, ctx)
})
export type ExerciseUpdate = z.output<typeof ExerciseUpdate>

export const Exercise = z.object({
  id: Id,
  ...exerciseFields,
  /** Resolved media, not just ids — the UI renders without a second request. */
  media: z.array(Media),
  ownerGroupId: Id,
  createdBy: Id,
  /** Computed per caller: whether they may edit it, and whether they have pinned it. */
  canEdit: z.boolean(),
  isFavourite: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Exercise = z.output<typeof Exercise>

export const EXERCISE_SCOPES = ['all', 'mine', 'favourites', 'group'] as const
export const ExerciseScope = z.enum(EXERCISE_SCOPES)
export type ExerciseScope = z.output<typeof ExerciseScope>

/**
 * `scope: 'group'` requires `groupId`. Modelled as two fields rather than a `group:<uuid>` string,
 * because a stringly-typed union cannot be validated or shown to an AI as a JSON Schema.
 */
export const ExerciseQuery = PaginationQuery.extend({
  scope: ExerciseScope.default('all'),
  groupId: Id.optional(),
  q: z.string().trim().max(100).optional(),
  muscle: MuscleSlug.optional(),
}).refine((v) => v.scope !== 'group' || v.groupId !== undefined, {
  path: ['groupId'],
  message: "groupId is required when scope is 'group'",
})
export type ExerciseQuery = z.output<typeof ExerciseQuery>

/** Moving a resource between groups, and copying one so it can be edited independently. */
export const TransferInput = z.strictObject({ toGroupId: Id })
export type TransferInput = z.output<typeof TransferInput>

/** Omitting `toGroupId` duplicates into the caller's own personal group. */
export const DuplicateInput = z.strictObject({ toGroupId: Id.optional() })
export type DuplicateInput = z.output<typeof DuplicateInput>
