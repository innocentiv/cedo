import { z } from 'zod'
import { ExerciseEquipment } from './equipment.ts'
import { Media } from './media.ts'
import { MuscleSlug } from './muscle.ts'
import { OwnableQueryFields, ownableFields, withGroupRule } from './ownable.ts'
import { Id, NonEmptyString, patchOf } from './primitives.ts'
import { PROSE_WORDS } from './prose.ts'

/** How much of a movement's load a given muscle carries, as a percentage of the total. */
export const MuscleLoad = z.object({
  muscle: MuscleSlug,
  loadPct: z.int().min(1).max(100),
})
export type MuscleLoad = z.output<typeof MuscleLoad>

const MUSCLE_LOAD_TOTAL = 100

/**
 * Muscles chosen for a new exercise, their loads split evenly to total 100 (#27) — the first ones
 * taking the remainder, a point each: three muscles are 34, 33 and 33. A start to adjust from, so the
 * form is valid the moment a muscle is chosen.
 */
export function evenLoads(muscles: readonly MuscleSlug[]): MuscleLoad[] {
  const share = Math.floor(MUSCLE_LOAD_TOTAL / Math.max(muscles.length, 1))
  const left = MUSCLE_LOAD_TOTAL - share * muscles.length
  return muscles.map((muscle, i) => ({ muscle, loadPct: share + (i < left ? 1 : 0) }))
}

/**
 * A muscle chosen, or dropped (#27). While the loads are still the even split they started as, they
 * are split evenly again; once someone has set them, they are theirs — a muscle chosen joins at
 * nothing, and one dropped takes its share with it — for that person to finish.
 */
export function withMuscleToggled(loads: readonly MuscleLoad[], muscle: MuscleSlug): MuscleLoad[] {
  const chosen = loads.some((m) => m.muscle === muscle)
  const untouched = JSON.stringify(loads) === JSON.stringify(evenLoads(loads.map((m) => m.muscle)))
  if (untouched) {
    const muscles = loads.map((m) => m.muscle)
    return evenLoads(chosen ? muscles.filter((m) => m !== muscle) : [...muscles, muscle])
  }
  return chosen ? loads.filter((m) => m.muscle !== muscle) : [...loads, { muscle, loadPct: 0 }]
}

/**
 * The picture an exercise is listed with (#27): its first video's thumbnail — never an uploaded
 * image, which says less about the movement than its name does — or none. A path or a URL, as the
 * API gives it: the app resolves it.
 */
export const videoThumbnailOf = (exercise: {
  readonly media: readonly { readonly kind: string; readonly thumbnailUrl: string | null }[]
}): string | null =>
  exercise.media.find((m) => m.kind === 'video_link' && m.thumbnailUrl !== null)?.thumbnailUrl ??
  null

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
function checkMediaIds(mediaIds: string[], ctx: z.RefinementCtx): void {
  // `exercise_media` has a composite primary key, so a repeated id is a duplicate-key violation —
  // a 500 for what is plainly a bad request.
  if (new Set(mediaIds).size !== mediaIds.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['mediaIds'],
      message: 'Each media may be attached only once',
    })
  }
}

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
   * not total system load — and, negative, assistance (a band worth −20 kg): one scale, so less
   * help is simply heavier (#19, `assistable` in dimension.ts). Assistance lifts nothing.
   * Documented here because it is the only place the convention lives.
   */
  tracking: TrackingMode.default('weight_reps'),
  description: z
    .string()
    .max(4000)
    .default('')
    .describe(`What it is, in a line or two. ${PROSE_WORDS}`),
  instructions: z
    .string()
    .max(8000)
    .default('')
    .describe(`How it is done, step by step. ${PROSE_WORDS}`),
  /** What it needs, all of it (#32) — `null` undescribed, `[]` nothing. See equipment.ts. */
  equipment: ExerciseEquipment.default(null),
  /** Performed one limb at a time, so logged weight is per side. */
  isUnilateral: z.boolean().default(false),
  muscles: z.array(MuscleLoad).min(1).max(12),
  mediaIds: z.array(Id).max(8).default([]),
}

const ExerciseFields = z.strictObject(exerciseFields)

