import type { Effort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import { CLOCK, COUNT, type Typing, typing } from './typing.ts'
import { type WeightUnit, gToKgShown, gToLbShown, kgToG, lbToG, mToMm, mmToM } from './units.ts'
import type { WorkoutSetInput } from './workout.ts'

/** The measurable quantities a set can carry. See GLOSSARY.md. */
export type Dimension = 'weight' | 'reps' | 'duration' | 'distance'

/**
 * Which quantities a mode actually measures, in the order a screen shows them — in the plan editor,
 * the live logger and the progression increments alike.
 *
 * Here rather than in a screen because it is a domain rule, and because both screens had their own
 * copy: the plan editor asked for kilograms on a plank, which has no weight at all.
 *
 * `weight` is present for `bodyweight_reps` on purpose — it means weight ADDED to bodyweight, a
 * +20 kg pull-up, and is optional there. See `exerciseFields.tracking`.
 */
export const DIMENSIONS_BY_TRACKING: Readonly<Record<TrackingMode, readonly Dimension[]>> = {
  weight_reps: ['weight', 'reps'],
  bodyweight_reps: ['reps', 'weight'],
  duration: ['duration'],
  distance_duration: ['distance', 'duration'],
}

export const tracks = (mode: TrackingMode, dimension: Dimension): boolean =>
  DIMENSIONS_BY_TRACKING[mode].includes(dimension)

/**
 * Everything a screen needs to let someone type one dimension: the unit it is typed in, whether it
 * takes decimals, and the round trip between the base-unit integer stored everywhere and the text
 * in the box.
 *
 * The three screens that take a measurement each used to decide these for themselves, and had
 * drifted: `+kg` in the plan editor and plain `kg` in the logger for the same added weight, fields
 * in a different order on each, and eight hand-written `x === null ? null : kgToG(x)`. Here, they are
 * one table, and imperial units become a change to this file and `units.ts` alone.
 */
export interface DimensionField extends Typing {
  readonly dimension: Dimension
  /** Where the value lives on an `Effort` — a logged set, a suggestion. */
  readonly key: keyof Effort
  /** Where it lives on a prescribed set in a plan. */
  readonly targetKey: TargetKey
  /**
   * The unit, as a field label. Only weight depends on the mode: on a bodyweight movement it is
   * weight ADDED, `+kg`. Without a mode — a progression increment — it is the plain unit. And only
   * weight depends on the person: `fieldFor(dimension, unit)` gives it in their kg or lb.
   */
  readonly unit: (tracking?: TrackingMode) => string
}

/** A prescribed set's measured targets — derived from the schema, so a rename there breaks here. */
export type TargetKey = Exclude<Extract<keyof WorkoutSetInput, `target${string}`>, 'targetRpe'>

/** Weight, typed in the person's unit and stored in grams either way. */
function weightField(unit: WeightUnit): DimensionField {
  return {
    dimension: 'weight',
    key: 'weightG',
    targetKey: 'targetWeightG',
    unit: (tracking) => (tracking === 'bodyweight_reps' ? `+${unit}` : unit),
    ...(unit === 'kg' ? typing(true, kgToG, gToKgShown) : typing(true, lbToG, gToLbShown)),
  }
}

const WEIGHT_FIELDS: Readonly<Record<WeightUnit, DimensionField>> = {
  kg: weightField('kg'),
  lb: weightField('lb'),
}

export const DIMENSION_FIELDS: Readonly<Record<Dimension, DimensionField>> = {
  weight: WEIGHT_FIELDS.kg,
  reps: {
    dimension: 'reps',
    key: 'reps',
    targetKey: 'targetReps',
    unit: () => 'reps',
    ...COUNT,
  },
  duration: {
    dimension: 'duration',
    key: 'durationS',
    targetKey: 'targetDurationS',
    unit: () => 'm:ss',
    ...CLOCK,
  },
  distance: {
    dimension: 'distance',
    key: 'distanceMm',
    targetKey: 'targetDistanceMm',
    unit: () => 'metres',
    ...typing(true, mToMm, mmToM),
  },
}

/** One dimension's field, with weight in the person's unit. */
export const fieldFor = (dimension: Dimension, unit: WeightUnit): DimensionField =>
  dimension === 'weight' ? WEIGHT_FIELDS[unit] : DIMENSION_FIELDS[dimension]

/**
 * The fields a mode measures, in the order every screen shows them — which dimensions, and where
 * each lives on an effort and a set. To TYPE one, ask `fieldFor(dimension, unit)`: weight here is the
 * kilogram field, and the person may read pounds.
 */
export const fieldsOf = (tracking: TrackingMode): readonly DimensionField[] =>
  DIMENSIONS_BY_TRACKING[tracking].map((dimension) => DIMENSION_FIELDS[dimension])
