import type { Effort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import { type Load, steppedOn } from './load.ts'
import { CLOCK, COUNT, type Typing, typing } from './typing.ts'
import { type WeightUnit, gToKgShown, gToLbShown, kgToG, lbToG, mToMm, mmToM } from './units.ts'
import type { WorkoutSetInput } from './plan-set.ts'

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
 * Assistance — a band, an assisted machine — is NEGATIVE added weight, on a bodyweight movement
 * only (#19). One scale, so less assistance is simply heavier, and ordering, stalls and progression
 * take it as they take added load. Bounded by mode, not by the weight schemas, which do not know
 * it: the API checks a set and a plan here, where the exercise is known.
 */
export const assistable = (dimension: Dimension, tracking: TrackingMode): boolean =>
  dimension === 'weight' && tracking === 'bodyweight_reps'

export const weightAllowed = (weightG: number | null, tracking: TrackingMode): boolean =>
  weightG === null || weightG >= 0 || assistable('weight', tracking)

const unsigned = (value: number | null) => value === null || value === 0

/**
 * The Added / Assisted toggle's rules, for a field whose number is typed as a size because a phone's
 * number pad has no minus key. A stored value carries its own sign; an empty field or a zero has
 * none, and then the last sign seen — `remembered` — holds, so clearing an assisted −20 to type 15
 * keeps it assisted. Plain, so they are tested here and the input only wires them.
 */
export const assistance = {
  /** Whether the field reads as assistance now. */
  of: (value: number | null, remembered: boolean): boolean =>
    unsigned(value) ? remembered : value < 0,
  /** What to remember after a value: its own sign, or — unsigned — what was remembered. */
  remembered: (value: number | null, previously: boolean): boolean =>
    unsigned(value) ? previously : value < 0,
  /** The size the field shows. */
  shown: (value: number | null): number | null => (value === null ? null : Math.abs(value)),
  /** What a typed size is stored as. */
  stored: (typed: number | null, assisted: boolean): number | null =>
    typed === null || !assisted ? typed : -typed,
  /** A value turned to the side chosen, its size kept. */
  turned: (value: number | null, toAssisted: boolean): number | null =>
    value === null ? null : toAssisted ? -Math.abs(value) : Math.abs(value),
}

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
   * weight ADDED, `+kg` — or, `assisted`, the assistance, typed as a positive number and stored
   * negative. Without a mode — a progression increment — it is the plain unit. And only weight
   * depends on the person: `fieldFor(dimension, unit)` gives it in their kg or lb.
   */
  readonly unit: (tracking?: TrackingMode, assisted?: boolean) => string
}

/** A prescribed set's measured targets — derived from the schema, so a rename there breaks here. */
export type TargetKey = Exclude<Extract<keyof WorkoutSetInput, `target${string}`>, 'targetReserve'>

/** Weight, typed in the person's unit and stored in grams either way. */
function weightField(unit: WeightUnit): DimensionField {
  return {
    dimension: 'weight',
    key: 'weightG',
    targetKey: 'targetWeightG',
    unit: (tracking, assisted = false) => {
      if (tracking !== 'bodyweight_reps') return unit
      return assisted ? `${unit} assistance` : `+${unit}`
    },
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

/**
 * Reps in reserve — how many more reps were left — means something only of a set counted in reps:
 * a hold, or a distance over a time, has none to leave (#24). The logger asks it only of these.
 */
export const asksReserve = (tracking: TrackingMode): boolean => tracks(tracking, 'reps')

/**
 * The weight one step adds, in the person's unit: 2.5 kg, or 5 lb — the smallest pair of plates on
 * each kind of bar. Where a new progression rule starts, and what the logger's − / + move by.
 */
export const WEIGHT_STEP_G: Readonly<Record<WeightUnit, number>> = { kg: 2500, lb: lbToG(5) }

/** One step of each other dimension: a rep, five seconds, a hundred metres. */
const STEP: Readonly<Record<Exclude<Dimension, 'weight'>, number>> = {
  reps: 1,
  duration: 5,
  distance: mToMm(100),
}

export const stepOf = (dimension: Dimension, unit: WeightUnit): number =>
  dimension === 'weight' ? WEIGHT_STEP_G[unit] : STEP[dimension]

/**
 * A value moved one step up (`1`) or down (`-1`) — never below zero, except a bodyweight
 * movement's weight, which goes on down into assistance. An empty field steps from zero. A weight
 * whose load is known (#36) moves to the next weight the athlete can load instead (`steppedOn`).
 */
export function stepped(
  value: number | null,
  by: 1 | -1,
  dimension: Dimension,
  tracking: TrackingMode,
  unit: WeightUnit,
  load: Load | null = null,
): number {
  if (dimension === 'weight' && load !== null) return steppedOn(load, value, by)
  const next = (value ?? 0) + by * stepOf(dimension, unit)
  return assistable(dimension, tracking) ? next : Math.max(0, next)
}
