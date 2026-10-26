import { z } from 'zod'
import type { AthleteEquipment } from './athlete-equipment.ts'
import type { Exercise } from './exercise.ts'
import { isWeighted } from './equipment.ts'
import { type WeightUnit, gToKgShown, gToLbShown, kgToG, lbToG } from './units.ts'

/**
 * The weights an athlete can put on one exercise (#36): from their item that holds its load, how
 * its weights go — the lightest, a step at a time, up to the heaviest. A weight between two of them
 * cannot be loaded; a plan's is shown as the heaviest that can, and a set is judged against that.
 * See GLOSSARY.md, "Loadable weight", and docs/adr/0024-targets-follow-the-athletes-equipment.md.
 */
export interface Load {
  readonly stepG: number
  /** Where the weights start; none is from nothing up, as a belt's added weight. */
  readonly minG: number | null
  /** The heaviest; none is no cap. */
  readonly maxG: number | null
  /** A bodyweight movement: below nothing is assistance (#19), which has no floor. */
  readonly assisted: boolean
  /**
   * The unit the weights are counted in. Grams are not a whole number of pounds — 5 lb is 2268 g,
   * a fraction heavy — so stepped in grams, 45 lb and 54 plates came to 315.01 lb. Stepped as the
   * athlete reads them, each weight is the one typing it would store.
   */
  readonly unit: WeightUnit
}

/** What of an exercise says its load: the item holding it, and how it is measured. */
export type LoadedExercise = { readonly [K in 'equipment' | 'tracking']: Readonly<Exercise[K]> }

/** One athlete's load for any exercise — `loadOf` with their equipment and unit bound. */
export type LoadFor = (exercise: LoadedExercise) => Load | null

/**
 * An exercise's load for an athlete, or null when it is not known — they have not said how the
 * item's weights go, or it has none — and nothing is snapped: the plan's weight stands, and the
 * logger steps as it always has. A bodyweight movement loads by their weight belt, if any.
 */
export function loadOf(
  exercise: LoadedExercise,
  held: AthleteEquipment,
  unit: WeightUnit,
): Load | null {
  const assisted = exercise.tracking === 'bodyweight_reps'
  if (!assisted && exercise.tracking !== 'weight_reps') return null
  const item = assisted ? 'weight_belt' : exercise.equipment?.find((slug) => isWeighted(slug))
  const weights = held.items.find((i) => i.slug === item)?.weights ?? null
  if (weights === null) return null
  // A belt's least is the belt alone — nothing added — and below it is assistance, unbounded.
  return assisted
    ? { stepG: weights.stepG, minG: null, maxG: weights.maxG, assisted, unit }
    : { ...weights, assisted, unit }
}

/** A weight as the athlete reads it, and back: the grid is counted in what they read. */
const read = (load: Load, grams: number): number =>
  load.unit === 'kg' ? gToKgShown(grams) : gToLbShown(grams)
const stored = (load: Load, value: number): number => {
  const hundredths = Number(value.toFixed(2))
  return load.unit === 'kg' ? kgToG(hundredths) : lbToG(hundredths)
}

const origin = (load: Load): number => load.minG ?? 0
const floor = (load: Load): number => load.minG ?? (load.assisted ? -Infinity : 0)

/** The weight `k` steps from where the weights start. */
const point = (load: Load, k: number): number =>
  stored(load, read(load, origin(load)) + k * read(load, load.stepG))

/**
 * A hundredth of a step: how far a weight may sit off the grid and still be on it — a weight typed
 * to the hundredth, against a step read to the hundredth.
 */
const SLACK = 0.01

/** Steps from where the weights start, as many as fit: down to the one at or below `grams`. */
const stepsBelow = (load: Load, grams: number): number =>
  Math.floor((read(load, grams) - read(load, origin(load))) / read(load, load.stepG) + SLACK)
/** Up to the one at or above `grams`. */
const stepsAbove = (load: Load, grams: number): number =>
  Math.ceil((read(load, grams) - read(load, origin(load))) / read(load, load.stepG) - SLACK)

/** The heaviest weight there is: the cap itself, or the last step under it. */
const top = (load: Load): number =>
  load.maxG === null ? Infinity : point(load, stepsBelow(load, load.maxG))

const within = (load: Load, grams: number): number =>
  Math.min(top(load), Math.max(floor(load), grams))

/**
 * The next weight up (`1`) or down (`-1`) that can be loaded — from a weight typed between two, the
 * one beside it, never a step past it — stopping at the lightest and the heaviest: at or past an
 * end, the button does nothing, and a weight typed beyond it stays. An empty field steps from
 * nothing.
 */
export function steppedOn(load: Load, value: number | null, by: 1 | -1): number {
  const at = value ?? 0
  if (value !== null && (by === 1 ? at >= top(load) : at <= floor(load))) return value
  return within(load, point(load, by === 1 ? stepsBelow(load, at) + 1 : stepsAbove(load, at) - 1))
}

/** Why a target is not the plan's weight's nearest below: past the heaviest, or under the lightest. */
export const LoadLimit = z.enum(['heaviest', 'lightest'])
export type LoadLimit = z.output<typeof LoadLimit>

/** Where a target stopped, as the logger and the AI say it beside the target. */
export const LOAD_LIMIT_WORDS: Readonly<Record<LoadLimit, string>> = {
  heaviest: 'your heaviest',
  lightest: 'your lightest',
}

/**
 * A target as it can be loaded: the heaviest weight not above it — never more than the plan asks —
 * except under the lightest, where the lightest is all there is. Says which end it stopped at.
 */
export function loadable(
  load: Load | null,
  grams: number,
): { readonly weightG: number; readonly limit: LoadLimit | null } {
  if (load === null) return { weightG: grams, limit: null }
  // Told by what was asked, not by where it lands: 25 kg asked of dumbbells topping out at 24 lands
  // on the heaviest, and is short of what the plan wants.
  const slack = load.stepG * SLACK
  if (grams > top(load) + slack) return { weightG: top(load), limit: 'heaviest' }
  if (grams < floor(load) - slack) return { weightG: floor(load), limit: 'lightest' }
  return { weightG: within(load, point(load, stepsBelow(load, grams))), limit: null }
}
