import { z } from 'zod'
import { Exercise } from './exercise.ts'
import { TargetDistanceMm, TargetDurationS, TargetReps, TargetWeightG } from './measurement.ts'
import { Rpe } from './rpe.ts'
import { Progression, SetTarget } from './progression.ts'
import { OwnableQuery, ownableFields } from './ownable.ts'
import { Id, NonEmptyString, OrderIndex, patchOf } from './primitives.ts'

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

/**
 * How big a plan may get. Named so the plan editor stops at the same place the schema refuses: it
 * used to clamp warm-ups and working sets at 20 EACH, and an entry of 5 + 20 was accepted on screen
 * and refused on save. See `plan-editing.ts`.
 */
export const MAX_SETS_PER_ENTRY = 20
export const MAX_ENTRIES_PER_DAY = 40
export const MAX_DAYS_PER_PLAN = 14

export const WorkoutSetInput = z.strictObject({
  targetReps: TargetReps.nullable().default(null),
  targetWeightG: TargetWeightG.nullable().default(null),
  targetRpe: Rpe.nullable().default(null),
  targetDurationS: TargetDurationS.nullable().default(null),
  targetDistanceMm: TargetDistanceMm.nullable().default(null),
  /** Ramp-up sets. Excluded from progression, from working sets per muscle and weight lifted. */
  isWarmup: z.boolean().default(false),
})
export type WorkoutSetInput = z.output<typeof WorkoutSetInput>

/** A set's targets as a plan is written — `targetReps`, `targetWeightG`, … — without the flag. */
export type TargetFields = Omit<WorkoutSetInput, 'isWarmup'>

/**
 * A set's targets as a plan is written, and as it is read (`target.reps`, …): the one mapping
 * each way. The plan read, progression and `planInputFrom` each spelled it out for themselves.
 */
export const setTargetOf = (set: TargetFields): SetTarget => ({
  reps: set.targetReps,
  weightG: set.targetWeightG,
  rpe: set.targetRpe,
  durationS: set.targetDurationS,
  distanceMm: set.targetDistanceMm,
})

export const targetFieldsOf = (target: SetTarget): TargetFields => ({
  targetReps: target.reps,
  targetWeightG: target.weightG,
  targetRpe: target.rpe,
  targetDurationS: target.durationS,
  targetDistanceMm: target.distanceMm,
})

export const WorkoutEntryInput = z
  .strictObject({
    /**
     * The entry being kept, when the plan is a round trip of an existing one. Optional, and never
     * trusted: an id that is not an entry of THIS workout, or whose exercise changed, becomes a new
     * entry. See `id` on `WorkoutDayInput` for why it matters.
     */
    id: Id.optional(),
    exerciseId: Id,
    supersetGroup: SupersetGroup.default(null),
    restSeconds: z.int().nonnegative().max(3600).nullable().default(null),
    progression: Progression.default({ kind: 'none' }),
    sets: z
      .array(WorkoutSetInput)
      .min(1)
      .max(MAX_SETS_PER_ENTRY, `An exercise holds at most ${MAX_SETS_PER_ENTRY} sets`),
  })
  .refine((e) => e.sets.some((s) => !s.isWarmup), {
    path: ['sets'],
    message: 'An entry must prescribe at least one working set',
  })
export type WorkoutEntryInput = z.output<typeof WorkoutEntryInput>

export const WorkoutDayInput = z.strictObject({
  /**
   * The day being kept. Logged history hangs off day and entry ids — a session names its day, and
   * progression reads the logs of an entry — so a save that sends them back keeps that history
   * attached through renames, retargets and reorders. Omitted means a new day. Optional, and never
   * trusted: an id that is not a day of THIS workout is treated as omitted.
   */
  id: Id.optional(),
  name: NonEmptyString.max(80),
  entries: z
    .array(WorkoutEntryInput)
    .max(MAX_ENTRIES_PER_DAY, `A day holds at most ${MAX_ENTRIES_PER_DAY} exercises`),
})
export type WorkoutDayInput = z.output<typeof WorkoutDayInput>

/** `PUT /workouts/:id/plan` replaces the entire plan in one transaction. See docs/06-api.md. */
export const WorkoutPlanInput = z
  .strictObject({
    days: z
      .array(WorkoutDayInput)
      .min(1, 'A plan needs at least one day')
      .max(MAX_DAYS_PER_PLAN, `A plan holds at most ${MAX_DAYS_PER_PLAN} days`),
  })
  .superRefine((plan, ctx) => {
    const days = plan.days.flatMap((d) => (d.id === undefined ? [] : [d.id]))
    const entries = plan.days.flatMap((d) =>
      d.entries.flatMap((e) => (e.id === undefined ? [] : [e.id])),
    )
    for (const [path, ids] of [
      ['days', days],
      ['entries', entries],
    ] as const) {
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: 'custom',
          path: [path],
          message: `Each of the ${path} may appear once`,
        })
      }
    }
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

const workoutFields = {
  name: NonEmptyString.max(120),
  notes: z.string().max(4000).nullable().default(null),
}

export const WorkoutCreate = z.strictObject(workoutFields)
export type WorkoutCreate = z.output<typeof WorkoutCreate>

/** Not `.partial()`: that would turn an omitted `notes` into `null`. See `patchOf`. */
export const WorkoutUpdate = z.strictObject(patchOf(workoutFields))
export type WorkoutUpdate = z.output<typeof WorkoutUpdate>

/** List rows: no nested plan, because a list of full plans is a large and useless payload. */
export const WorkoutSummary = z.object({
  id: Id,
  name: z.string(),
  notes: z.string().nullable(),
  dayCount: z.int().nonnegative(),
  ...ownableFields,
})
export type WorkoutSummary = z.output<typeof WorkoutSummary>

export const Workout = WorkoutSummary.extend({
  days: z.array(WorkoutDay),
})
export type Workout = z.output<typeof Workout>

/**
 * A saved plan, in exactly the shape `PUT /workouts/:id/plan` takes — ids included, so sending it
 * back keeps every day and entry, and the history attached to them. `keepIds: false` is for a copy
 * into a different workout, where nothing is being kept.
 *
 * The one place this mapping lives. The plan editor, the MCP `workout_get_editable` tool and
 * `duplicate` each had their own copy, none of which carried ids.
 */
export function planInputFrom(workout: Workout, { keepIds = true } = {}): WorkoutPlanInput {
  return {
    days: workout.days.map((day) => ({
      ...(keepIds && { id: day.id }),
      name: day.name,
      entries: day.entries.map((entry) => ({
        ...(keepIds && { id: entry.id }),
        exerciseId: entry.exerciseId,
        supersetGroup: entry.supersetGroup,
        restSeconds: entry.restSeconds,
        progression: entry.progression,
        sets: entry.sets.map((set) => ({ ...targetFieldsOf(set.target), isWarmup: set.isWarmup })),
      })),
    })),
  }
}

/** The ownable list query; a workout has no filters of its own. */
export const WorkoutQuery = OwnableQuery
export type WorkoutQuery = z.output<typeof WorkoutQuery>
