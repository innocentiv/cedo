import type { Effort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import { gToKg, kgToG, mToMm, mmToM } from './units.ts'

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

/** What a field shows while it is being typed in, and the base-unit value that text means. */
export interface Typed {
  readonly text: string
  /** Base units — grams, millimetres, seconds — or null for an empty field. */
  readonly value: number | null
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
export interface DimensionField {
  readonly dimension: Dimension
  /** Where the value lives on an `Effort`. */
  readonly key: keyof Effort
  /**
   * The unit, as a field label. Only weight depends on the mode: on a bodyweight movement it is
   * weight ADDED, `+kg`. Without a mode — a progression increment — it is the plain unit.
   */
  readonly unit: (tracking?: TrackingMode) => string
  readonly decimals: boolean
  readonly toText: (value: number | null) => string
  readonly parse: (text: string) => Typed
}

/**
 * Keeps what was typed: digits, plus — with `decimals` — ONE separator, normalised to a point. A
 * comma is the decimal key on an Italian, German or French keypad, and stripping it turned "62,5"
 * into 625.
 */
export function cleanNumber(text: string, decimals: boolean): string {
  if (!decimals) return text.replaceAll(/\D/gu, '')
  const [whole = '', ...rest] = text
    .replaceAll(',', '.')
    .replaceAll(/[^\d.]/gu, '')
    .split('.')
  return rest.length === 0 ? whole : `${whole}.${rest.join('')}`
}

/**
 * The text is returned as well as the value: "62." must stay "62." on screen while it parses to 62
 * kg, or the point vanishes under the cursor and 62.5 typed key by key becomes 625.
 */
function parser(decimals: boolean, toBase: (typed: number) => number) {
  return (text: string): Typed => {
    const cleaned = cleanNumber(text, decimals)
    if (cleaned === '' || cleaned === '.') return { text: cleaned, value: null }
    return { text: cleaned, value: toBase(Number(cleaned)) }
  }
}

const shown = (fromBase: (value: number) => number) => (value: number | null) =>
  value === null ? '' : String(fromBase(value))

const identity = (n: number): number => n

export const DIMENSION_FIELDS: Readonly<Record<Dimension, DimensionField>> = {
  weight: {
    dimension: 'weight',
    key: 'weightG',
    unit: (tracking) => (tracking === 'bodyweight_reps' ? '+kg' : 'kg'),
    decimals: true,
    toText: shown(gToKg),
    parse: parser(true, kgToG),
  },
  reps: {
    dimension: 'reps',
    key: 'reps',
    unit: () => 'reps',
    decimals: false,
    toText: shown(identity),
    parse: parser(false, identity),
  },
  duration: {
    dimension: 'duration',
    key: 'durationS',
    unit: () => 'seconds',
    decimals: false,
    toText: shown(identity),
    parse: parser(false, identity),
  },
  distance: {
    dimension: 'distance',
    key: 'distanceMm',
    unit: () => 'metres',
    decimals: true,
    toText: shown(mmToM),
    parse: parser(true, mToMm),
  },
}

/** The fields a mode measures, in the order every screen shows them. */
export const fieldsOf = (tracking: TrackingMode): readonly DimensionField[] =>
  DIMENSIONS_BY_TRACKING[tracking].map((dimension) => DIMENSION_FIELDS[dimension])

/** A prescribed set's targets, as the contract's input names them. */
export interface SetTargets {
  readonly targetReps: number | null
  readonly targetWeightG: number | null
  readonly targetDurationS: number | null
  readonly targetDistanceMm: number | null
}

export const targetsAsEffort = (set: SetTargets): Effort => ({
  reps: set.targetReps,
  weightG: set.targetWeightG,
  durationS: set.targetDurationS,
  distanceMm: set.targetDistanceMm,
})

export const effortAsTargets = (effort: Effort): SetTargets => ({
  targetReps: effort.reps,
  targetWeightG: effort.weightG,
  targetDurationS: effort.durationS,
  targetDistanceMm: effort.distanceMm,
})