export const ExerciseCreate = ExerciseFields.superRefine((value, ctx) => {
  checkMuscles(value.muscles, ctx)
  checkMediaIds(value.mediaIds, ctx)
})
export type ExerciseCreate = z.output<typeof ExerciseCreate>

/**
 * A create REQUEST: the exercise, and where it goes. Apart from `ExerciseCreate`, which is the
 * exercise alone — what `exerciseInputFrom` gives back, and what duplicating writes into a group of
 * its own. One shape for POST /exercises and MCP's `exercise_create`, so both make the same call.
 */
export const ExerciseCreateRequest = ExerciseCreate.safeExtend({
  shared: z
    .boolean()
    .default(false)
    .describe('Create in the shared cedo library rather than your own group — curators only'),
})
export type ExerciseCreateRequest = z.output<typeof ExerciseCreateRequest>
/** The request body as sent — what a client's `create` takes, so it cannot drift from the route's. */
export type ExerciseCreateRequestInput = z.input<typeof ExerciseCreateRequest>

/**
 * Every field optional and none defaulted (see `patchOf`); the muscle invariants apply only when
 * `muscles` is actually being set.
 */
export const ExerciseUpdate = z.strictObject(patchOf(exerciseFields)).superRefine((value, ctx) => {
  if (value.muscles !== undefined) checkMuscles(value.muscles, ctx)
  if (value.mediaIds !== undefined) checkMediaIds(value.mediaIds, ctx)
})
export type ExerciseUpdate = z.output<typeof ExerciseUpdate>

export const Exercise = z.object({
  id: Id,
  ...exerciseFields,
  /** Resolved media, not just ids — the UI renders without a second request. */
  media: z.array(Media),
  /**
   * Whether the READER has every item it needs (#35) — true while they have not said what they
   * have, or nobody has said what it needs. Not doable is marked, never hidden from a plan.
   */
  doable: z.boolean(),
  ...ownableFields,
})
export type Exercise = z.output<typeof Exercise>

/** What a request body is: fields with a default may be left out, and the server fills them. */
export type ExerciseInput = z.input<typeof ExerciseCreate>

/**
 * An exercise as the input that would make it again — to duplicate it, or to edit it whole. The one
 * place this mapping lives, as `planInputFrom` is for workouts: duplicating and the edit form each
 * spelled the fields out, and a field added to the schema would have been dropped by both without
 * a word. Here it cannot be: `satisfies` holds the list to the schema's own fields, so a field added
 * to `exerciseFields` does not compile until it is carried — and one removed, until it is not.
 *
 * Copied, not parsed: an exercise read back may no longer pass today's rules (a name saved under an
 * older limit), and duplicating it must not fail for that.
 */
export const exerciseInputFrom = (exercise: Exercise): ExerciseCreate =>
  ({
    name: exercise.name,
    tracking: exercise.tracking,
    description: exercise.description,
    instructions: exercise.instructions,
    equipment: exercise.equipment,
    isUnilateral: exercise.isUnilateral,
    muscles: exercise.muscles,
    mediaIds: exercise.mediaIds,
  }) satisfies Record<keyof typeof exerciseFields, unknown>

/** The ownable list query, plus the muscle an exercise loads. */
export const ExerciseQuery = withGroupRule(
  OwnableQueryFields.extend({
    muscle: MuscleSlug.optional(),
    /**
     * Every exercise, not only those the caller can do (#35) — which is all of them until they
     * say what they have. `stringbool`: a query string's "false" is not true.
     */
    showAll: z.stringbool().optional(),
  }),
)
export type ExerciseQuery = z.output<typeof ExerciseQuery>

/**
 * `GET /exercises/recent` (#27): the exercises the caller logged most lately, latest first — those
 * they can still see — for the picker to lead with. A handful, not a page.
 */
export const RecentExercisesQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(5),
})
export type RecentExercisesQuery = z.output<typeof RecentExercisesQuery>

/** Moving a resource between groups, and copying one so it can be edited independently. */
export const TransferInput = z.strictObject({ toGroupId: Id })
export type TransferInput = z.output<typeof TransferInput>

/** Omitting `toGroupId` duplicates into the caller's own personal group. */
export const DuplicateInput = z.strictObject({ toGroupId: Id.optional() })
export type DuplicateInput = z.output<typeof DuplicateInput>
