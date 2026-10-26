import { z } from 'zod'
import type { AthleteEquipment } from './athlete-equipment.ts'
import type { TrackingMode } from './exercise.ts'
import { type EquipmentSlug, isWeighted } from './equipment.ts'

/**
 * The weights an athlete can put on one exercise (#36): from their item that holds its load, how
 * its weights go — the lightest, a step at a time, up to the heaviest. A weight between two of them
 * cannot be loaded; a plan's is shown as the heaviest that can, and a set is judged against that.
 * See docs/adr/0024-targets-follow-the-athletes-equipment.md.
 */
export interface Load {
  readonly stepG: number
  /** Where the weights start; none is from nothing up, as a belt's added weight. */
  readonly minG: number | null
  /** The heaviest; none is no cap. */
  readonly maxG: number | null
  /** A bodyweight movement: below nothing is assistance (#19), which has no floor. */
  readonly assisted: boolean
}

/**
 * An exercise's load for an athlete, or null when it is not known — they have not said how the
 * item's weights go, or it has none — and nothing is snapped: the plan's weight stands, and the
 * logger steps as it always has. A bodyweight movement loads by their weight belt, if any.
 */
export function loadOf(
  exercise: {
    readonly equipment: readonly EquipmentSlug[] | null
    readonly tracking: TrackingMode
  },
  held: AthleteEquipment,
): Load | null {
  const assisted = exercise.tracking === 'bodyweight_reps'
  if (!assisted && exercise.tracking !== 'weight_reps') return null
  const item = assisted ? 'weight_belt' : exercise.equipment?.find((slug) => isWeighted(slug))
  const weights = held.items.find((i) => i.slug === item)?.weights ?? null
  if (weights === null) return null
  // A belt's least is the belt alone — nothing added — and below it is assistance, unbounded.
  return assisted
    ? { stepG: weights.stepG, minG: null, maxG: weights.maxG, assisted }
    : { ...weights, assisted }
}

const origin = (load: Load): number => load.minG ?? 0
const floor = (load: Load): number => load.minG ?? (load.assisted ? -Infinity : 0)
/** The heaviest weight on the grid: the cap itself, or the last step under it. */
const top = (load: Load): number =>
  load.maxG === null
    ? Infinity
    : origin(load) + Math.floor((load.maxG - origin(load)) / load.stepG) * load.stepG

const within = (load: Load, grams: number): number =>
  Math.min(top(load), Math.max(floor(load), grams))

/**
 * The next weight up (`1`) or down (`-1`) that can be loaded — from a weight typed between two, the
 * one beside it, never a step past it — stopping at the lightest and the heaviest. An empty field
 * steps from nothing.
 */
export function steppedOn(load: Load, value: number | null, by: 1 | -1): number {
  const steps = ((value ?? 0) - origin(load)) / load.stepG
  const k = by === 1 ? Math.floor(steps) + 1 : Math.ceil(steps) - 1
  return within(load, origin(load) + k * load.stepG)
}

/** Why a target is not the plan's weight's nearest below: past the heaviest, or under the lightest. */
export const LoadLimit = z.enum(['heaviest', 'lightest'])
export type LoadLimit = z.output<typeof LoadLimit>

/** Where a target stopped, as the logger says it beside the target. */
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
  if (grams > top(load)) return { weightG: top(load), limit: 'heaviest' }
  if (grams < floor(load)) return { weightG: floor(load), limit: 'lightest' }
  return {
    weightG: origin(load) + Math.floor((grams - origin(load)) / load.stepG) * load.stepG,
    limit: null,
  }
}
